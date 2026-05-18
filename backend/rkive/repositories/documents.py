"""Repository for documents and ingestion jobs (raw SQL via psycopg3)."""

from rkive.db import get_conn


async def insert_document(filename: str, storage_path: str, checksum: str) -> str:
    """Insert a new document row and return its UUID."""
    async with get_conn() as conn:
        row = await conn.fetchone(
            """
            INSERT INTO documents (id, filename, storage_path, checksum)
            VALUES (gen_random_uuid(), %s, %s, %s)
            RETURNING id
            """,
            (filename, storage_path, checksum),
        )
    return str(row["id"])


async def get_document(doc_id: str) -> dict | None:
    """Retrieve a document by ID."""
    async with get_conn() as conn:
        row = await conn.fetchone_optional(
            "SELECT id, filename, storage_path, checksum, created_at FROM documents WHERE id = %s",
            (doc_id,),
        )
    return dict(row) if row else None


async def get_document_by_checksum(checksum: str) -> dict | None:
    """Retrieve a document by checksum."""
    async with get_conn() as conn:
        row = await conn.fetchone_optional(
            """
            SELECT id, filename, storage_path, checksum, created_at
            FROM documents
            WHERE checksum = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (checksum,),
        )
    return dict(row) if row else None


async def insert_ingestion_job(document_id: str) -> str:
    """Create a new ingestion job in 'running' state and return its UUID."""
    async with get_conn() as conn:
        row = await conn.fetchone(
            """
            INSERT INTO ingestion_jobs (id, document_id, status, started_at)
            VALUES (gen_random_uuid(), %s, 'running', now())
            RETURNING id
            """,
            (document_id,),
        )
    return str(row["id"])


async def update_job_succeeded(job_id: str) -> None:
    """Mark an ingestion job as succeeded."""
    async with get_conn() as conn:
        await conn.execute(
            "UPDATE ingestion_jobs SET status = 'succeeded', finished_at = now() WHERE id = %s",
            (job_id,),
        )


async def update_job_failed(job_id: str, error: str) -> None:
    """Mark an ingestion job as failed with an error message."""
    async with get_conn() as conn:
        await conn.execute(
            """
            UPDATE ingestion_jobs
            SET status = 'failed', error_message = %s, finished_at = now()
            WHERE id = %s
            """,
            (error, job_id),
        )
