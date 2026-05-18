"""Helpers for conversation-aware retrieval queries.

The chat model should answer only from retrieved documents, but retrieval itself
needs help when the user asks follow-up questions such as "tell me more" or
"when is it closing".  This module resolves those vague turns into a more
standalone search query using recent conversation history.
"""

import re


_FOLLOWUP_PATTERNS = [
    r"^tell me more\b",
    r"^what about\b",
    r"^how about\b",
    r"^what else\b",
    r"^and (what|how|when|who|why)\b",
    r"^more\b",
    r"\bit\b",
    r"\bthis\b",
    r"\bthat\b",
    r"\bthey\b",
    r"\bthem\b",
    r"\bthose\b",
]


def _compact(text: str, limit: int = 220) -> str:
    """Normalize whitespace and cap long history snippets."""
    normalized = " ".join(text.split())
    if len(normalized) <= limit:
        return normalized
    return f"{normalized[:limit].rstrip()}..."


def is_context_dependent(question: str) -> bool:
    """Return True when a user turn likely depends on prior conversation.

    We intentionally use a conservative heuristic: fully specified questions
    should go straight to retrieval as-is, while vague pronoun-heavy follow-ups
    should be expanded with earlier turns.
    """
    normalized = " ".join(question.lower().split())
    if len(normalized) <= 18:
        return True
    return any(re.search(pattern, normalized) for pattern in _FOLLOWUP_PATTERNS)


def build_retrieval_query(question: str, history: list[dict[str, str]]) -> str:
    """Build the text that will be embedded for retrieval.

    The result is still just a search query, not evidence.  Retrieved documents
    remain the only allowed grounding source for the final answer.
    """
    if not history or not is_context_dependent(question):
        return question

    previous_user = ""
    previous_assistant = ""

    for message in reversed(history):
        role = str(message.get("role", "")).lower()
        content = str(message.get("content", "")).strip()
        if not content:
            continue
        if not previous_assistant and role == "assistant":
            previous_assistant = _compact(content)
            continue
        if not previous_user and role == "user":
            previous_user = _compact(content)
        if previous_user and previous_assistant:
            break

    context_parts = [f"Current question: {question}"]
    if previous_user:
        context_parts.append(f"Previous user question: {previous_user}")
    if previous_assistant:
        context_parts.append(f"Previous assistant answer: {previous_assistant}")

    return "\n".join(context_parts)
