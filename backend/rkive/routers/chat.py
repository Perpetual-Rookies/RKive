"""WebSocket streaming RAG chat router."""

import json
import logging
import os
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from rkive.config import get_embedding_dim
from rkive.models.chat import Citation
from rkive.repositories.conversations import create_conversation, insert_message
from rkive.services.llm import chat_stream, embed
from rkive.services.qdrant import ensure_collection, search_similar

log = logging.getLogger("rkive.chat")

router = APIRouter()


def _msg(**kwargs) -> str:
    return json.dumps(kwargs)


def _preview(text: str, limit: int = 160) -> str:
    trimmed = " ".join(text.split())
    if len(trimmed) <= limit:
        return trimmed
    return f"{trimmed[:limit]}…"


def _safe_get_str(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    return str(value) if value is not None else ""


def _is_no_info_response(text: str) -> bool:
    normalized = " ".join(text.lower().split())
    return "do not have that information" in normalized or "don't have that information" in normalized


@router.websocket("/ws")
async def chat(ws: WebSocket):
    """
    Streaming RAG chat over WebSocket.

    Client sends:
        {"type": "chat", "content": "<question>", "conversationId": "<uuid|null>"}

    Server sends (in order):
        {"type": "conversation", "id": "<uuid>"}   – only on new conversation
        {"type": "token", "text": "…"}              – one per streamed token
        {"type": "citations", "citations": […]}
        {"type": "done"}
    or:
        {"type": "error", "message": "…"}
    """
    await ws.accept()
    log.info("websocket_connected")

    try:
        while True:
            # ── receive ──────────────────────────────────────────────────────
            try:
                payload = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                await ws.send_text(_msg(type="error", message="invalid JSON"))
                log.warning("invalid_json_payload")
                continue

            if payload.get("type") != "chat" or not str(payload.get("content", "")).strip():
                await ws.send_text(_msg(type="error", message="expected chat message"))
                log.warning(
                    "invalid_chat_payload",
                    extra={"payload_type": payload.get("type")},
                )
                continue

            question = str(payload["content"]).strip()
            conversation_id: str | None = payload.get("conversationId") or None
            role = _safe_get_str(payload, "role")
            visibility = _safe_get_str(payload, "visibility")
            log.info(
                "chat_message_received",
                extra={
                    "conversation_id": conversation_id,
                    "role": role,
                    "visibility": visibility,
                    "question_len": len(question),
                    "question_preview": _preview(question),
                },
            )

            # ── ensure vector collection exists ───────────────────────────────
            try:
                await ensure_collection(get_embedding_dim())
            except Exception as exc:
                await ws.send_text(_msg(type="error", message=str(exc)))
                log.exception("ensure_collection_failed")
                continue

            # ── conversation bookkeeping ──────────────────────────────────────
            if not conversation_id:
                conversation_id = await create_conversation()
                await ws.send_text(_msg(type="conversation", id=conversation_id))
                log.info(
                    "conversation_created",
                    extra={"conversation_id": conversation_id},
                )

            await insert_message(conversation_id, "user", question)

            # ── embed + retrieve ──────────────────────────────────────────────
            try:
                vector = await embed(question)
            except Exception as exc:
                await ws.send_text(_msg(type="error", message=str(exc)))
                log.exception(
                    "embedding_failed",
                    extra={"conversation_id": conversation_id},
                )
                continue

            hits = await search_similar(vector, limit=6)
            if hits:
                log.info(
                    "retrieval_hits",
                    extra={
                        "conversation_id": conversation_id,
                        "hit_count": len(hits),
                        "top_score": hits[0].score,
                    },
                )
            else:
                log.info(
                    "retrieval_hits",
                    extra={"conversation_id": conversation_id, "hit_count": 0},
                )

            context = "\n\n".join(
                f"[{i + 1}] source: {h.source_path or h.document_id}\n{h.text}"
                for i, h in enumerate(hits)
                if h.text
            )
            system_prompt = (
                "You are RKive, an internal org knowledge assistant. "
                "Answer using only the context below. "
                "If the answer is not in the context, say you do not have that information. "
                "Cite bracket numbers like [1] when you use a source.\n\n"
                f"Context:\n{context or '(no matching documents ingested yet)'}"
            )

            citations = [
                Citation(
                    document_id=h.document_id,
                    source_path=h.source_path,
                    score=h.score,
                )
                for h in hits
            ]

            # ── stream response ───────────────────────────────────────────────
            assistant_content = ""
            try:
                async for token in chat_stream(
                    [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": question},
                    ]
                ):
                    assistant_content += token
                    await ws.send_text(_msg(type="token", text=token))
            except Exception as exc:
                await ws.send_text(_msg(type="error", message=str(exc)))
                log.exception(
                    "chat_stream_failed",
                    extra={"conversation_id": conversation_id},
                )
                continue

            await insert_message(conversation_id, "assistant", assistant_content)
            log.info(
                "assistant_message_saved",
                extra={
                    "conversation_id": conversation_id,
                    "assistant_len": len(assistant_content),
                },
            )

            send_citations = not _is_no_info_response(assistant_content)

            await ws.send_text(
                _msg(
                    type="citations",
                    citations=(
                        [
                            {
                                "documentId": c.document_id,
                                "sourcePath": c.source_path,
                                "score": c.score,
                            }
                            for c in citations
                        ]
                        if send_citations
                        else []
                    ),
                )
            )
            await ws.send_text(_msg(type="done"))

    except WebSocketDisconnect:
        log.info("websocket_disconnected")
