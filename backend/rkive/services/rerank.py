"""Reranking helpers for retrieval results.

Qdrant gives us a first-pass similarity ranking based on vector distance.
That is good for recall, but the top hits can still be noisy or out of order.
This module applies a cheap second-stage rerank before we send context to the
LLM.  It is not a true cross-encoder reranker; it is a lightweight heuristic
that combines the original dense-vector score with simple lexical overlap.
"""

import re

from rkive.services.qdrant import SearchHit


def _tokenize(text: str) -> set[str]:
    """Extract coarse word tokens used for lexical overlap checks."""
    return {token for token in re.findall(r"[a-z0-9]+", text.lower()) if len(token) > 1}


def rerank_hits(question: str, hits: list[SearchHit], limit: int = 6) -> list[SearchHit]:
    """Reorder candidate chunks before they are shown to the LLM.

    Why this exists:
    - vector search is good at finding "roughly related" chunks
    - the final answer quality depends more on the top 3-5 chunks than on the
      full candidate set
    - a small lexical boost helps obvious term matches such as filenames,
      policies, acronyms, and product names

    The output keeps the original ``SearchHit`` objects; only their order is
    changed and low-confidence tail results are dropped.
    """
    query_tokens = _tokenize(question)
    ranked: list[tuple[float, SearchHit]] = []

    for hit in hits:
        text_tokens = _tokenize(hit.text)
        name_tokens = _tokenize(hit.filename)
        overlap = len(query_tokens & text_tokens) / max(1, len(query_tokens))
        filename_boost = len(query_tokens & name_tokens) / max(1, len(query_tokens))
        # Keep Qdrant's semantic score as the main signal, then apply small
        # lexical boosts for exact term matches inside the chunk and filename.
        blended = (hit.score * 0.72) + (overlap * 0.22) + (filename_boost * 0.06)
        ranked.append((blended, hit))

    ranked.sort(key=lambda item: item[0], reverse=True)
    if not ranked:
        return []

    top_score = ranked[0][0]
    # We avoid a single hardcoded global threshold because different questions
    # naturally produce different score distributions.  Instead we keep hits
    # that are reasonably close to the best candidate for this query.
    cutoff = max(0.32, top_score - 0.18)
    return [hit for score, hit in ranked if score >= cutoff][:limit]
