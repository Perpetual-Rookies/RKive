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


async def list_recent_messages(conversation_id: str, limit: int = 5) -> list[dict]:
    """Return the most recent messages for a conversation in chronological order."""
    async with get_conn() as conn:
        row = await conn.fetchone(
            """
            SELECT COALESCE(
                json_agg(item ORDER BY item.created_at),
                '[]'::json
            ) AS messages
            FROM (
                SELECT role, content, created_at
                FROM messages
                WHERE conversation_id = %s
                ORDER BY created_at DESC
                LIMIT %s
            ) AS item
            """,
            (conversation_id, limit),
        )
    return list(row["messages"])
