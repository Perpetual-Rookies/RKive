"""Health check router."""

from fastapi import APIRouter, HTTPException

from rkive.config import get_llm_chat_model, get_qdrant_collection
from rkive.db import get_conn
from rkive.services.qdrant import get_client

router = APIRouter()


@router.get("/health")
async def health():
    """Liveness/readiness probe – checks Postgres and Qdrant connectivity."""
    errors: list[str] = []

    try:
        async with get_conn() as conn:
            await conn.execute("SELECT 1")
    except Exception as exc:
        errors.append(f"postgres: {exc}")

    try:
        await get_client().get_collections()
    except Exception as exc:
        errors.append(f"qdrant: {exc}")

    if errors:
        raise HTTPException(status_code=503, detail={"ok": False, "errors": errors})

    return {
        "ok": True,
        "qdrant_collection": get_qdrant_collection(),
        "chat_model": get_llm_chat_model(),
    }
