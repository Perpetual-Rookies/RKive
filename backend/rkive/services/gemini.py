"""Gemini provider implementation using the google.genai SDK."""

from collections.abc import AsyncGenerator
from functools import lru_cache
import asyncio
import queue
import threading

import google.genai as genai
from google.genai import types

from rkive.config import get_llm_api_key, get_llm_chat_model, get_embedding_model


_SENTINEL = object()


def _api_key() -> str:
    key = get_llm_api_key()
    if not key:
        raise RuntimeError("LLM_API_KEY is required for Gemini")
    return key


@lru_cache(maxsize=1)
def _client() -> genai.Client:
    return genai.Client(api_key=_api_key())


def _to_gemini_contents(messages: list[dict]) -> tuple[str | None, list[dict]]:
    system_parts: list[str] = []
    contents: list[dict] = []

    for message in messages:
        role = str(message.get("role", "user")).lower()
        text = str(message.get("content", ""))
        if not text:
            continue
        if role == "system":
            system_parts.append(text)
            continue

        gemini_role = "model" if role == "assistant" else "user"
        contents.append({"role": gemini_role, "parts": [{"text": text}]})

    system_instruction = "\n\n".join(system_parts).strip() or None
    return system_instruction, contents


def _extract_text(chunk: object) -> str | None:
    text = getattr(chunk, "text", None)
    if text:
        return str(text)

    candidates = getattr(chunk, "candidates", None)
    if not candidates:
        return None

    first = candidates[0]
    content = getattr(first, "content", None)
    if not content:
        return None

    parts = getattr(content, "parts", None) or []
    for part in parts:
        part_text = getattr(part, "text", None)
        if part_text:
            return str(part_text)
    return None


def _extract_embedding(response: object) -> list[float]:
    embeddings = getattr(response, "embeddings", None)
    if embeddings:
        first = embeddings[0]
        values = getattr(first, "values", None) or getattr(first, "embedding", None)
        if values:
            return list(values)

    data = getattr(response, "data", None)
    if data:
        first = data[0]
        values = getattr(first, "embedding", None)
        if values:
            return list(values)

    embedding = getattr(response, "embedding", None)
    if embedding:
        if isinstance(embedding, dict):
            values = embedding.get("values") or embedding.get("embedding")
            if values:
                return list(values)
        elif isinstance(embedding, list):
            return list(embedding)

    raise RuntimeError(f"Gemini returned no embedding: {response!r}")


async def embed(text: str) -> list[float]:
    """Return an embedding vector via the google.genai SDK."""

    def _embed_sync() -> list[float]:
        response = _client().models.embed_content(
            model=get_embedding_model(),
            contents=text,
            config=types.EmbedContentConfig(),
        )
        return _extract_embedding(response)

    return await asyncio.to_thread(_embed_sync)


async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Yield streamed text chunks via the google.genai SDK."""
    system_instruction, contents = _to_gemini_contents(messages)

    def _worker(output: queue.Queue[object]) -> None:
        try:
            config = types.GenerateContentConfig(
                system_instruction=system_instruction,
            )
            stream = _client().models.generate_content_stream(
                model=get_llm_chat_model(),
                contents=contents,
                config=config,
            )
            for chunk in stream:
                text = _extract_text(chunk)
                if text:
                    output.put(text)
        except Exception as exc:
            output.put(exc)
        finally:
            output.put(_SENTINEL)

    output: queue.Queue[object] = queue.Queue()
    threading.Thread(target=_worker, args=(output,), daemon=True).start()

    while True:
        item = await asyncio.to_thread(output.get)
        if item is _SENTINEL:
            break
        if isinstance(item, Exception):
            raise item
        yield str(item)