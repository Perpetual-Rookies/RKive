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
from rkive.services.qdrant import ensure_collection, upsert_points


def chunk_markdown(text: str, max_chars: int = 1200) -> list[str]:
    """
    Split *text* into semantically coherent chunks.

    Strategy:
    1. Split on markdown headings (preserving the heading line).
    2. If a section still exceeds *max_chars*, further split on blank lines.
    3. If a paragraph alone exceeds *max_chars*, hard-split it.
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
            if len(buf) + len(para) + 2 <= max_chars:
                buf = f"{buf}\n\n{para}".strip() if buf else para
            else:
                if buf:
                    chunks.append(buf)
                buf = para
                while len(buf) > max_chars:
                    chunks.append(buf[:max_chars])
                    buf = buf[max_chars:]
        if buf:
            chunks.append(buf)

    return [c for c in chunks if c.strip()]


async def ingest_file(file_path: str, document_id: str, filename: str, visibility: str = "public") -> int:
    """
    Read *file_path*, chunk it, embed each chunk via Ollama, and upsert
    the resulting points into Qdrant.

    Returns the number of chunks stored (0 if the file is empty).
    """
    with open(file_path, encoding="utf-8") as fh:
        raw = fh.read()

    chunks = chunk_markdown(raw)
    if not chunks:
        return 0

    points: list[qm.PointStruct] = []
    collection_ensured = False

    for idx, chunk in enumerate(chunks):
        vec = await embed(chunk)

        if not collection_ensured:
            await ensure_collection(len(vec))
            collection_ensured = True

        points.append(
            qm.PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload={
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
