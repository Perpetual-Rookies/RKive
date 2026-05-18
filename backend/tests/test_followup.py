import unittest

from rkive.services.followup import build_retrieval_query, is_context_dependent


class FollowupQueryTests(unittest.TestCase):
    def test_is_context_dependent_detects_vague_followup(self):
        self.assertTrue(is_context_dependent("Tell me more"))
        self.assertTrue(is_context_dependent("When is it closing?"))

    def test_is_context_dependent_leaves_specific_question_alone(self):
        self.assertFalse(is_context_dependent("Tell me about the HealthPlus infrastructure modernization project"))

    def test_build_retrieval_query_expands_followup_with_history(self):
        history = [
            {"role": "user", "content": "Tell me about sales data"},
            {
                "role": "assistant",
                "content": "HealthPlus is in proposal stage with a TCV of $3.5M and closes on September 10, 2026.",
            },
        ]

        query = build_retrieval_query("Tell me more", history)

        self.assertIn("Current question: Tell me more", query)
        self.assertIn("Previous user question: Tell me about sales data", query)
        self.assertIn("Previous assistant answer: HealthPlus is in proposal stage", query)

    def test_build_retrieval_query_keeps_self_contained_question(self):
        history = [{"role": "user", "content": "Tell me about sales data"}]

        query = build_retrieval_query(
            "Tell me about the Meridian project close date",
            history,
        )

        self.assertEqual(query, "Tell me about the Meridian project close date")
