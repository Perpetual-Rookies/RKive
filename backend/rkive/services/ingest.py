"""
Markdown ingestion service.

Absorbs the logic previously split between the top-level `services/rkive_ingest`
CLI package and `rkive/ingest.py`.  All chunking, embedding, and vector-store
upsert logic lives here so the router can call a single coroutine.
"""

import hashlib
import re
import uuid

from qdrant_client.http import models as qm

from rkive.services.llm import embed
from rkive.services.qdrant import delete_points_by_document_id, ensure_collection, upsert_points
from rkive.visibility import normalize_visibility


def _split_large_paragraph(paragraph: str, max_chars: int, overlap: int) -> list[str]:
    """Split oversized paragraphs with sentence-aware boundaries and overlap.

    Embedding models work better when chunks are semantically coherent.  A raw
    fixed-width split can cut a sentence, table row, or bullet list in half,
    which makes retrieval less reliable.  This helper tries to break near
    natural boundaries and repeats a small suffix into the next chunk so that
    context is not lost at the edges.
    """
    parts: list[str] = []
    remaining = paragraph.strip()

    while len(remaining) > max_chars:
        window = remaining[:max_chars]
        split_at = max(
            window.rfind("\n"),
            window.rfind(". "),
            window.rfind("? "),
            window.rfind("! "),
            window.rfind("; "),
            window.rfind(", "),
            window.rfind(" "),
        )
        if split_at < max_chars // 2:
            split_at = max_chars

        part = remaining[:split_at].strip()
        if not part:
            part = remaining[:max_chars].strip()
            split_at = len(part)

        parts.append(part)
        next_start = max(0, split_at - overlap)
        remaining = remaining[next_start:].strip()

    if remaining:
        parts.append(remaining)

    return parts


def chunk_markdown(text: str, max_chars: int = 1200, overlap: int = 180) -> list[str]:
    """
    Split *text* into semantically coherent chunks.

    Strategy:
    1. Split on markdown headings (preserving the heading line).
    2. If a section still exceeds *max_chars*, further split on blank lines.
    3. If a paragraph alone exceeds *max_chars*, split near sentence-ish
       boundaries and keep a small overlap into the next chunk.

    The main goal is retrieval quality, not perfect markdown preservation.
    Smaller, focused chunks generally retrieve better than one very large block.
    """
    text = text.strip()
    if not text:
        return []

    sections = re.split(r"(?m)(?=^#{1,6}\s)", text)
    chunks: list[str] = []

    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        if len(sec) <= max_chars:
            chunks.append(sec)
            continue

        paras = re.split(r"\n\n+", sec)
        buf = ""
        for para in paras:
            para = para.strip()
            if not para:
                continue
            para_parts = [para] if len(para) <= max_chars else _split_large_paragraph(para, max_chars, overlap)
            for para_part in para_parts:
                if len(buf) + len(para_part) + 2 <= max_chars:
                    buf = f"{buf}\n\n{para_part}".strip() if buf else para_part
                    continue

                if buf:
                    chunks.append(buf)
                    carry = buf[-overlap:].strip()
                    buf = f"{carry}\n\n{para_part}".strip() if carry else para_part
                else:
                    buf = para_part

                if len(buf) > max_chars:
                    para_splits = _split_large_paragraph(buf, max_chars, overlap)
                    chunks.extend(para_splits[:-1])
                    buf = para_splits[-1]
        if buf:
            chunks.append(buf)

    return [c for c in chunks if c.strip()]


def _embedding_text(chunk: str, filename: str, visibility: str) -> str:
    """Build the text sent to the embedding model for a stored document chunk.

    We include a small amount of metadata in the embedded text because the
    vector store only understands numbers produced by the embedding model.  If
    the filename or visibility label is semantically useful to retrieval, it
    needs to be present at embedding time; storing it only in payload metadata
    is not enough for semantic search.
    """
    return (
        "search_document: "
        f"filename: {filename}\n"
        f"visibility: {visibility}\n"
        f"content:\n{chunk}"
    )


async def ingest_file(file_path: str, document_id: str, filename: str, visibility: str = "public") -> int:
    """
    Read *file_path*, chunk it, embed each chunk, and upsert the resulting
    vectors into Qdrant.

    In RAG terms:
    - "chunking" converts one document into smaller searchable passages
    - "embedding" converts each passage into a numeric vector
    - "upsert" stores those vectors in the database for later similarity search

    Returns the number of chunks stored (0 if the file is empty).
    """
    with open(file_path, encoding="utf-8") as fh:
        raw = fh.read()

    visibility = normalize_visibility(visibility)
    chunks = chunk_markdown(raw)
    if not chunks:
        return 0

    points: list[qm.PointStruct] = []
    collection_ensured = False
    cleared_existing_points = False

    for idx, chunk in enumerate(chunks):
        vec = await embed(_embedding_text(chunk, filename, visibility))

        if not collection_ensured:
            # The vector size depends on the embedding model.  We lazily create
            # the collection from the first real embedding to avoid relying on
            # a stale hardcoded dimension.
            await ensure_collection(len(vec))
            collection_ensured = True

        if not cleared_existing_points:
            # Re-ingestion should replace a document's prior chunk set instead
            # of duplicating it, otherwise retrieval quality degrades over time.
            await delete_points_by_document_id(document_id)
            cleared_existing_points = True

        points.append(
            qm.PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload={
                    # Payload fields are not embedded; they are stored as plain
                    # metadata for filtering, citation display, and debugging.
                    "text": chunk[:8000],
                    "document_id": document_id,
                    "source_path": file_path,
                    "filename": filename,
                    "visibility": visibility,
                    "chunk_index": idx,
                    "chunk_hash": hashlib.sha256(chunk.encode()).hexdigest()[:16],
                },
            )
        )

    await upsert_points(points)
    return len(points)
