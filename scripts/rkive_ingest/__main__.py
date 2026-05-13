import argparse
import hashlib
import json
import os
import re
import sys
import uuid

import httpx
from qdrant_client import QdrantClient
from qdrant_client.http import models as qm


def chunk_markdown(text: str, max_chars: int = 1200) -> list[str]:
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


def embed(ollama_base: str, model: str, text: str) -> list[float]:
    url = f"{ollama_base.rstrip('/')}/api/embeddings"
    r = httpx.post(
        url,
        json={"model": model, "prompt": text},
        timeout=120.0,
    )
    r.raise_for_status()
    data = r.json()
    emb = data.get("embedding")
    if not emb:
        raise RuntimeError(f"No embedding in response: {data}")
    return emb


def run_ingest(path: str, document_id: str) -> int:
    ollama_base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    embed_model = os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")
    qdrant_url = os.environ.get("QDRANT_URL", "http://127.0.0.1:6333")
    qdrant_key = os.environ.get("QDRANT_API_KEY") or None
    collection = os.environ.get("QDRANT_COLLECTION", "org-default")

    with open(path, encoding="utf-8") as f:
        raw = f.read()

    chunks = chunk_markdown(raw)
    if not chunks:
        print(json.dumps({"chunks": 0}))
        return 0

    client = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    points: list[qm.PointStruct] = []
    first_vec: list[float] | None = None

    for idx, chunk in enumerate(chunks):
        vec = embed(ollama_base, embed_model, chunk)
        if first_vec is None:
            first_vec = vec
            size = len(vec)
            cols = client.get_collections().collections
            names = {c.name for c in cols}
            if collection not in names:
                client.create_collection(
                    collection_name=collection,
                    vectors_config=qm.VectorParams(size=size, distance=qm.Distance.COSINE),
                )
        pid = str(uuid.uuid4())
        h = hashlib.sha256(chunk.encode()).hexdigest()[:16]
        points.append(
            qm.PointStruct(
                id=pid,
                vector=vec,
                payload={
                    "text": chunk[:8000],
                    "document_id": document_id,
                    "source_path": path,
                    "chunk_index": idx,
                    "chunk_hash": h,
                },
            )
        )

    client.upsert(collection_name=collection, points=points)
    print(json.dumps({"chunks": len(points)}))
    return len(points)


def main() -> None:
    p = argparse.ArgumentParser(prog="rkive_ingest")
    sub = p.add_subparsers(dest="cmd", required=True)
    ingest = sub.add_parser("ingest")
    ingest.add_argument("path", help="Path to markdown file")
    ingest.add_argument("--document-id", required=True, help="UUID of documents row")

    args = p.parse_args()
    if args.cmd == "ingest":
        run_ingest(args.path, args.document_id)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)
