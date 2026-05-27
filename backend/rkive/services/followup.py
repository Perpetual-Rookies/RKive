"""Helpers for conversation-aware retrieval queries.

The chat model should answer only from retrieved documents, but retrieval itself
needs help when the user asks follow-up questions such as "tell me more" or
"when is it closing".  This module resolves those vague turns into a more
standalone search query using recent conversation history.

Design principle: prefer false-negatives over false-positives.
A missed follow-up just retrieves slightly less context.
A false-positive follow-up hijacks the retrieval query with irrelevant history,
which actively hurts precision for self-contained questions.
"""

import logging
import re

log = logging.getLogger("rkive.followup")


# ── Tier 1: Explicit follow-up starters ──────────────────────────────────────
# These patterns at the START of a question almost always indicate a follow-up
# regardless of question length.  Low false-positive risk.
_EXPLICIT_FOLLOWUP_PATTERNS = [
    r"^tell me more\b",
    r"^tell me again\b",
    r"^what about\b",
    r"^how about\b",
    r"^what else\b",
    r"^and (what|how|when|who|why|where)\b",
    r"^more (details?|info|information)\b",
    r"^can you (elaborate|expand|explain more)\b",
    r"^elaborate\b",
    r"^go on\b",
    r"^continue\b",
    r"^give me more\b",
    r"^more detailed\b",
    r"^explain more\b",
]

# ── Tier 2: Pronoun-based follow-up signals ───────────────────────────────────
# These only trigger when the question is SHORT (see _PRONOUN_LENGTH_THRESHOLD).
# A long question that contains "it" is almost certainly self-contained;
# a 5-word question with "it" is almost certainly a reference to prior context.
_PRONOUN_PATTERNS = [
    r"\bit\b",
    r"\bthis\b",
    r"\bthat\b",
    r"\bthey\b",
    r"\bthem\b",
    r"\bthose\b",
    r"\btheir\b",
    r"\bthe same\b",
    r"\bthe above\b",
    r"\bthe previous\b",
]

# Questions shorter than this character count AND containing a pronoun pattern
# are treated as follow-ups.  Chosen to be longer than "what about it?" (14)
# but shorter than a typical self-contained question (60+).
_PRONOUN_LENGTH_THRESHOLD = 50

# Questions shorter than this are always treated as follow-ups regardless of
# content — they can't be self-contained with so few characters.
_ALWAYS_FOLLOWUP_LENGTH = 18


def _compact(text: str, limit: int = 220) -> str:
    """Normalize whitespace and cap long history snippets."""
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."


def is_context_dependent(question: str) -> bool:
    """Return True when a user turn likely depends on prior conversation.

    Two-tier detection:
    1. Very short questions (≤ 18 chars) — always a follow-up.
    2. Explicit follow-up starters (e.g. "tell me more") — always a follow-up.
    3. Pronoun-heavy short questions (≤ 50 chars with 'it', 'this', etc.)
       — likely a follow-up.

    Long, fully-specified questions pass through as-is even if they
    contain the word "it", preventing retrieval query hijacking.
    """
    normalized = " ".join(question.lower().split())

    # Tier 0: too short to be self-contained
    if len(normalized) <= _ALWAYS_FOLLOWUP_LENGTH:
        return True

    # Tier 1: explicit follow-up openers (low false-positive risk)
    if any(re.search(p, normalized) for p in _EXPLICIT_FOLLOWUP_PATTERNS):
        return True

    # Tier 2: pronoun signals only apply to short questions
    if len(normalized) <= _PRONOUN_LENGTH_THRESHOLD:
        if any(re.search(p, normalized) for p in _PRONOUN_PATTERNS):
            return True

    return False


def _find_anchor_question(history: list[dict[str, str]]) -> str | None:
    """Walk back through history and find the last self-contained user question.

    The 'anchor' is the most recent user turn that was NOT itself a follow-up
    (i.e. it had a concrete topic like 'what do you know about sales').
    Follow-up turns like 'tell me more', 'tell me again' are skipped.

    We look back up to 6 user turns to handle long chains of follow-ups.
    """
    user_turns_scanned = 0
    for message in reversed(history):
        role = str(message.get("role", "")).lower()
        content = str(message.get("content", "")).strip()
        if role != "user" or not content:
            continue
        user_turns_scanned += 1
        if user_turns_scanned > 6:
            break
        if not is_context_dependent(content):
            # This question had a concrete topic — it is the anchor
            return _compact(content, 200)
    return None


def build_retrieval_query(question: str, history: list[dict[str, str]]) -> str:
    """Build the text that will be embedded for retrieval.

    The result is still just a search query, not evidence.  Retrieved documents
    remain the only allowed grounding source for the final answer.

    Strategy — anchor-based query construction:

    When the current question is a vague follow-up ("tell me more", "tell me
    again", "more detailed"), we find the last *concrete* user question in
    history (the "anchor topic") and build the retrieval query as:

        {anchor topic} — {vague follow-up}

    Example:
        History:  User: "what do you know about sales"
        Current:  "Tell me again"
        Query:    "what do you know about sales — Tell me again"

    This keeps the retrieval embedding tightly focused on the original topic
    rather than drifting because "tell me again" has no meaningful signal.

    For multi-hop follow-ups (e.g. "tell me more" → "tell me again"),
    the anchor stays fixed on the last non-follow-up question, preventing
    compounding drift.

    IMPORTANT: We intentionally use ONLY user question text (not assistant
    answers) when building the retrieval query.  Assistant answers are
    topically broad — including them injects diverse unrelated keywords
    into the retrieval embedding, causing retrieval drift.
    """
    if not history or not is_context_dependent(question):
        return question

    anchor = _find_anchor_question(history)

    if anchor:
        # Build a focused, topic-anchored query.
        # The anchor provides the domain keywords; the current question
        # signals what aspect the user wants (more detail, specific field, etc.)
        expanded_query = f"{anchor} — {question}"
        log.info(
            "query_anchored_to_topic",
            extra={
                "original_question": question,
                "anchor": anchor,
                "expanded_query": expanded_query,
            },
        )
        return expanded_query

    # Fallback: no anchor found (e.g. very first question was already a follow-up).
    # Collect up to 3 prior user questions as context.
    _MAX_HISTORY_TURNS = 3
    _USER_COMPACT_LIMIT = 150

    prior_user_questions: list[str] = []
    for message in reversed(history):
        role = str(message.get("role", "")).lower()
        content = str(message.get("content", "")).strip()
        if not content:
            continue
        if role == "user":
            prior_user_questions.append(_compact(content, _USER_COMPACT_LIMIT))
            if len(prior_user_questions) >= _MAX_HISTORY_TURNS:
                break

    context_parts = [f"Current question: {question}"]
    for i, prev_q in enumerate(prior_user_questions):
        label = "Most recent" if i == 0 else f"Earlier ({i + 1} turns ago)"
        context_parts.append(f"{label} — User: {prev_q}")

    expanded_query = "\n".join(context_parts)
    log.info(
        "query_expanded_from_history",
        extra={
            "original_question": question,
            "expanded_length": len(expanded_query),
            "turns_used": len(prior_user_questions),
        },
    )
    return expanded_query
