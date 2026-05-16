"""Qdrant vector store service."""

from dataclasses import dataclass
from functools import lru_cache

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm

from rkive.config import get_qdrant_api_key, get_qdrant_collection, get_qdrant_url


@lru_cache(maxsize=1)
def get_client() -> AsyncQdrantClient:
    """Return a cached singleton Qdrant async client."""
    return AsyncQdrantClient(url=get_qdrant_url(), api_key=get_qdrant_api_key())


async def ensure_collection(vector_size: int) -> None:
    """Create the collection if it does not already exist."""
    client = get_client()
    name = get_qdrant_collection()
    cols = await client.get_collections()
    existing = {c.name for c in cols.collections}
    if name not in existing:
        await client.create_collection(
            collection_name=name,
            vectors_config=qm.VectorParams(size=vector_size, distance=qm.Distance.COSINE),
        )


async def upsert_points(points: list[qm.PointStruct]) -> None:
    """Upsert a batch of points into the configured collection."""
    await get_client().upsert(collection_name=get_qdrant_collection(), points=points)


@dataclass
class SearchHit:
    id: str
    score: float
    text: str
    document_id: str
    source_path: str


async def search_similar(vector: list[float], limit: int = 6) -> list[SearchHit]:
    """Return the *limit* nearest neighbours for *vector*."""
    response = await get_client().query_points(
        collection_name=get_qdrant_collection(),
        query=vector,
        limit=limit,
        with_payload=True,
    )
    results = response.points
    return [
        SearchHit(
            id=str(r.id),
            score=r.score or 0.0,
            text=str((r.payload or {}).get("text", "")),
            document_id=str((r.payload or {}).get("document_id", "")),
            source_path=str((r.payload or {}).get("source_path", "")),
        )
        for r in results
    ]
