"""Qdrant vector store service."""

from dataclasses import dataclass
from functools import lru_cache
import logging

from qdrant_client import AsyncQdrantClient
from qdrant_client.http import models as qm

log = logging.getLogger("rkive.qdrant")

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


async def delete_points_by_document_id(document_id: str) -> None:
    """Delete existing points for a document before re-ingesting it."""
    await get_client().delete(
        collection_name=get_qdrant_collection(),
        points_selector=qm.FilterSelector(
            filter=qm.Filter(
                must=[
                    qm.FieldCondition(
                        key="document_id",
                        match=qm.MatchValue(value=document_id),
                    )
                ]
            )
        ),
    )


@dataclass
class SearchHit:
    id: str
    score: float
    text: str
    document_id: str
    source_path: str
    filename: str


async def search_similar(
    vector: list[float],
    limit: int = 6,
    allowed_visibility: list[str] | None = None,
) -> list[SearchHit]:
    """Return the *limit* nearest neighbours for *vector*.

    Args:
        vector: Query embedding vector.
        limit: Maximum number of results to return.
        allowed_visibility: Whitelist of visibility labels to filter by.
            - ``None``  → no filter applied (returns all documents).
            - ``[]``    → filter applied with no allowed values (returns nothing).
            - ``["Org Level (Public)"]`` → only public documents returned.

    Using ``is not None`` (not truthiness) is intentional: an empty list must
    still apply the filter (returning 0 results) rather than bypassing it and
    leaking private documents to callers that pass an empty whitelist by mistake.
    """
    query_filter = None
    if allowed_visibility is not None:
        query_filter = qm.Filter(
            must=[
                qm.FieldCondition(
                    key="visibility",
                    match=qm.MatchAny(any=allowed_visibility)
                )
            ]
        )

    log.info("qdrant_search_started", extra={"limit": limit, "allowed_visibility": allowed_visibility})
    response = await get_client().query_points(
        collection_name=get_qdrant_collection(),
        query=vector,
        query_filter=query_filter,
        limit=limit,
        with_payload=True,
    )
    results = response.points
    log.info("qdrant_search_completed", extra={"hits_returned": len(results)})
    return [
        SearchHit(
            id=str(r.id),
            score=r.score or 0.0,
            text=str((r.payload or {}).get("text", "")),
            document_id=str((r.payload or {}).get("document_id", "")),
            source_path=str((r.payload or {}).get("source_path", "")),
            filename=str((r.payload or {}).get("filename", "")),
        )
        for r in results
    ]
