"""Domain models for chat conversations, messages, and citations."""

from dataclasses import dataclass, field


@dataclass
class Citation:
    document_id: str
    source_path: str
    score: float
    filename: str = ""


@dataclass
class ChatMessage:
    role: str  # system | user | assistant
    content: str
