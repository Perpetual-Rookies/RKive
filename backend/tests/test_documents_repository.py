import unittest
from unittest.mock import AsyncMock

from rkive.repositories.documents import get_document, get_document_by_checksum


class _ConnContext:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class DocumentsRepositoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_document_returns_none_when_missing(self):
        conn = AsyncMock()
        conn.fetchone = AsyncMock(return_value=None)

        with unittest.mock.patch(
            "rkive.repositories.documents.get_conn",
            return_value=_ConnContext(conn),
        ):
            result = await get_document("missing-doc")

        self.assertIsNone(result)
        conn.fetchone.assert_awaited_once()
        self.assertEqual(conn.fetchone.await_args.kwargs["required"], False)

    async def test_get_document_by_checksum_returns_none_when_missing(self):
        conn = AsyncMock()
        conn.fetchone = AsyncMock(return_value=None)

        with unittest.mock.patch(
            "rkive.repositories.documents.get_conn",
            return_value=_ConnContext(conn),
        ):
            result = await get_document_by_checksum("missing-checksum")

        self.assertIsNone(result)
        conn.fetchone.assert_awaited_once()
        self.assertEqual(conn.fetchone.await_args.kwargs["required"], False)
