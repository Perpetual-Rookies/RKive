"""HTTP SSE streaming RAG chat router.

This module coordinates the online part of the RAG pipeline:
1. Receive the user's question via HTTP POST
2. Embed the question as a vector
3. Retrieve candidate chunks from Qdrant
4. Rerank those chunks
5. Build a grounded prompt for the chat model
6. Stream the answer back as Server-Sent Events (SSE)

The actual retrieval and reranking rules live in service modules so the router
stays focused on request orchestration.
"""

import json
import logging

from typing import Any, AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from rkive.config import get_embedding_dim
from rkive.models.chat import Citation
from rkive.repositories.conversations import (
    create_conversation,
    insert_message,
    list_messages,
    list_recent_messages,
)
from rkive.services.followup import build_retrieval_query, is_context_dependent
from rkive.services.llm import chat_stream, embed
from rkive.services.qdrant import ensure_collection, search_similar
from rkive.services.rerank import rerank_hits
from rkive.visibility import DEFAULT_VISIBILITY, ORG_PUBLIC, SALES_PRIVATE

log = logging.getLogger("rkive.chat")

router = APIRouter()


def _safe_get_str(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    return str(value) if value is not None else ""


def _preview(text: str, limit: int = 160) -> str:
    trimmed = " ".join(text.split())
    if len(trimmed) <= limit:
        return trimmed
    return f"{trimmed[:limit]}…"


def _sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _hit_key(hit) -> str:
    return f"{hit.filename}|{hit.source_path}|{hit.document_id}"


def _is_no_info_response(text: str) -> bool:
    """Detect the fallback phrase used when no grounded answer exists."""
    normalized = " ".join(text.lower().split())
    return "do not have that information" in normalized or "don't have that information" in normalized





_MIN_SCORE_THRESHOLD = 0.40  # Drop Qdrant hits below relevance floor.
# nomic-embed-text cosine scores below ~0.40 are near-random for typical
# HR/knowledge-base queries.  Raising the floor ensures only semantically
# relevant chunks reach the LLM context window.



def _group_hits_for_context(hits, max_sources: int = 6, max_chunks_per_source: int = 2):
    """Group chunk-level hits into document-level sources for prompt context.

    We want strong grounding without bloating the prompt:
    - show up to *max_sources* distinct documents
    - include up to *max_chunks_per_source* chunks per document

    The UI expects one citation per document, but the model often needs more
    than one chunk from the same document to answer correctly.

    Example:
        Input: [DocA_Chunk3, DocA_Chunk1, DocB_Chunk2, DocA_Chunk5]
        Result: 
            Source 1 (DocA): [Chunk3, Chunk1]  # Chunk5 dropped (max 2 per source)
            Source 2 (DocB): [Chunk2]
    """
    grouped: dict[str, dict[str, Any]] = {}
    order: list[str] = []

    for hit in hits:
        key = _hit_key(hit)
        if key not in grouped:
            grouped[key] = {
                "best": hit,
                "chunks": [],
            }
            order.append(key)
        else:
            # Keep the highest-scoring hit as the representative citation for this document
            # e.g. if Chunk 2 scores 0.8 and Chunk 1 scores 0.6, we cite using Chunk 2's metadata
            if hit.score > grouped[key]["best"].score:
                grouped[key]["best"] = hit

        # Collect text from multiple chunks in the same document
        # e.g. Doc A -> [Chunk 1 text, Chunk 2 text]
        if hit.text and len(grouped[key]["chunks"]) < max_chunks_per_source:
            grouped[key]["chunks"].append(hit.text)

        # Stop early if we have enough distinct documents, and each document has enough chunks
        # e.g. if max_sources=2, we stop when we have 2 docs with 2 chunks each
        if len(order) >= max_sources and all(
            len(grouped[k]["chunks"]) >= max_chunks_per_source for k in order
        ):
            break

    # Preserve retrieval order, capped to max_sources.
    return [grouped[key] for key in order[:max_sources]]


async def _stream_chat(payload: dict[str, Any]) -> AsyncGenerator[str, None]:
    log.info("sse_chat_stream_started")
    if payload.get("type") != "chat" or not str(payload.get("content", "")).strip():
        yield _sse({"type": "error", "message": "expected chat message"})
        log.warning("sse_chat_invalid_payload")
        return

    raw_input = str(payload["content"]).strip()
    question = raw_input

    conversation_id: str | None = payload.get("conversationId") or None
    role = _safe_get_str(payload, "role") or "employee"
    visibility = _safe_get_str(payload, "visibility") or DEFAULT_VISIBILITY

    allowed_visibility = [ORG_PUBLIC]
    if role == "Sales Representative":
        allowed_visibility = [ORG_PUBLIC, SALES_PRIVATE]
    elif role == "Standard Employee":
        allowed_visibility = [ORG_PUBLIC]

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

    try:
        await ensure_collection(get_embedding_dim())
    except Exception as exc:
        log.exception("ensure_collection_failed")
        yield _sse({"type": "error", "message": str(exc)})
        return

    if not conversation_id:
        conversation_id = await create_conversation()
        yield _sse({"type": "conversation", "id": conversation_id})
        log.info(
            "conversation_created",
            extra={"conversation_id": conversation_id},
        )

    history = await list_recent_messages(conversation_id, limit=6)
    await insert_message(conversation_id, "user", question)

    llm_question = question
    # Note: follow-up expansion is handled at the *retrieval* level via
    # build_retrieval_query().  The LLM naturally handles follow-ups through
    # conversation history — we do NOT mangle the user turn here.
    # The old "Elaborate on the previous answer. {question}" injection was
    # syntactically confusing to the model and caused double-instruction issues.

    try:
        retrieval_query = build_retrieval_query(question, history)
        vector = await embed(f"search_query: {retrieval_query}")
    except Exception as exc:
        log.exception("embedding_failed", extra={"conversation_id": conversation_id})
        yield _sse({"type": "error", "message": str(exc)})
        return

    # Retrieve fewer chunks (10 instead of 20) to strictly bound the CPU reranking time. 
    # Reranking is O(N) with the number of chunks, so halving this cuts the max inference time in half.
    hits = await search_similar(vector, limit=10, allowed_visibility=allowed_visibility)
    # Drop obviously irrelevant hits before reranking.
    hits = [h for h in hits if h.score >= _MIN_SCORE_THRESHOLD]
    
    # Run the heavy CPU math in a background thread so we don't block the FastAPI async event loop
    import asyncio
    hits = await asyncio.to_thread(rerank_hits, question, hits)
    
    grouped_sources = _group_hits_for_context(hits, max_sources=6, max_chunks_per_source=3)
    cited_hits = [source["best"] for source in grouped_sources]

    if cited_hits:
        log.info(
            "retrieval_hits",
            extra={
                "conversation_id": conversation_id,
                "hit_count": len(cited_hits),
                "top_score": cited_hits[0].score,
            },
        )
    else:
        log.info(
            "retrieval_hits",
            extra={"conversation_id": conversation_id, "hit_count": 0},
        )

    context_blocks: list[str] = []
    for i, source in enumerate(grouped_sources):
        best = source["best"]
        chunks = source["chunks"]
        if not chunks:
            continue
        label = best.filename or best.source_path or best.document_id
        block_lines: list[str] = [f"[{i + 1}] {label}"]
        for j, chunk in enumerate(chunks):
            # Strip the Nomic search_document prefix before sending to LLM.
            clean = chunk
            if clean.startswith("search_document:"):
                clean = clean[len("search_document:"):].strip()
            if j > 0:
                # Separator between chunks from the same source so the LLM
                # can distinguish passage boundaries rather than seeing a wall
                # of text.
                block_lines.append("---")
            block_lines.append(clean)
        context_blocks.append("\n".join(block_lines))

    # ── Token budget management ──────────────────────────────────────────────
    # gemma4:31b:cloud has a 128K-token context window.  We use a conservative
    # 32K working budget so output tokens are never squeezed.
    # We estimate tokens as chars / 4 (standard heuristic for English prose;
    # gemma4 SentencePiece averages ~3.5–4 chars/token).
    #
    # Budget allocation (tokens):
    #   System prompt static text  ~    500
    #   Context blocks             ~ 10 000   ← trimmed below if needed
    #   Conversation history       ~  4 000   ← oldest messages dropped first
    #   Current question           ~    500
    #   Output buffer              ~ 16 000   ← generous for long answers
    #   Safety headroom            ~  1 192
    #   ─────────────────────────────────────
    #   Total                      ~ 32 192   (out of 128K available)
    _CHARS_PER_TOKEN = 4
    _CONTEXT_CHAR_BUDGET = 10_000 * _CHARS_PER_TOKEN   # 40 000 chars
    _HISTORY_CHAR_BUDGET = 4_000 * _CHARS_PER_TOKEN    # 16 000 chars

    def _trim_to_token_budget(blocks: list[str], budget_chars: int) -> str:
        """Join blocks until the char budget is exhausted; drop remaining."""
        kept: list[str] = []
        used = 0
        for block in blocks:
            if used + len(block) > budget_chars:
                log.warning(
                    "context_trimmed",
                    extra={"dropped_blocks": len(blocks) - len(kept), "budget_chars": budget_chars},
                )
                break
            kept.append(block)
            used += len(block)
        return "\n\n".join(kept)

    context = _trim_to_token_budget(context_blocks, _CONTEXT_CHAR_BUDGET)

    system_prompt = (
        "You are RKive, an internal knowledge assistant for R Systems International. "
        "Answer using ONLY the document excerpts in the Context section below.\n\n"
        "RULES:\n"
        "1. Base your answer solely on the provided Context. Do not invent facts.\n"
        "2. If the Context does not contain enough information, say: "
        "'I don't have that information in the knowledge base. Please contact the relevant team.'\n"
        "3. Cite sources with bracket numbers like [1] after each relevant sentence.\n"
        "4. If the user asks about THEIR OWN personal HR data — specifically using words like "
        "'my salary', 'my leave balance', 'my payslip', 'my performance review' — say: "
        "'For personal HR information, please log in to the MyRSystems portal and navigate to the MyHR section.' "
        "General policy questions (e.g. 'how many leave days do employees get?') should be answered from the Context.\n"
        "5. Match response length to the question: detailed policy questions deserve comprehensive answers "
        "with bullet points or numbered lists; simple lookups should be concise. Always be professional.\n"
        "6. STAY ON TOPIC: When the user asks a vague follow-up (e.g. 'tell me more', 'tell me again', "
        "'what else'), look at the Conversation History to determine what topic was being discussed, "
        "and provide more depth on THAT topic only. Do NOT switch to or summarize unrelated topics. "
        "If the context retrieved is about the same topic, expand on it. "
        "If you cannot elaborate further on the topic, say so directly.\n\n"
        f"Context:\n{context or '(No relevant documents found.)'}"
    )

    citations = [
        Citation(
            document_id=h.document_id,
            source_path=h.source_path,
            score=h.score,
            filename=h.filename,
        )
        for h in cited_hits
    ]

    assistant_content = ""
    # Build messages: system prompt + conversation history (budget-capped) + question.
    llm_messages: list[dict] = [{"role": "system", "content": system_prompt}]

    # Trim history to budget: keep the most recent messages, drop oldest first.
    history_chars = 0
    capped_history: list[dict] = []
    for msg in reversed(history):
        role_h = str(msg.get("role", "")).lower()
        content_h = str(msg.get("content", "")).strip()
        if role_h in ("user", "assistant") and content_h:
            if history_chars + len(content_h) <= _HISTORY_CHAR_BUDGET:
                capped_history.append({"role": role_h, "content": content_h})
                history_chars += len(content_h)
            else:
                log.warning("history_trimmed", extra={"dropped_from": "oldest"})
                break
    for msg in reversed(capped_history):
        llm_messages.append(msg)

    llm_messages.append({"role": "user", "content": llm_question})
    try:
        async for token in chat_stream(llm_messages):
            assistant_content += token
            yield _sse({"type": "token", "text": token})
    except Exception as exc:
        log.exception("chat_stream_failed", extra={"conversation_id": conversation_id})
        yield _sse({"type": "error", "message": str(exc)})
        return

    # ── Post-process content and citations ───────────────────────────────────
    import re
    # Extract unique cited indices in order of appearance in the response
    cited_numbers = []
    for num_str in re.findall(r"\[(\d+)\]", assistant_content):
        num = int(num_str)
        if num not in cited_numbers:
            cited_numbers.append(num)

    filtered_citations = []
    num_map = {}
    for i, orig_idx_1 in enumerate(cited_numbers):
        orig_idx = orig_idx_1 - 1
        if 0 <= orig_idx < len(citations):
            filtered_citations.append(citations[orig_idx])
            num_map[orig_idx_1] = i + 1

    if filtered_citations:
        def replace_cite(match):
            old_num = int(match.group(1))
            new_num = num_map.get(old_num)
            return f"[{new_num}]" if new_num is not None else match.group(0)
        
        assistant_content = re.sub(r"\[(\d+)\]", replace_cite, assistant_content)
        citations = filtered_citations
        send_citations = not _is_no_info_response(assistant_content)
    else:
        citations = []
        send_citations = False

    await insert_message(
        conversation_id,
        "assistant",
        assistant_content,
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
    log.info(
        "assistant_message_saved",
        extra={
            "conversation_id": conversation_id,
            "assistant_len": len(assistant_content),
        },
    )

    log.info(
        "sse_chat_completed",
        extra={
            "conversation_id": conversation_id,
            "assistant_len": len(assistant_content),
            "citations_sent": send_citations,
        },
    )
    yield _sse(
        {
            "type": "citations",
            "content": assistant_content,
            "citations": (
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
        }
    )
    yield _sse({"type": "done"})


@router.post("/api/chat")
async def chat_http(payload: dict[str, Any]):
    """HTTP streaming chat endpoint (SSE)."""
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")
    return StreamingResponse(
        _stream_chat(payload),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str):
    """Return the full message history for a conversation."""
    messages = await list_messages(conversation_id)
    return {"messages": messages}


