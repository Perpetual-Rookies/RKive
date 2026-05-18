import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from rkive.services.ingest import chunk_markdown, ingest_file


class ChunkingTests(unittest.TestCase):
    def test_chunk_markdown_adds_overlap_between_adjacent_chunks(self):
        text = "# Policy\n\n" + " ".join(f"word{i:02d}" for i in range(1, 60))

        chunks = chunk_markdown(text, max_chars=80, overlap=18)

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 80 for chunk in chunks))

        first_tail_words = chunks[0].split()[-3:]
        second_head_words = chunks[1].split()[:6]
        self.assertTrue(set(first_tail_words) & set(second_head_words))


class IngestFileTests(unittest.IsolatedAsyncioTestCase):
    async def test_ingest_file_embeds_metadata_and_replaces_existing_vectors(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "policy.md"
            source.write_text("# Policy\n\nQuarterly sales policy update.", encoding="utf-8")

            call_order: list[str] = []
            captured: dict[str, object] = {}

            async def fake_embed(text: str) -> list[float]:
                call_order.append("embed")
                captured["embed_text"] = text
                return [0.1, 0.2, 0.3]

            async def fake_ensure_collection(size: int) -> None:
                call_order.append(f"ensure:{size}")

            async def fake_delete_points(document_id: str) -> None:
                call_order.append(f"delete:{document_id}")

            async def fake_upsert_points(points) -> None:
                call_order.append("upsert")
                captured["points"] = points

            with (
                patch("rkive.services.ingest.embed", side_effect=fake_embed),
                patch("rkive.services.ingest.ensure_collection", side_effect=fake_ensure_collection),
                patch("rkive.services.ingest.delete_points_by_document_id", side_effect=fake_delete_points),
                patch("rkive.services.ingest.upsert_points", side_effect=fake_upsert_points),
            ):
                count = await ingest_file(
                    str(source),
                    document_id="doc-123",
                    filename="policy.md",
                    visibility="public",
                )

            self.assertEqual(count, 1)
            self.assertEqual(call_order, ["embed", "ensure:3", "delete:doc-123", "upsert"])

            embed_text = captured["embed_text"]
            self.assertIn("search_document:", embed_text)
            self.assertIn("filename: policy.md", embed_text)
            self.assertIn("visibility: Org Level (Public)", embed_text)
            self.assertIn("Quarterly sales policy update.", embed_text)

            points = captured["points"]
            self.assertEqual(len(points), 1)
            self.assertEqual(points[0].payload["visibility"], "Org Level (Public)")
            self.assertEqual(points[0].payload["document_id"], "doc-123")
