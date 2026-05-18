"""Ollama embedding and streaming chat service."""

from collections.abc import AsyncGenerator
from ollama import AsyncClient

from rkive.config import get_llm_chat_model, get_embedding_model, get_ollama_base, get_embedder_base, get_llm_api_key


def _get_client() -> AsyncClient:
    headers = {}
    api_key = get_llm_api_key()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return AsyncClient(host=get_ollama_base(), headers=headers)


def _get_embedder_client() -> AsyncClient:
    headers = {}
    api_key = get_llm_api_key()
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return AsyncClient(host=get_embedder_base(), headers=headers)


async def embed(text: str) -> list[float]:
    """Return an embedding vector for *text* via the Ollama embeddings endpoint."""
    client = _get_embedder_client()
    # Using the standard embeddings endpoint
    resp = await client.embeddings(model=get_embedding_model(), prompt=text)
    
    embedding = resp.get("embedding")
    if not embedding:
        raise RuntimeError(f"Ollama returned no embedding: {resp}")
    return embedding


async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Yield text tokens from the Ollama /api/chat streaming endpoint."""
    client = _get_client()
    
    stream = await client.chat(
        model=get_llm_chat_model(),
        messages=messages,
        stream=True,
        # options={"temperature": 0.2}
    )
    
    async for chunk in stream:
        # Depending on ollama-python version, chunk might be a dict or a ChatResponse object
        if isinstance(chunk, dict):
            content = chunk.get("message", {}).get("content")
        else:
            content = chunk.message.content if hasattr(chunk, "message") else None
            
        if content:
            yield content
