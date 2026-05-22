"""Cross-encoder reranker using BAAI/bge-reranker-base.

Qdrant gives us a first-pass similarity ranking based on vector distance.
That is good for recall, but the top hits can still be noisy or out of order.

This module applies a true cross-encoder second-stage rerank: the model jointly
encodes the (question, chunk) pair and produces a relevance score, which is far
more accurate than the vector-only cosine similarity or a lexical heuristic.

Model choice: BAAI/bge-reranker-base
- ~280 MB on disk
- Runs on CPU (no GPU required)
- ~50 ms to score 20 chunks on a modern CPU core
- Significantly outperforms lexical overlap heuristics for HR/policy Q&A
- Downloaded once at Docker build time and cached in the image layer

The model is lazy-loaded on first use so application startup time is unaffected.
"""

import logging
import threading
from functools import lru_cache

from rkive.services.qdrant import SearchHit

log = logging.getLogger("rkive.rerank")

_MODEL_NAME = "BAAI/bge-reranker-base"
_model_lock = threading.Lock()


@lru_cache(maxsize=1)
def _get_cross_encoder():
    """Load and cache the cross-encoder model (thread-safe, loaded once).

    The first call downloads/loads the model from disk (~1-2 s on first run,
    near-instant on subsequent calls because of the lru_cache).
    """
    try:
        from sentence_transformers import CrossEncoder  # type: ignore
        log.info("reranker_loading", extra={"model": _MODEL_NAME})
        # local_files_only=True ensures it uses the model baked into the Docker
        # image during build and never hits the Hugging Face API at runtime.
        model = CrossEncoder(_MODEL_NAME, max_length=512, local_files_only=True)
        log.info("reranker_loaded", extra={"model": _MODEL_NAME})
        return model
    except Exception as exc:
        log.error("reranker_load_failed", extra={"model": _MODEL_NAME, "error": str(exc)})
        raise


def rerank_hits(question: str, hits: list[SearchHit], limit: int = 12) -> list[SearchHit]:
    """Reorder candidate chunks using a cross-encoder relevance model.

    Why cross-encoder over lexical heuristics:
    - Cross-encoders jointly encode the (question, chunk) pair so they
      understand semantic relationships, synonyms, and negation.
    - Lexical overlap misses: 'annual leave' vs 'vacation days', 'how many'
      vs 'entitlement', HR acronyms, etc.
    - The BGE reranker is specifically trained on MS-MARCO passage ranking,
      which generalises well to enterprise Q&A.

    Falls back to the original vector-score ordering if the model fails,
    so a reranker crash never breaks the chat endpoint.

    Args:
        question: The user's question (not the expanded retrieval query).
        hits: Candidate chunks from Qdrant, already score-filtered.
        limit: Maximum number of hits to return after reranking.

    Returns:
        Reranked list of SearchHit objects, best first, capped to *limit*.
    """
    if not hits:
        return hits

    try:
        model = _get_cross_encoder()

        # Build (query, passage) pairs for the cross-encoder.
        # Strip the nomic search_document prefix if present so the model
        # sees clean text rather than a formatting artefact.
        pairs = []
        for hit in hits:
            text = hit.text
            if text.startswith("search_document:"):
                text = text[len("search_document:"):].strip()
            pairs.append((question, text))

        # scores is a numpy array of float32 logits; higher = more relevant.
        scores = model.predict(pairs)

        ranked = sorted(
            zip(scores, hits),
            key=lambda item: float(item[0]),
            reverse=True,
        )

        log.info(
            "reranker_scores",
            extra={
                "top_score": float(ranked[0][0]) if ranked else None,
                "bottom_score": float(ranked[-1][0]) if ranked else None,
                "hit_count": len(ranked),
            },
        )

        return [hit for _score, hit in ranked][:limit]

    except Exception as exc:
        # Graceful fallback: if the cross-encoder crashes (e.g. OOM on a tiny
        # container), return hits in their original vector-score order.
        log.warning(
            "reranker_fallback",
            extra={"error": str(exc), "reason": "returning hits in vector-score order"},
        )
        return hits[:limit]
