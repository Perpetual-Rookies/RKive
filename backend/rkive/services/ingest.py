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


def _extract_heading(section: str) -> str:
    """Return the leading markdown heading line from a section, or empty string."""
    first_line = section.lstrip().split("\n")[0]
    if re.match(r"^#{1,6}\s", first_line):
        return first_line.strip()
    return ""


def _sentence_aware_carry(text: str, overlap: int) -> str:
    """Extract a carry snippet that starts at a sentence boundary.

    Rather than slicing the raw last *overlap* characters (which can land
    mid-word or mid-sentence), we look for the last sentence-ending punctuation
    within the overlap window and start the carry from the sentence that follows
    it.  This gives the next chunk a coherent, complete opening sentence instead
    of a fragment.

    Falls back to the raw character slice if no boundary is found.

    Example:
        text = "Hello. This is a sentence. And another."
        overlap = 25  # Looks back 25 chars, finds the '.' after "sentence"
        Returns: "And another."
    """
    if len(text) <= overlap:
        return text.strip()

    window = text[-overlap:]
    # Find the last sentence boundary within the window
    # e.g. for window "...end of sentence. Start of next", boundary is at "."
    boundary = max(
        window.rfind(". "),
        window.rfind(".\n"),
        window.rfind("? "),
        window.rfind("! "),
        window.rfind(";\n"),
    )
    if boundary != -1 and boundary < len(window) - 1:
        # Carry starts at the sentence that follows the boundary
        # e.g. returns "Start of next"
        return window[boundary + 2:].strip()
    # No boundary found — fall back to raw slice from a word boundary
    # e.g. splits mid-phrase if no punctuation exists
    space = window.rfind(" ")
    if space != -1:
        return window[space + 1:].strip()
    return window.strip()


def chunk_markdown(text: str, max_chars: int = 1500, overlap: int = 200) -> list[str]:
    """
    Split *text* into semantically coherent chunks.

    Strategy:
    1. Split on markdown headings (preserving the heading line).
    2. If a section still exceeds *max_chars*, further split on blank lines.
    3. If a paragraph alone exceeds *max_chars*, split near sentence-ish
       boundaries with sentence-aware overlap into the next chunk.
    4. The section heading is prepended to *every* sub-chunk produced from
       that section, so retrieval quality is not lost on later paragraphs.

    The main goal is retrieval quality, not perfect markdown preservation.
    Smaller, focused chunks generally retrieve better than one very large block.

    Example:
        Input: "# Leave\nYou get 20 days.\n\n# IT\nUse a Mac."
        Returns: ["# Leave\n\nYou get 20 days.", "# IT\n\nUse a Mac."]
    """
    text = text.strip()
    if not text:
        return []
    result = _chunk_with_heading_context(text, max_chars, overlap)
    return [c for c in result if c.strip()]


def _chunk_with_heading_context(text: str, max_chars: int, overlap: int) -> list[str]:
    """Internal implementation that attaches headings to all sub-chunks."""
    sections = re.split(r"(?m)(?=^#{1,6}\s)", text)
    chunks: list[str] = []

    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue

        heading = _extract_heading(sec)

        if len(sec) <= max_chars:
            chunks.append(sec)
            continue

        paras = re.split(r"\n\n+", sec)
        buf = ""
        section_chunks: list[str] = []

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
                    section_chunks.append(buf)
                    # Use sentence-aware carry so the next chunk begins at a
                    # clean sentence boundary, not mid-fragment.
                    carry = _sentence_aware_carry(buf, overlap)
                    buf = f"{carry}\n\n{para_part}".strip() if carry else para_part
                else:
                    buf = para_part

                if len(buf) > max_chars:
                    para_splits = _split_large_paragraph(buf, max_chars, overlap)
                    section_chunks.extend(para_splits[:-1])
                    buf = para_splits[-1]

        if buf:
            section_chunks.append(buf)

        # Prepend heading to every sub-chunk after the first (first already
        # contains the heading as the section starts with it).
        # e.g. chunk = "# Parent Heading\n\nThis is paragraph 2"
        for i, chunk in enumerate(section_chunks):
            if i > 0 and heading and not chunk.startswith(heading):
                chunk = f"{heading}\n\n{chunk}"
            chunks.append(chunk)

    return chunks


def _embedding_text(chunk: str, filename: str) -> str:
    """Build the text sent to the embedding model for a stored document chunk.

    We embed the chunk content (and optionally the filename) but **do not** embed
    the visibility label, because visibility is stored as metadata and filtered
    separately.
    """
    return f"search_document: {chunk}\nFilename: {filename}"


def _extract_document_title(text: str) -> str:
    """Return the first H1 heading from the document, or empty string.

    Used as a human-readable document title in payloads.  The title helps the
    LLM attribute answers correctly (e.g. 'From the Leave Policy document...')
    and improves citation display in the UI.
    """
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            return stripped[2:].strip()
    return ""


def _extract_chunk_heading(chunk: str) -> str:
    """Return the markdown heading that this chunk belongs to, or empty string.

    Since Fix 1.2 guarantees that every sub-chunk starts with its section
    heading, we can reliably extract it from the first line.
    """
    first_line = chunk.lstrip().split("\n")[0].strip()
    if re.match(r"^#{1,6}\s", first_line):
        # Strip the markdown '#' symbols to give a clean text label.
        return re.sub(r"^#{1,6}\s+", "", first_line).strip()
    return ""


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

    # Extract document-level metadata once — not per chunk.
    document_title = _extract_document_title(raw)

    for idx, chunk in enumerate(chunks):
        emb_text = _embedding_text(chunk, filename)
        vec = await embed(emb_text)

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
                    # ── Content ────────────────────────────────────────────
                    # text: the raw chunk shown to the LLM and UI.
                    # embedding_text: the exact string sent to the embedding
                    #   model (includes nomic prefix + filename hint).  Stored
                    #   for auditability and future re-indexing without drift.
                    "text": chunk[:8000],
                    "embedding_text": emb_text[:8000],
                    # ── Document metadata ──────────────────────────────────
                    "document_id": document_id,
                    "document_title": document_title,
                    "source_path": file_path,
                    "filename": filename,
                    # ── Chunk metadata ─────────────────────────────────────
                    "section_heading": _extract_chunk_heading(chunk),
                    "visibility": visibility,
                    "chunk_index": idx,
                    "chunk_hash": hashlib.sha256(chunk.encode()).hexdigest()[:16],
                },
            )
        )

    await upsert_points(points)
    return len(points)
