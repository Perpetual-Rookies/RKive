"""Ollama embedding and streaming chat service."""

from collections.abc import AsyncGenerator

import httpx

from rkive.config import get_chat_model, get_embed_model, get_ollama_base


async def embed(text: str) -> list[float]:
    """Return an embedding vector for *text* via the Ollama /api/embeddings endpoint."""
    url = f"{get_ollama_base()}/api/embeddings"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json={"model": get_embed_model(), "prompt": text})
        resp.raise_for_status()
    data = resp.json()
    embedding = data.get("embedding")
    if not embedding:
        raise RuntimeError(f"Ollama returned no embedding: {data}")
    return embedding


async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Yield text tokens from the Ollama /api/chat streaming endpoint."""
    url = f"{get_ollama_base()}/api/chat"
    payload = {"model": get_chat_model(), "messages": messages, "stream": True}
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
                content = (chunk.get("message") or {}).get("content")
                if content:
                    yield content
