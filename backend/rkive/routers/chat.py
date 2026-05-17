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

            raw_input = str(payload["content"]).strip()
            # -- Prompt injection defence --
            question = raw_input

            conversation_id: str | None = payload.get("conversationId") or None
            role = _safe_get_str(payload, "role") or "employee"
            visibility = _safe_get_str(payload, "visibility")

            allowed_visibility = ["Org Level (Public)"]
            if role == "Sales Representative":
                allowed_visibility = ["Org Level (Public)", "Sales Project (Private)"]
            elif role == "Standard Employee":
                allowed_visibility = ["Org Level (Public)"]

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
                vector = await embed(f"search_query: {question}")
            except Exception as exc:
                await ws.send_text(_msg(type="error", message=str(exc)))
                log.exception(
                    "embedding_failed",
                    extra={"conversation_id": conversation_id},
                )
                continue

            hits = await search_similar(vector, limit=6, allowed_visibility=allowed_visibility)
            SIMILARITY_THRESHOLD = 0.45
            hits = [h for h in hits if h.score >= SIMILARITY_THRESHOLD]

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
                f"[{i + 1}] source: {h.filename or h.source_path or h.document_id}\n{h.text.replace('search_document:', '', 1).strip()}"
                for i, h in enumerate(hits)
                if h.text
            )
            system_prompt = (
                "You are RKive, a strictly grounded internal knowledge assistant for R Systems. "
                "Your ONLY job is to answer questions using the document Context provided below.\n\n"
                "RULES:\n"
                "1. ONLY use information from the Context section. DO NOT use external knowledge.\n"
                "2. If the Context DOES NOT contain the answer to the user's question, you MUST respond EXACTLY with this sentence and nothing else: "
                "'I don't have that information in the knowledge base. Please contact the relevant team.'\n"
                "3. You may respond naturally to greetings (hi, hello) but still mention you use the knowledge base.\n"
                "4. Always cite your sources using bracket numbers like [1] at the end of the relevant sentence.\n"
                "5. If a user asks about personal employee data (leave balance, salary, performance review, payslips), "
                "respond EXACTLY with this sentence and nothing else: 'For personal HR information, please log in to the MyRSystems portal and navigate to the MyHR section.'\n"
                "6. Keep your answer concise and professional. Do not add extra commentary.\n\n"
                f"Context:\n{context or '(No relevant documents found in the knowledge base.)'}"
            )

            citations = [
                Citation(
                    document_id=h.document_id,
                    source_path=h.source_path,
                    score=h.score,
                    filename=h.filename,
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
                                "filename": c.filename,
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
