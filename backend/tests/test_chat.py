import unittest

from rkive.routers.chat import _group_hits_for_context
from rkive.services.qdrant import SearchHit
from rkive.services.rerank import rerank_hits


class ChatRankingTests(unittest.TestCase):
    def test_rerank_hits_boosts_text_and_filename_overlap(self):
        hits = [
            SearchHit(
                id="weak-dense",
                score=0.70,
                text="Sales policy for enterprise discount approvals.",
                document_id="doc-1",
                source_path="/docs/sales.md",
                filename="sales-policy.md",
            ),
            SearchHit(
                id="strong-dense",
                score=0.75,
                text="General employee onboarding handbook.",
                document_id="doc-2",
                source_path="/docs/hr.md",
                filename="handbook.md",
            ),
        ]

        ranked = rerank_hits("sales policy", hits)

        self.assertEqual(ranked[0].id, "weak-dense")
        self.assertEqual(len(ranked), 2)

    def test_group_hits_for_context_keeps_one_highest_score_hit_per_document(self):
        hits = [
            SearchHit(
                id="chunk-1",
                score=0.61,
                text="Earlier chunk from the same file.",
                document_id="doc-1",
                source_path="/docs/sales.md",
                filename="sales.md",
            ),
            SearchHit(
                id="chunk-2",
                score=0.78,
                text="Better chunk from the same file.",
                document_id="doc-1",
                source_path="/docs/sales.md",
                filename="sales.md",
            ),
            SearchHit(
                id="chunk-3",
                score=0.55,
                text="Chunk from a different file.",
                document_id="doc-2",
                source_path="/docs/pricing.md",
                filename="pricing.md",
            ),
        ]

        grouped = _group_hits_for_context(hits, max_sources=2, max_chunks_per_source=2)

        self.assertEqual(len(grouped), 2)
        self.assertEqual(grouped[0]["best"].id, "chunk-2")
        self.assertEqual(grouped[1]["best"].id, "chunk-3")
