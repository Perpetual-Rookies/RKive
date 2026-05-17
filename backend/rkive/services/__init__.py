"""services package."""
from rkive.services.llm import embed, chat_stream
from rkive.services.qdrant import ensure_collection, search_similar, upsert_points, get_client
from rkive.services.ingest import chunk_markdown, ingest_file
from rkive.services.rerank import rerank_hits

__all__ = [
    "embed",
    "chat_stream",
    "ensure_collection",
    "search_similar",
    "upsert_points",
    "get_client",
    "chunk_markdown",
    "ingest_file",
    "rerank_hits",
]
