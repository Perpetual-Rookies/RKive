"""Centralised settings – single cached settings object with thin wrappers."""

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    llm_api_key: str | None = None
    embedding_api_key: str | None = None
    llm_chat_model: str = "llama3.1"
    embedding_model: str = "nomic-embed-text"
    llm_base_url: str = "http://host.docker.internal:11434"
    embedding_base_url: str = "http://host.docker.internal:11434"
    qdrant_url: str = ""
    qdrant_collection: str = "org-default"
    qdrant_api_key: str | None = None
    embedding_dim: int = 768
    upload_dir: Path = Path.cwd() / "data" / "uploads"

    def __post_init__(self) -> None:
        object.__setattr__(self, "upload_dir", Path(self.upload_dir))

        object.__setattr__(self, "llm_base_url", self.llm_base_url.rstrip("/"))
        object.__setattr__(self, "embedding_base_url", self.embedding_base_url.rstrip("/"))

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
        llm_api_key=os.environ.get("LLM_API_KEY") or None,
        embedding_api_key=os.environ.get("EMBEDDING_API_KEY") or None,
        llm_chat_model=os.environ.get("LLM_CHAT_MODEL", "llama3.1"),
        embedding_model=os.environ.get("EMBEDDING_MODEL", "nomic-embed-text"),
        llm_base_url=os.environ.get("LLM_BASE_URL", "http://host.docker.internal:11434"),
        embedding_base_url=os.environ.get(
            "EMBEDDING_BASE_URL",
            os.environ.get("LLM_BASE_URL", "http://host.docker.internal:11434"),
        ),
        qdrant_url=qdrant_url,
        qdrant_collection=os.environ.get("QDRANT_COLLECTION", "org-default"),
        qdrant_api_key=os.environ.get("QDRANT_API_KEY") or None,
        embedding_dim=int(os.environ.get("EMBEDDING_DIM", 768)),
        upload_dir=Path(os.environ.get("UPLOAD_DIR", Path.cwd() / "data" / "uploads")),
    )


def get_database_url() -> str:
    return get_settings().database_url


def get_llm_api_key() -> str | None:
    return get_settings().llm_api_key


def get_embedding_api_key() -> str | None:
    return get_settings().embedding_api_key


def get_llm_chat_model() -> str:
    return get_settings().llm_chat_model


def get_embedding_model() -> str:
    return get_settings().embedding_model


def get_llm_base_url() -> str:
    return get_settings().llm_base_url


def get_embedding_base_url() -> str:
    return get_settings().embedding_base_url


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
