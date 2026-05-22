"""Canonical visibility labels shared across upload and retrieval.

This module exists because the UI, older API callers, and vector payloads may
use slightly different strings for the same business concept.  Normalising them
in one place prevents subtle retrieval bugs where a document is ingested under
one label but filtered under another.
"""

ORG_PUBLIC = "Org Level (Public)"
SALES_PRIVATE = "Sales Project (Private)"

DEFAULT_VISIBILITY = ORG_PUBLIC

VISIBILITY_ALIASES = {
    "public": ORG_PUBLIC,
    "org": ORG_PUBLIC,
    "org-public": ORG_PUBLIC,
    "org_public": ORG_PUBLIC,
    "org level (public)": ORG_PUBLIC,
    "private": SALES_PRIVATE,
    "sales": SALES_PRIVATE,
    "sales-private": SALES_PRIVATE,
    "sales_private": SALES_PRIVATE,
    "sales project (private)": SALES_PRIVATE,
}


def normalize_visibility(value: str | None) -> str:
    """Map UI and legacy visibility values to canonical labels.

    The returned value is the exact string stored in Qdrant payloads and later
    used in retrieval filters.
    """
    normalized = (value or "").strip()
    if not normalized:
        return DEFAULT_VISIBILITY
    return VISIBILITY_ALIASES.get(normalized.lower(), normalized)
