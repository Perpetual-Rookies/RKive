"""Unified LLM provider.

This project intentionally uses a single HTTP LLM endpoint to keep the flow
simple. Configure model names via env vars.
"""

from collections.abc import AsyncGenerator
import json
import logging

import httpx

log = logging.getLogger("rkive.llm")

from rkive.config import (
    get_embedding_api_key,
    get_embedding_base_url,
    get_embedding_model,
    get_llm_api_key,
    get_llm_chat_model,
    get_llm_base_url,
)


def _headers() -> dict[str, str]:
    api_key = get_llm_api_key()
    if not api_key:
        return {}
    return {"Authorization": f"Bearer {api_key}"}


def _embedding_headers() -> dict[str, str]:
    api_key = get_embedding_api_key()
    if not api_key:
        return {}
    return {"Authorization": f"Bearer {api_key}"}


async def embed(text: str) -> list[float]:
    """Return an embedding vector for *text* via the configured embeddings endpoint."""
    url = f"{get_embedding_base_url()}/api/embeddings"
    payload = {"model": get_embedding_model(), "prompt": text}
    log.info("llm_embedding_started", extra={"model": get_embedding_model(), "text_length": len(text)})
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, json=payload, headers=_embedding_headers())
        resp.raise_for_status()
        data = resp.json()
    embedding = data.get("embedding") if isinstance(data, dict) else None
    if not embedding:
        raise RuntimeError(f"Embedding endpoint returned no embedding: {data!r}")
    log.info("llm_embedding_completed", extra={"model": get_embedding_model(), "vector_length": len(embedding)})
    return list(embedding)


async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Yield streamed chat tokens via the configured chat endpoint."""
    url = f"{get_llm_base_url()}/api/chat"
    payload = {"model": get_llm_chat_model(), "messages": messages, "stream": True}

    # Finite timeout guards against Ollama process stalls.
    # - connect/write are tight: fail fast if the daemon is unreachable.
    # - read is generous (180 s): long documents can take time to generate.
    # timeout=None was the previous value and caused indefinite SSE hangs.
    _timeout = httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=5.0)
    log.info("llm_chat_stream_started", extra={"model": get_llm_chat_model(), "messages_count": len(messages)})
    async with httpx.AsyncClient(timeout=_timeout) as client:
        async with client.stream("POST", url, json=payload, headers=_headers()) as resp:
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                # Read the body of the error response (e.g., {"error":"model '...' not found"})
                await resp.aread()
                body = resp.text
                log.error("llm_http_error", extra={"status": resp.status_code, "body": body})
                # Attempt to extract JSON error message if present
                try:
                    err_msg = json.loads(body).get("error", body)
                except json.JSONDecodeError:
                    err_msg = body
                raise RuntimeError(f"LLM API Error ({resp.status_code}): {err_msg}") from exc

            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if not isinstance(chunk, dict):
                    continue

                content = None
                message = chunk.get("message")
                if isinstance(message, dict):
                    content = message.get("content")
                if not content:
                    content = chunk.get("response")

                if content:
                    yield str(content)
            log.info("llm_chat_stream_completed", extra={"model": get_llm_chat_model()})
