"""Centralised settings – single cached settings object with thin wrappers."""

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    llm_provider: str = "gemini"
    llm_api_key: str | None = None
    llm_chat_model: str = "gemini-2.5-flash"
    embedding_model: str = "text-embedding-004"
    ollama_base_url: str = "http://host.docker.internal:11434"
    embedder_base_url: str = "http://host.docker.internal:11434"
    qdrant_url: str = ""
    qdrant_collection: str = "org-default"
    qdrant_api_key: str | None = None
    embedding_dim: int = 768
    upload_dir: Path = Path.cwd() / "data" / "uploads"

    def __post_init__(self) -> None:
        object.__setattr__(self, "llm_provider", self.llm_provider.strip().lower())
        object.__setattr__(self, "ollama_base_url", self.ollama_base_url.rstrip("/"))
        object.__setattr__(self, "upload_dir", Path(self.upload_dir))

    @property
    def chat_model(self) -> str:
        return self.llm_chat_model

    @property
    def embed_model(self) -> str:
        return self.embedding_model


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is required")

    qdrant_url = os.environ.get("QDRANT_URL")
    if not qdrant_url:
        raise RuntimeError("QDRANT_URL is required")

    return Settings(
        database_url=database_url,
        llm_provider=os.environ.get("LLM_PROVIDER", "gemini"),
        llm_api_key=os.environ.get("LLM_API_KEY") or None,
        llm_chat_model=os.environ.get("LLM_CHAT_MODEL", "gemini-2.5-flash"),
        embedding_model=os.environ.get("EMBEDDING_MODEL", "text-embedding-004"),
        ollama_base_url=os.environ.get("OLLAMA_BASE_URL", "https://api.ollama.com"),
        embedder_base_url=os.environ.get("EMBEDDER_BASE_URL", "http://host.docker.internal:11434"),
        qdrant_url=qdrant_url,
        qdrant_collection=os.environ.get("QDRANT_COLLECTION", "org-default"),
        qdrant_api_key=os.environ.get("QDRANT_API_KEY") or None,
        embedding_dim=int(os.environ.get("EMBEDDING_DIM", 768)),
        upload_dir=Path(os.environ.get("UPLOAD_DIR", Path.cwd() / "data" / "uploads")),
    )


def get_database_url() -> str:
    return get_settings().database_url


def get_llm_provider() -> str:
    return get_settings().llm_provider


def get_llm_api_key() -> str | None:
    return get_settings().llm_api_key


def get_llm_chat_model() -> str:
    return get_settings().llm_chat_model


def get_embedding_model() -> str:
    return get_settings().embedding_model


def get_ollama_base() -> str:
    return get_settings().ollama_base_url

def get_embedder_base() -> str:
    return get_settings().embedder_base_url


def get_qdrant_url() -> str:
    return get_settings().qdrant_url


def get_qdrant_collection() -> str:
    return get_settings().qdrant_collection


def get_qdrant_api_key() -> str | None:
    return get_settings().qdrant_api_key


def get_embedding_dim() -> int:
    return get_settings().embedding_dim


def get_upload_dir() -> Path:
    return get_settings().upload_dir
