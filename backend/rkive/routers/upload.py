"""File upload and ingestion router."""

import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, Form
from fastapi.responses import FileResponse

from rkive.config import get_upload_dir
from rkive.repositories.documents import (
    insert_document,
    get_document,
    insert_ingestion_job,
    update_job_failed,
    update_job_succeeded,
)
from rkive.services.ingest import ingest_file

router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/upload")
async def upload(file: UploadFile = File(...), visibility: str = Form("public")):
    """
    Accept a markdown (.md) file, persist it to disk, record metadata in
    Postgres, run the Qdrant ingestion pipeline, and return the result.
    """
    filename = file.filename or ""
    if not filename.lower().endswith(".md") and file.content_type not in (
        "text/markdown",
        "text/plain",
    ):
        raise HTTPException(status_code=400, detail="Only markdown (.md) files are allowed")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    checksum = hashlib.sha256(contents).hexdigest()

    upload_dir = get_upload_dir()
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / f"{uuid.uuid4()}{Path(filename).suffix or '.md'}"
    dest.write_bytes(contents)

    doc_id = await insert_document(filename, str(dest), checksum)
    job_id = await insert_ingestion_job(doc_id)

    try:
        chunks = await ingest_file(str(dest), doc_id, filename, visibility)
        await update_job_succeeded(job_id)
        return {"documentId": doc_id, "jobId": job_id, "chunks": chunks}
    except Exception as exc:
        err = str(exc)
        await update_job_failed(job_id, err)
        raise HTTPException(
            status_code=500,
            detail={"documentId": doc_id, "jobId": job_id, "error": err},
        )
@router.get("/documents/{doc_id}")
async def download_document(doc_id: str):
    """Serve a previously uploaded markdown file by its document ID."""
    doc = await get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    storage_path = Path(doc["storage_path"])
    if not storage_path.exists():
        raise HTTPException(status_code=404, detail="File missing from storage")
        
    return FileResponse(
        path=storage_path,
        filename=doc["filename"],
        media_type="text/markdown"
    )