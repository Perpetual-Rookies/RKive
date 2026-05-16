"""Generic LLM provider dispatcher."""

from collections.abc import AsyncGenerator
from functools import lru_cache

from rkive.config import get_llm_provider
from rkive.services import gemini as gemini_provider
from rkive.services import ollama as ollama_provider


@lru_cache(maxsize=1)
def _provider_name() -> str:
    return get_llm_provider()


def _provider_module():
    provider = _provider_name()
    if provider == "ollama":
        return ollama_provider
    if provider == "gemini":
        return gemini_provider
    raise RuntimeError(f"Unsupported LLM_PROVIDER: {provider!r}")


async def embed(text: str) -> list[float]:
    return await _provider_module().embed(text)


async def chat_stream(messages: list[dict]) -> AsyncGenerator[str, None]:
    async for token in _provider_module().chat_stream(messages):
        yield token