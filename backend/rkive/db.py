"""Database connection and migration helpers (psycopg3 async)."""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator

import psycopg
from psycopg.rows import dict_row

from rkive.config import get_database_url


async def run_migrations() -> None:
    """Apply the init SQL migration idempotently (uses IF NOT EXISTS DDL)."""
    sql_path = Path(__file__).parent.parent / "migrations" / "0000_init.sql"
    sql = sql_path.read_text()
    async with await psycopg.AsyncConnection.connect(get_database_url(), autocommit=True) as conn:
        await conn.execute(sql)


class _Conn:
    """
    Thin wrapper around psycopg AsyncConnection.

    - Commits after every execute / fetchone so callers don't need to think
      about transaction management for simple CRUD operations.
    """

    def __init__(self, conn: psycopg.AsyncConnection) -> None:
        self._conn = conn

    async def execute(self, query: str, params: tuple = ()) -> None:
        await self._conn.execute(query, params)
        await self._conn.commit()

    async def fetchone_optional(self, query: str, params: tuple = ()) -> dict[str, Any] | None:
        async with self._conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(query, params)
            row = await cur.fetchone()
            await self._conn.commit()
            return row  # type: ignore[return-value]

    async def fetchone(self, query: str, params: tuple = ()) -> dict[str, Any]:
        row = await self.fetchone_optional(query, params)
        if row is None:
            raise RuntimeError(f"Expected one row, got none for: {query!r}")
        return row


@asynccontextmanager
async def get_conn() -> AsyncGenerator[_Conn, None]:
    """Yield a _Conn backed by a fresh psycopg async connection."""
    async with await psycopg.AsyncConnection.connect(get_database_url()) as conn:
        yield _Conn(conn)
