"""services package."""
from rkive.services.llm import embed, chat_stream
from rkive.services.qdrant import ensure_collection, search_similar, upsert_points, get_client
from rkive.services.ingest import chunk_markdown, ingest_file
from rkive.services.followup import build_retrieval_query, is_context_dependent
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
    "build_retrieval_query",
    "is_context_dependent",
    "rerank_hits",
]
