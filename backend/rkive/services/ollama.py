"""Ollama embedding and streaming chat service."""

from collections.abc import AsyncGenerator

import httpx

from rkive.config import get_llm_chat_model, get_embedding_model, get_ollama_base


async def embed(text: str) -> list[float]:
    """Return an embedding vector for *text* via the Ollama embeddings endpoint."""
    base = get_ollama_base()
    urls = (f"{base}/api/embeddings", f"{base}/api/embed")
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(urls[0], json={"model": get_embedding_model(), "prompt": text})
        if resp.status_code == 404:
            # Ollama versions differ on embeddings endpoint naming.
            resp = await client.post(urls[1], json={"model": get_embedding_model(), "prompt": text})
        resp.raise_for_status()
    data = resp.json()
    # Ollama may return either a dict or a list. Normalize to a dict-like object.
    if isinstance(data, list):
        data_item = data[0] if data else {}
    else:
        data_item = data or {}

    # Support a few response shapes ('embedding' key, 'values' nested, or raw list)
    embedding = None
    if isinstance(data_item, dict):
        embedding = data_item.get("embedding") or (data_item.get("values") if isinstance(data_item.get("values"), list) else None)
    elif isinstance(data_item, list):
        embedding = data_item

    if not embedding:
        raise RuntimeError(f"Ollama returned no embedding: {data}")
    return embedding


async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Yield text tokens from the Ollama /api/chat streaming endpoint."""
    url = f"{get_ollama_base()}/api/chat"
    payload = {"model": get_llm_chat_model(), "messages": messages, "stream": True}
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", url, json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                import json as _json
                try:
                    chunk = _json.loads(line)
                except ValueError:
                    continue
                if isinstance(chunk, list):
                    chunk = chunk[0] if chunk else {}
                content = (chunk.get("message") or {}).get("content")
                if content:
                    yield content
