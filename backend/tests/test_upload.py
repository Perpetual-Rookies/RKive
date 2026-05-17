import io
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import UploadFile

from rkive.routers.upload import upload


class UploadTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_reuses_existing_document_for_duplicate_content(self):
        existing_doc = {
            "id": "doc-existing",
            "storage_path": "/tmp/existing-policy.md",
        }

        with (
            patch("rkive.routers.upload.get_document_by_checksum", AsyncMock(return_value=existing_doc)),
            patch("rkive.routers.upload.insert_document", AsyncMock()) as insert_document,
            patch("rkive.routers.upload.insert_ingestion_job", AsyncMock(return_value="job-1")),
            patch("rkive.routers.upload.ingest_file", AsyncMock(return_value=4)) as ingest_file,
            patch("rkive.routers.upload.update_job_succeeded", AsyncMock()),
        ):
            result = await upload(
                UploadFile(filename="policy.md", file=io.BytesIO(b"# Policy\n\nQuarterly sales policy")),
                visibility="public",
            )

        insert_document.assert_not_awaited()
        ingest_file.assert_awaited_once_with(
            "/tmp/existing-policy.md",
            "doc-existing",
            "policy.md",
            "Org Level (Public)",
        )
        self.assertEqual(result["documentId"], "doc-existing")
        self.assertEqual(result["jobId"], "job-1")
        self.assertEqual(result["chunks"], 4)
        self.assertTrue(result["deduplicated"])
