"""Database connection and migration helpers (psycopg3 async)."""

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncGenerator

import psycopg
from psycopg.rows import dict_row

from rkive.config import get_database_url


async def run_migrations() -> None:
    """Apply SQL migrations in order (each file should be idempotent)."""
    migrations_dir = Path(__file__).parent.parent / "migrations"
    migration_files = sorted(migrations_dir.glob("*.sql"))
    if not migration_files:
        return
    async with await psycopg.AsyncConnection.connect(get_database_url(), autocommit=True) as conn:
        for path in migration_files:
            await conn.execute(path.read_text())


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

    async def fetchall(self, query: str, params: tuple = ()) -> list[dict[str, Any]]:
        async with self._conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(query, params)
            rows = await cur.fetchall()
            await self._conn.commit()
            return list(rows)  # type: ignore[return-value]


@asynccontextmanager
async def get_conn() -> AsyncGenerator[_Conn, None]:
    """Yield a _Conn backed by a fresh psycopg async connection."""
    async with await psycopg.AsyncConnection.connect(get_database_url()) as conn:
        yield _Conn(conn)
