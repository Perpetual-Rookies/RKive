import unittest

from rkive.services.followup import (
    build_retrieval_query,
    is_context_dependent,
    _find_anchor_question,
)


class FollowupQueryTests(unittest.TestCase):
    def test_is_context_dependent_detects_vague_followup(self):
        self.assertTrue(is_context_dependent("Tell me more"))
        self.assertTrue(is_context_dependent("Tell me again"))
        self.assertTrue(is_context_dependent("more detailed"))
        self.assertTrue(is_context_dependent("When is it closing?"))

    def test_is_context_dependent_leaves_specific_question_alone(self):
        self.assertFalse(
            is_context_dependent(
                "Tell me about the HealthPlus infrastructure modernization project"
            )
        )

    def test_find_anchor_question_returns_last_concrete_question(self):
        history = [
            {"role": "user", "content": "what do you know about sales"},
            {"role": "assistant", "content": "Here is the Q3 pipeline..."},
            {"role": "user", "content": "Tell me more"},
            {"role": "assistant", "content": "More details on the pipeline..."},
        ]
        anchor = _find_anchor_question(history)
        self.assertEqual(anchor, "what do you know about sales")

    def test_find_anchor_question_skips_chained_followups(self):
        history = [
            {"role": "user", "content": "what is the leave policy"},
            {"role": "assistant", "content": "Leave is 18 days per year..."},
            {"role": "user", "content": "Tell me more"},
            {"role": "assistant", "content": "You can carry forward 5 days..."},
            {"role": "user", "content": "Tell me again"},
            {"role": "assistant", "content": "As I said, 18 days..."},
        ]
        anchor = _find_anchor_question(history)
        self.assertEqual(anchor, "what is the leave policy")

    def test_find_anchor_question_returns_none_with_no_concrete_question(self):
        history = [
            {"role": "user", "content": "tell me more"},
            {"role": "assistant", "content": "Here is more..."},
        ]
        anchor = _find_anchor_question(history)
        self.assertIsNone(anchor)

    def test_build_retrieval_query_anchors_followup_to_topic(self):
        history = [
            {"role": "user", "content": "what do you know about sales"},
            {
                "role": "assistant",
                "content": "Based on Q3 pipeline: Global Finance Corp TCV $4.2M...",
            },
        ]

        query = build_retrieval_query("Tell me more", history)

        # Should be "what do you know about sales — Tell me more"
        self.assertIn("what do you know about sales", query)
        self.assertIn("Tell me more", query)

    def test_build_retrieval_query_chained_followups_stay_anchored(self):
        """After 'tell me more' → 'tell me again', anchor stays on original topic."""
        history = [
            {"role": "user", "content": "what do you know about sales"},
            {"role": "assistant", "content": "Q3 pipeline details..."},
            {"role": "user", "content": "Tell me more"},
            {"role": "assistant", "content": "More pipeline details..."},
        ]

        query = build_retrieval_query("Tell me again", history)

        # Both the anchor (sales) and the follow-up question should be in the query
        self.assertIn("what do you know about sales", query)
        self.assertIn("Tell me again", query)

    def test_build_retrieval_query_keeps_self_contained_question(self):
        history = [{"role": "user", "content": "Tell me about sales data"}]

        query = build_retrieval_query(
            "Tell me about the Meridian project close date",
            history,
        )

        self.assertEqual(query, "Tell me about the Meridian project close date")
