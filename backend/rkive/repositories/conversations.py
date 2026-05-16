"""Repository for conversations and messages (raw SQL via psycopg3)."""

from rkive.db import get_conn


async def create_conversation() -> str:
    """Insert a new conversation row and return its UUID."""
    async with get_conn() as conn:
        row = await conn.fetchone(
            "INSERT INTO conversations DEFAULT VALUES RETURNING id"
        )
    return str(row["id"])


async def insert_message(conversation_id: str, role: str, content: str) -> None:
    """Append a message to a conversation."""
    async with get_conn() as conn:
        await conn.execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (%s, %s, %s)",
            (conversation_id, role, content),
        )
