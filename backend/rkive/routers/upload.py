"""File upload and ingestion router."""

import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, Form
from fastapi.responses import FileResponse

from rkive.config import get_upload_dir
from rkive.repositories.documents import (
    get_document,
    get_document_by_checksum,
    insert_document,
    insert_ingestion_job,
    update_job_failed,
    update_job_succeeded,
    list_all_documents,
    delete_document,
    update_document_visibility,
)
from rkive.services.ingest import ingest_file
from rkive.services.pdf import extract_text_from_pdf
from rkive.services.qdrant import delete_points_by_document_id
from rkive.visibility import DEFAULT_VISIBILITY, normalize_visibility

router = APIRouter(prefix="/api")

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB


@router.post("/upload")
async def upload(file: UploadFile = File(...), visibility: str = Form(DEFAULT_VISIBILITY)):
    """
    Accept a markdown (.md) or PDF (.pdf) file, persist it to disk, record metadata in
    Postgres, run the Qdrant ingestion pipeline, and return the result.
    """
    filename = file.filename or ""
    file_ext = Path(filename).suffix.lower()
    
    # Check file type
    if file_ext == ".pdf":
        content_type = "application/pdf"
    elif file_ext == ".md":
        content_type = "text/markdown"
    else:
        raise HTTPException(status_code=400, detail="Only markdown (.md) and PDF (.pdf) files are allowed")
    
    # Validate content type
    if file.content_type not in (content_type, "text/plain"):
        if not (file_ext == ".pdf" and file.content_type == "application/pdf"):
            raise HTTPException(status_code=400, detail="Only markdown (.md) and PDF (.pdf) files are allowed")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    checksum = hashlib.sha256(contents).hexdigest()

    visibility = normalize_visibility(visibility)
    existing_doc = await get_document_by_checksum(checksum)

    if existing_doc:
        doc_id = str(existing_doc["id"])
        dest = Path(str(existing_doc["storage_path"]))
        if existing_doc.get("visibility") != visibility:
            await update_document_visibility(doc_id, visibility)
    else:
        upload_dir = get_upload_dir()
        upload_dir.mkdir(parents=True, exist_ok=True)
        dest = upload_dir / f"{uuid.uuid4()}{file_ext}"
        dest.write_bytes(contents)
        doc_id = await insert_document(filename, str(dest), checksum, visibility)

    job_id = await insert_ingestion_job(doc_id)

    try:
        # Extract text from PDF if needed
        if file_ext == ".pdf":
            extracted_text = extract_text_from_pdf(contents)
            # Create a temporary markdown file for ingestion
            temp_dest = dest.parent / f"{dest.stem}.md"
            temp_dest.write_text(extracted_text, encoding="utf-8")
            chunks = await ingest_file(str(temp_dest), doc_id, filename, visibility)
        else:
            chunks = await ingest_file(str(dest), doc_id, filename, visibility)
            
        await update_job_succeeded(job_id)
        return {
            "documentId": doc_id,
            "jobId": job_id,
            "chunks": chunks,
            "deduplicated": existing_doc is not None,
        }
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
        media_type="text/plain",
        content_disposition_type="inline"
    )


@router.get("/documents")
async def list_documents():
    """List all uploaded documents with metadata."""
    documents = await list_all_documents()
    return {
        "documents": [
            {
                "id": doc["id"],
                "filename": doc["filename"],
                "created_at": doc["created_at"].isoformat() if doc["created_at"] else None,
                "file_type": "PDF" if doc["filename"].lower().endswith(".pdf") else "Markdown",
                "visibility": doc.get("visibility") or DEFAULT_VISIBILITY,
            }
            for doc in documents
        ]
    }


@router.delete("/documents/{doc_id}")
async def remove_document(doc_id: str):
    """Delete a document by ID, including all associated vectors in Qdrant."""
    doc = await get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Delete embeddings from Qdrant (RAG consistency: remove from all storage layers)
    await delete_points_by_document_id(doc_id)
    
    # Delete the file from disk storage
    storage_path = Path(doc["storage_path"])
    if storage_path.exists():
        storage_path.unlink()
    
    # Also delete any temporary markdown file created from PDF extraction
    if doc["filename"].lower().endswith(".pdf"):
        temp_md = storage_path.parent / f"{storage_path.stem}.md"
        if temp_md.exists():
            temp_md.unlink()
    
    # Delete from database
    deleted = await delete_document(doc_id)
    
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return {"status": "deleted", "documentId": doc_id}
