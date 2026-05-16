"""Centralised settings – thin wrappers around os.environ."""

import os
from pathlib import Path


def get_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required")
    return url


def get_ollama_base() -> str:
    url = os.environ.get("OLLAMA_BASE_URL")
    if not url:
        raise RuntimeError("OLLAMA_BASE_URL is required")
    return url.rstrip("/")


def get_chat_model() -> str:
    return os.environ.get("OLLAMA_CHAT_MODEL", "llama3.2")


def get_embed_model() -> str:
    return os.environ.get("OLLAMA_EMBED_MODEL", "nomic-embed-text")


def get_qdrant_url() -> str:
    url = os.environ.get("QDRANT_URL")
    if not url:
        raise RuntimeError("QDRANT_URL is required")
    return url


def get_qdrant_collection() -> str:
    return os.environ.get("QDRANT_COLLECTION", "org-default")


def get_qdrant_api_key() -> str | None:
    return os.environ.get("QDRANT_API_KEY") or None


def get_embedding_dim() -> int:
    return int(os.environ.get("EMBEDDING_DIM", 768))


def get_upload_dir() -> Path:
    return Path(os.environ.get("UPLOAD_DIR", Path.cwd() / "data" / "uploads"))
