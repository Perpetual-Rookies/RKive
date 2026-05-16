"""Domain models (dataclasses) for documents and ingestion jobs."""

from dataclasses import dataclass
from datetime import datetime


@dataclass
class Document:
    id: str
    filename: str
    storage_path: str
    checksum: str | None
    created_at: datetime | None = None
    created_by: str | None = None


@dataclass
class IngestionJob:
    id: str
    document_id: str
    status: str  # pending | running | succeeded | failed
    error_message: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
