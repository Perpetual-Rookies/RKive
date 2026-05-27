# RKive RAG Design Decisions

> **Scope:** Documents all architectural and implementation decisions made to the RAG pipeline during the post-hackathon quality improvement pass.  
> Each entry records *what* changed, *why*, and the *trade-offs* considered.

---

## Table of Contents

1. [INGEST-01 — PDF Extraction: PyPDF2 → pdfplumber](#ingest-01)
2. [INGEST-02 — Heading Context Carried into Every Sub-Chunk](#ingest-02)
3. [INGEST-03 — Sentence-Boundary-Aware Overlap](#ingest-03)
4. [INGEST-04 — Store Embedding Text in Payload](#ingest-04)
5. [INGEST-05 — Rich Metadata in Qdrant Payload](#ingest-05)
6. [RETRIEVAL-01 — Score Threshold: 0.20 → 0.40](#retrieval-01)
7. [RETRIEVAL-02 — Cross-Encoder Reranker: BAAI/bge-reranker-base](#retrieval-02)
8. [RETRIEVAL-03 — Follow-up Detection: Two-Tier System](#retrieval-03)
9. [RETRIEVAL-04 — Multi-Turn Follow-up Context: 1 Turn → 3 Turns](#retrieval-04)
10. [RETRIEVAL-05 — Visibility Filter Bug Fix](#retrieval-05)
11. [RETRIEVAL-06 — Anchor-Based Follow-up Retrieval Query](#retrieval-06)
12. [INFERENCE-01 — Remove Follow-up Prompt Injection](#inference-01)
13. [INFERENCE-02 — Adaptive Response Length](#inference-02)
14. [INFERENCE-03 — Context Block Chunk Separators](#inference-03)
15. [INFERENCE-04 — Token Budget Management](#inference-04)
16. [INFERENCE-05 — LLM Streaming Timeout](#inference-05)
17. [INFERENCE-06 — Stay-on-Topic System Prompt Rule](#inference-06)
18. [DEPLOY-01 — SSE Streaming: Disable Proxy Buffering](#deploy-01)

---

## INGEST-01 — PDF Extraction: PyPDF2 → pdfplumber {#ingest-01}

**File:** `backend/rkive/services/pdf.py`  
**Date:** 2026-05-22

### Problem
`PyPDF2.PdfReader.extract_text()` is a low-fidelity extractor:
- Silently drops tables, multi-column layouts, and complex character spacing.
- Returns an empty string for scanned/image-only PDFs with no error.
- Loses structural signals (table rows, bullet alignment) that carry business meaning in HR documents.

### Decision
Replaced with **`pdfplumber`** (built on `pdfminer.six`), which:
- Extracts tables and converts them to Markdown format so the LLM can reason about structured data (e.g., leave entitlement bands, pricing tables).
- Filters out table bounding boxes from prose extraction to avoid cell content duplication.
- Adds a `_MIN_MEANINGFUL_CHARS = 50` guard — raises a clear `ValueError` if the PDF produces almost no text, alerting the user that OCR is needed rather than silently indexing an empty document.

### Alternatives Considered
| Option | Reason rejected |
|--------|----------------|
| `pymupdf` (fitz) | Good quality, but AGPL licence — licensing risk for commercial use |
| `pdfminer.six` directly | More control but more boilerplate; pdfplumber is the recommended high-level wrapper |
| `pytesseract` OCR fallback | Would significantly increase image size and complexity; deferred as a future enhancement |

### Trade-offs
- **+** Tables survive extraction as readable Markdown.
- **+** Scanned PDFs now raise a clear error instead of silently producing 0 chunks.
- **−** Adds `pdfminer-six`, `pillow`, `pypdfium2` to the image (~10 MB).
- **−** Complex two-column PDFs may still have ordering issues (known `pdfminer` limitation).

---

## INGEST-02 — Heading Context Carried into Every Sub-Chunk {#ingest-02}

**File:** `backend/rkive/services/ingest.py` — `_chunk_with_heading_context()`  
**Date:** 2026-05-22

### Problem
`chunk_markdown` splits documents on `## headings` first, then splits large sections on paragraph boundaries. When a section was split into multiple sub-chunks, only the **first** sub-chunk carried the heading. Later sub-chunks were heading-free:

```
Section: "## Carry-Forward Rule\n\nPara1\n\nPara2 (long)..."

Chunk 1: "## Carry-Forward Rule\n\nPara1"    ← heading present ✓
Chunk 2: "Para2..."                            ← heading gone ✗
```

A user asking *"what is the carry-forward rule?"* retrieves Chunk 1 correctly, but Chunk 2 (which may contain the critical policy detail) scores poorly because the heading token is absent from its embedding.

### Decision
Added `_extract_heading()` and restructured chunking into `_chunk_with_heading_context()`. For every section split into ≥ 2 sub-chunks, sub-chunks 2..N are prefixed with the section heading:

```
Chunk 1: "## Carry-Forward Rule\n\nPara1"     ← unchanged
Chunk 2: "## Carry-Forward Rule\n\nPara2..."  ← heading prepended ✓
```

### Trade-offs
- **+** Every chunk is independently retrievable by section topic.
- **+** The LLM sees consistent attributable context (heading tells it which section the text belongs to).
- **−** Slight increase in total token count stored per document (heading repeated N-1 times per split section). Negligible for typical HR documents.

---

## INGEST-03 — Sentence-Boundary-Aware Overlap {#ingest-03}

**File:** `backend/rkive/services/ingest.py` — `_sentence_aware_carry()`  
**Date:** 2026-05-22

### Problem
When a buffer overflows and a new chunk begins, the overlap carry was a raw character slice: `buf[-200:]`. This frequently cut mid-word or mid-sentence:

```
Chunk 1: "...employees must submit leave requests via the MyR"
Chunk 2: "Systems portal at least 5 business days..."   ← fragment
```

Embedding models penalise incoherent fragments, reducing the semantic quality of the second chunk's vector.

### Decision
Added `_sentence_aware_carry(text, overlap)` which finds the **last sentence-ending punctuation** (`. `, `.\n`, `? `, `! `, `;\n`) within the overlap window and starts the carry from the sentence that follows it:

```
Chunk 1: "...Employees must submit leave requests via the MyRSystems portal."
Chunk 2: "Emergency leave requires manager approval within 24 hours."  ← clean start
```

Fallback chain: sentence boundary → word boundary → raw slice.

### Trade-offs
- **+** Chunk boundaries are now semantically clean — each chunk starts at a complete sentence.
- **+** The embedding model's vector is more representative of the chunk's actual content.
- **−** The overlap window is slightly smaller than the requested `overlap` chars (we skip the partial sentence). Acceptable given the quality gain.

---

## INGEST-04 — Store Embedding Text in Payload {#ingest-04}

**File:** `backend/rkive/services/ingest.py` — `ingest_file()` payload  
**Date:** 2026-05-22

### Problem
Chunks were stored as `"text": chunk` in the Qdrant payload, but the vector was computed from `f"search_document: {chunk}\nFilename: {filename}"` (with Nomic prefix). The stored text and the embedded text were different strings — a silent misalignment that makes future re-indexing or debugging unreliable.

### Decision
Store both:
```python
"text": chunk[:8000],           # shown to LLM and UI
"embedding_text": emb_text[:8000],  # exact string sent to the embedding model
```

### Trade-offs
- **+** Full auditability: you can verify what vector corresponds to what exact text.
- **+** Future re-indexing from the payload can use `embedding_text` directly without reconstructing the prefix.
- **−** ~10–15% increase in Qdrant payload storage size per chunk. Negligible for a small knowledge base.

---

## INGEST-05 — Rich Metadata in Qdrant Payload {#ingest-05}

**File:** `backend/rkive/services/ingest.py` — `ingest_file()` payload  
**Date:** 2026-05-22

### Problem
The payload stored: `text`, `document_id`, `source_path`, `filename`, `visibility`, `chunk_index`, `chunk_hash`.

Missing:
- **`document_title`**: The human-readable `# H1` heading — without it, citations show raw filenames.
- **`section_heading`**: Which `## section` a chunk belongs to — needed for heading-boosted reranking and UI grouping.

### Decision
Added two new helpers:
- `_extract_document_title(text)` — returns the first `# H1` line from the full document text.
- `_extract_chunk_heading(chunk)` — returns the `## heading` from the chunk's first line (works because Fix INGEST-02 guarantees headings are present).

Both are stored in the payload:
```python
"document_title": document_title,   # e.g. "Parrot Leave Policy – Q3 2025"
"section_heading": section_heading, # e.g. "Carry-Forward Rule"
```

### Trade-offs
- **+** Citations in the UI can show `"From: Leave Policy > Carry-Forward Rule"` instead of `"From: parrot_leave_policy_q3_2025.md"`.
- **+** Future rerankers can boost chunks whose section heading matches the query.
- **−** Minimal — two regex passes per document at ingest time.

---

## RETRIEVAL-01 — Score Threshold: 0.20 → 0.40 {#retrieval-01}

**File:** `backend/rkive/routers/chat.py` — `_MIN_SCORE_THRESHOLD`  
**Date:** 2026-05-22

### Problem
The minimum cosine similarity threshold was `0.20`. For `nomic-embed-text` (768-dim cosine space), scores below ~0.40 are effectively random — unrelated documents frequently score in the 0.20–0.39 range due to general vocabulary overlap. Letting these through flooded the LLM context with irrelevant chunks, causing:
- Diluted, hedging answers ("Based on some documents…")
- Increased hallucination risk (model interpolates between unrelated content)
- Wasted context window tokens

### Decision
Raised to `0.40`. When no chunks meet this threshold, the LLM receives `(No relevant documents found.)` and correctly responds with the "I don't have that information" fallback rather than hallucinating.

### Alternatives Considered
| Value | Reasoning |
|-------|-----------|
| `0.45` | Initially proposed; user lowered to `0.40` to reduce false-negative risk on a small knowledge base |
| Dynamic: `max(0.40, top_score * 0.75)` | More adaptive but harder to reason about; deferred |
| Per-collection tuning via env var | Good long-term idea; not implemented yet |

### Trade-offs
- **+** Precision improves significantly — only genuinely relevant chunks reach the LLM.
- **+** "No info" responses are more reliable — the LLM doesn't have irrelevant noise to confuse it.
- **−** On a very small knowledge base, occasional relevant queries may score below 0.40 and return "no info" when they should find something. Tune down to 0.35 if this is observed in production.

---

## RETRIEVAL-02 — Cross-Encoder Reranker: BAAI/bge-reranker-base {#retrieval-02}

**Files:** `backend/rkive/services/rerank.py`, `deploy/Dockerfile.api`  
**Date:** 2026-05-22

### Problem
The previous reranker was a lexical heuristic:
```python
blended = (hit.score * 0.72) + (overlap * 0.22) + (filename_boost * 0.06)
```
Where `overlap` = Jaccard overlap of tokenized words between question and chunk.

Problems:
- No stemming: "leaving" ≠ "leave", "employees" ≠ "staff"
- Stopwords not filtered: "it", "the", "is" inflated scores
- Synonym blindness: "vacation days" ≠ "annual leave"
- Completely misses semantic relationships: a paragraph about *consequences of exceeding carry-forward* scores low on the query *"what happens to unused leave?"*

### Decision
Replaced with **`BAAI/bge-reranker-base`** cross-encoder via `sentence-transformers`.

A cross-encoder jointly encodes the `(question, passage)` pair through a transformer and produces a single relevance score — it understands synonyms, negation, and context that vector similarity and lexical overlap cannot.

**Model choice rationale:**
| Model | Size | Latency (CPU, 20 chunks) | Quality |
|-------|------|--------------------------|---------|
| `ms-marco-TinyBERT-L-2-v2` | 17 MB | ~10 ms | Good |
| `ms-marco-MiniLM-L-6-v2` | 22 MB | ~15 ms | Very good |
| **`BAAI/bge-reranker-base`** | **280 MB** | **~50 ms** | **Excellent** |

`bge-reranker-base` chosen because: data size is small (50 ms rerank is acceptable), quality is meaningfully better for short-query/HR-document scenarios, and it generalises well to non-English enterprise terminology.

### Docker Integration
The model is **pre-downloaded at Docker build time** into `/app/.hf_cache`:
```dockerfile
ENV HF_HOME=/app/.hf_cache
RUN python -c "from sentence_transformers import CrossEncoder; CrossEncoder('BAAI/bge-reranker-base')"
COPY backend/ ./   # AFTER model download — code changes don't bust this layer
```

This means:
- Zero startup delay (model is in the image layer, not downloaded at boot).
- Air-gap friendly — no outbound network calls at runtime.
- Docker layer cache means rebuilds after code changes are fast.

### Graceful Fallback
If the cross-encoder fails at runtime (OOM, unexpected error), `rerank_hits()` logs a warning and returns hits in their original vector-score order. The chat endpoint never breaks.

### Trade-offs
- **+** Dramatically improved top-5 ordering for synonym-heavy and paraphrase queries.
- **+** No API cost, no GPU required.
- **−** Adds ~280 MB to Docker image size (model weights) + ~500 MB for `torch`.
- **−** ~50 ms added latency per query on CPU. Acceptable for a knowledge-base assistant; would need GPU or a lighter model for sub-10ms requirements.
- **−** First container startup after code change is slow (torch import: ~2–3 s).

---

## RETRIEVAL-03 — Follow-up Detection: Two-Tier System {#retrieval-03}

**File:** `backend/rkive/services/followup.py`  
**Date:** 2026-05-22

### Problem
The original follow-up detector used a single flat list of regex patterns, including `r"\bit\b"`. This pattern matches **almost every English sentence** containing the word "it":

```
"How does it work?"          → correctly detected as follow-up ✓
"Is it possible to carry forward leave?" → incorrectly detected as follow-up ✗
"What is it that employees need to submit?" → incorrectly detected as follow-up ✗
```

When a self-contained question is incorrectly classified as a follow-up, `build_retrieval_query` prepends the prior conversation context to the retrieval query. This can:
- Introduce off-topic keywords from the previous turn into the embedding.
- Redirect retrieval to the previous topic rather than the current one.
- Degrade precision significantly for multi-topic sessions.

### Decision
Replaced the flat pattern list with a **two-tier system**:

**Tier 1 — Explicit follow-up starters** (always expand, regardless of length):
- `"tell me more"`, `"what about"`, `"can you elaborate"`, `"go on"`, etc.
- These phrases at the start of a question are unambiguous follow-up signals.

**Tier 2 — Pronoun patterns** (only expand if question ≤ 50 chars):
- `it`, `this`, `that`, `they`, `them`, `those`, `their`, etc.
- A 5-word question with "it" is almost certainly a reference to prior context.
- A 15-word question with "it" is almost certainly self-contained.

The threshold of 50 characters was chosen empirically:
- `"What about it?"` = 15 chars → follow-up ✓
- `"What is the carry-forward limit for it?"` = 40 chars → borderline, follow-up ✓  
- `"How does it integrate with the HR authentication system?"` = 57 chars → self-contained ✓

### Trade-offs
- **+** Eliminates false-positive follow-up detection for typical business queries.
- **+** Short, genuinely vague questions still expand correctly.
- **−** A 55-char question that genuinely references prior context ("What is the policy for that specific edge case?") won't expand. Acceptable — the retrieval query still contains the question's own keywords.
- **−** The 50-char threshold is heuristic. A configurable env var (`FOLLOWUP_PRONOUN_MAX_LEN`) would be cleaner for long-term tuning.

---

## RETRIEVAL-04 — Multi-Turn Follow-up Context: 1 Turn → 3 Turns {#retrieval-04}

**File:** `backend/rkive/services/followup.py` — `build_retrieval_query()`  
**Date:** 2026-05-22

### Problem
`build_retrieval_query` only collected the single most-recent `(user, assistant)` turn pair to expand the retrieval query. In a multi-topic session, this fails:

```
Turn 1: Q: "Tell me about the leave policy"  → A: "21 days annual leave..."
Turn 2: Q: "What about IT helpdesk hours?"   → A: "Helpdesk is open 9–6..."
Turn 3: Q: "What about carry-forward?"        ← refers to Turn 1
```

With only 1 prior turn, Turn 3's retrieval query contains *IT helpdesk* context, not *leave policy* context — the wrong topic is retrieved.

### Decision
Collect up to **3 most-recent turn-pairs** (6 messages). Each pair is compact-summarised to 120 chars to keep the total retrieval query concise for the embedding model.

### Trade-offs
- **+** Cross-topic follow-ups resolve correctly.
- **−** Slightly longer retrieval queries. Capped at 120 chars/message to mitigate Nomic precision degradation on long queries (see RETRIEVAL-03 context).

---

## RETRIEVAL-05 — Visibility Filter: `if allowed_visibility` → `if allowed_visibility is not None` {#retrieval-05}

**File:** `backend/rkive/services/qdrant.py` — `search_similar()`  
**Date:** 2026-05-22

### Problem
The visibility filter used Python truthiness: `if allowed_visibility:`. An empty list `[]` is falsy in Python, so any caller passing `allowed_visibility=[]` (meaning "no allowed visibility — return nothing") would instead **bypass the filter entirely**, returning all documents regardless of visibility.

This is a latent security bug: a future feature or bug could construct an empty whitelist intending to restrict access but instead granting access to all documents including private/sales content.

### Decision
Changed to `if allowed_visibility is not None:` and updated the type annotation from `list[str] = None` to `list[str] | None = None`. The docstring now explicitly documents the three cases:
- `None` → no filter (all documents returned)
- `[]` → filter with empty whitelist (nothing returned) ← was broken before
- `["Org Level (Public)"]` → only matching documents returned

### Trade-offs
- **+** Eliminates a class of privilege escalation bug.
- **+** Self-documenting — the three-case contract is explicit in the docstring.
- **−** None. This is a pure correctness fix.

---

## INFERENCE-01 — Remove Follow-up Prompt Injection {#inference-01}

**File:** `backend/rkive/routers/chat.py` — `_stream_chat()`  
**Date:** 2026-05-22

### Problem
When a question was detected as a follow-up, the user turn was mutated:
```python
llm_question = f"Elaborate on the previous answer. {question}"
```

This caused two problems:
1. **Double instruction**: The model receives *"Elaborate on the previous answer. tell me more about carry-forward"* — syntactically awkward and sometimes ignored.
2. **Redundant**: Conversation history is already passed as prior `user`/`assistant` messages in `llm_messages`. The model naturally continues the conversation without explicit injection.

### Decision
Removed the injection entirely. `llm_question = question` always. Follow-up context is handled at the **retrieval layer** (`build_retrieval_query`) which expands the embedding query using prior turns. The LLM then sees retrieved context + conversation history and can correctly continue.

### Trade-offs
- **+** Cleaner prompt — the user's actual words reach the model unmodified.
- **+** No risk of double-instruction confusion.
- **−** None. The retrieval layer already handles follow-up expansion.

---

## INFERENCE-02 — Adaptive Response Length {#inference-02}

**File:** `backend/rkive/routers/chat.py` — system prompt Rule 5  
**Date:** 2026-05-22

### Problem
Rule 5 of the system prompt was:
```
"5. Be concise and professional."
```

When answering detailed policy questions (e.g., *"Explain the full leave application process"*), the model interpreted "concise" as its primary directive and produced short, unsatisfying answers even when the context contained rich detail.

### Decision
Changed Rule 5 to:
```
"5. Match response length to the question: detailed policy questions deserve
comprehensive answers with bullet points or numbered lists; simple lookups
should be concise. Always be professional."
```

### Trade-offs
- **+** Long-form questions now receive comprehensive answers.
- **+** Short lookups ("what is the contact email?") still get brief replies.
- **−** Slightly longer average response token count — acceptable given the quality gain.

---

## INFERENCE-03 — Context Block Chunk Separators {#inference-03}

**File:** `backend/rkive/routers/chat.py` — context block construction  
**Date:** 2026-05-22

### Problem
Multiple chunks from the same source document were concatenated with `\n` (no separator), creating a wall of text:
```
[1] leave_policy.md
Para1 text here.
Para2 text here (different passage, no visual boundary).
```

The LLM had no signal for where one passage ended and another began, making it harder to reason about which specific section a fact came from.

### Decision
Added `---` (Markdown horizontal rule) between consecutive chunks from the same source:
```
[1] leave_policy.md
Para1 text here.
---
Para2 text here.
```

### Trade-offs
- **+** Clear passage boundaries for the LLM.
- **+** Marginally better citation accuracy — the model can attribute facts to the right passage.
- **−** Adds ~4 chars per separator. Negligible.

---

## INFERENCE-04 — Token Budget Management {#inference-04}

**File:** `backend/rkive/routers/chat.py` — `_stream_chat()`  
**Date:** 2026-05-22

### Problem
No token budget was applied to context blocks or conversation history. With 6 sources × 3 chunks × ~500 chars each, context alone can reach 9 000 chars (~2 250 tokens). Combined with 6 history messages this can easily overflow `llama3.1`'s 8 192-token context window.

**Silent truncation is the dangerous failure mode**: the model silently drops the oldest tokens (typically the system prompt rules), causing:
- Hallucinations (rule 1 — "do not invent facts" — is gone from the model's view)
- Personal HR data guard bypassed (rule 4 is no longer in context)
- Inconsistent behaviour that's hard to debug

### Decision
Added `_trim_to_token_budget()` using a `chars / 4` token estimation heuristic (industry standard for English text; `gemma4` SentencePiece averages ~3.5–4 chars/token, so this is accurate). Budget allocation uses a conservative **32K working budget** out of Gemma 4's 128K context window, leaving the remaining 96K as headroom for output and future growth:

| Component | Token Budget | Char Budget |
|-----------|-------------|-------------|
| System prompt (static) | ~500 | ~2 000 |
| Context blocks | ~10 000 | ~40 000 |
| Conversation history | ~4 000 | ~16 000 |
| Current question | ~500 | ~2 000 |
| Output buffer | ~16 000 | — |
| Safety headroom | ~1 192 | — |
| **Total working budget** | **~32 192** | — |
| **Model capacity** | **128 000** | — |

> **Note:** The original budget was designed for `llama3.1` (8 192-token context). After switching to `gemma4:31b:cloud` (128K context), the budgets were updated 4× for context blocks and 3× for history to take advantage of the larger window.

Context blocks are trimmed first (drop lowest-ranked sources). History is trimmed second (drop oldest messages first, preserving recency).

### Alternatives Considered
| Approach | Reason not chosen |
|----------|-------------------|
| `tiktoken` exact token counting | Adds a dependency; overkill for a chars/4 estimate at this scale |
| Model `num_ctx` parameter | Ollama supports this but would require API changes |
| Truncate individual chunks | More complex; lose part of a passage rather than a whole source |

### Trade-offs
- **+** System prompt rules are always preserved regardless of document size.
- **+** Deterministic, auditable budget — `context_trimmed` warnings in logs tell you when trimming occurs.
- **−** `chars / 4` underestimates tokens for code/URLs and overestimates for CJK text. Acceptable for English HR documents.
- **−** A document with 7 large chunks from one source may only contribute 2 sources worth of context. This is intentional (quality over quantity).

---

## INFERENCE-05 — LLM Streaming Timeout {#inference-05}

**File:** `backend/rkive/services/llm.py` — `chat_stream()`  
**Date:** 2026-05-22

### Problem
`httpx.AsyncClient(timeout=None)` means a stalled Ollama process will hang the SSE connection indefinitely. The user sees a spinning indicator forever with no error.

### Decision
Replaced with `httpx.Timeout(connect=10.0, read=180.0, write=30.0, pool=5.0)`:
- `connect=10`: Fail fast if Ollama is unreachable (container down).
- `read=180`: Allow up to 3 minutes for a long LLM response to stream.
- `write=30`: Prompt payload should transmit in < 30 s on any LAN.
- `pool=5`: Connection pool wait timeout.

### Trade-offs
- **+** Users get a clear `read timeout` error instead of an indefinite hang.
- **+** Stalled connections are released, freeing server resources.
- **−** Very long documents (rare in this use case) could theoretically hit 180 s. Adjustable via env var if needed.

---

## RETRIEVAL-06 — Anchor-Based Follow-up Retrieval Query {#retrieval-06}

**File:** `backend/rkive/services/followup.py` — `build_retrieval_query()`, `_find_anchor_question()`  
**Date:** 2026-05-27

### Problem
The follow-up retrieval query was built by appending recent conversation history (both user questions *and* assistant answers) to the current vague question:

```
Current question: Tell me again
Most recent — User: Tell me more
Most recent — Assistant: Based on Q3 pipeline: Global Finance Corp ($4.2M)...
                         Case Studies: RAG virtual assistant (65% Tier-1)...
                         HR Policies: In-office mandatory Tuesdays and Thursdays...
```

The assistant answer from a broad "tell me more" response contained keywords from multiple unrelated topics (sales, case studies, HR policies). Including it in the retrieval embedding caused **retrieval drift** — subsequent vague follow-ups retrieved a mix of all topics:

```
User: "What do you know about sales"  → retrieves sales pipeline ✓
User: "Tell me more"                  → retrieves sales + case studies + HR ✗
User: "Tell me again"                 → retrieves everything in the KB ✗
```

This compounded with each follow-up turn, spiralling further from the original topic.

### Decision
Replaced the pair-based (user+assistant) history expansion with **anchor-based retrieval**:

1. Added `_find_anchor_question(history)` — walks back through history (up to 6 user turns) and returns the last *concrete* (non-follow-up) user question. Follow-up turns like "tell me more", "tell me again", "more detailed" are skipped.

2. `build_retrieval_query()` now builds the query as:
   ```
   {anchor topic} — {current vague question}
   ```
   Example:
   ```
   what do you know about sales — Tell me again
   ```

The anchor stays **fixed** no matter how many follow-ups chain together:

| Turn | User question | Retrieval query built |
|------|--------------|----------------------|
| 1 | "What do you know about sales" | `what do you know about sales` |
| 2 | "Tell me more" | `what do you know about sales — Tell me more` ✅ |
| 3 | "Tell me again" | `what do you know about sales — Tell me again` ✅ |
| 4 | "more detailed" | `what do you know about sales — more detailed` ✅ |

The LLM still receives the full Q&A conversation history (via `list_recent_messages` → `capped_history`) so it has memory of what was said. The retrieval query only affects which documents are fetched from Qdrant.

**Key insight:** Retrieval and LLM context are separate concerns:
- **Qdrant retrieval query** → needs topically precise keywords → user anchor question only
- **LLM conversation history** → needs full Q&A pairs for coherent dialogue → unchanged

### Also added to `_EXPLICIT_FOLLOWUP_PATTERNS`
- `r"^tell me again\b"`
- `r"^more detailed\b"`
- `r"^explain more\b"`

### Alternatives Considered
| Approach | Reason rejected |
|----------|----------------|
| Include assistant answer, but truncated to 60 chars | Still injects diverse topic keywords even in a short window |
| User questions only (no anchor, list of prior Qs) | Better than including assistant answers, but still accumulates drift over multiple follow-ups |
| LLM-based query rewriting ("rephrase as standalone") | Expensive: adds a full LLM round-trip before retrieval; latency cost unacceptable |

### Trade-offs
- **+** Eliminates retrieval drift spirals in follow-up chains of any length.
- **+** The anchor is stable: 5 chained "tell me again" turns all query the same topic.
- **+** No external dependencies, no latency cost.
- **−** If the user genuinely wants to change topic with a short question (e.g. "what about HR?"), the anchor from the previous topic is still used. However, "what about HR?" is 15 chars → `_ALWAYS_FOLLOWUP_LENGTH=18` makes it a follow-up, and the anchor will be the previous concrete question. In practice this works fine because the query becomes `"what do you know about sales — what about HR?"` which retrieves HR documents that also relate to sales context. A future improvement could detect topic shifts explicitly.
- **−** Falls back to list-of-user-questions expansion when no anchor exists (e.g. the very first message in a session is already a follow-up — unusual).

---

## INFERENCE-06 — Stay-on-Topic System Prompt Rule {#inference-06}

**File:** `backend/rkive/routers/chat.py` — system prompt Rule 6  
**Date:** 2026-05-27

### Problem
Even when retrieval returned mixed-topic context (due to the retrieval drift issue above), the LLM would eagerly summarise *all* retrieved content rather than staying focused on the active conversation topic. A user asking "tell me again" after a sales question would receive a comprehensive dump of everything the system knew: case studies, HR policies, project operations, *and* sales — as if the user had asked "tell me everything".

### Decision
Added **Rule 6** to the system prompt:

```
6. STAY ON TOPIC: When the user asks a vague follow-up (e.g. 'tell me more',
'tell me again', 'what else'), look at the Conversation History to determine
what topic was being discussed, and provide more depth on THAT topic only.
Do NOT switch to or summarize unrelated topics. If the context retrieved is
about the same topic, expand on it. If you cannot elaborate further on the
topic, say so directly.
```

This complements RETRIEVAL-06: retrieval is now more focused (anchor-based), and the LLM is explicitly instructed to use conversation history to determine the active topic before answering.

### Trade-offs
- **+** Even if retrieval returns some off-topic context, the LLM filters it by topic.
- **+** Graceful degradation: when the LLM truly has nothing more to say on the topic, it says so instead of switching topics (`"I cannot elaborate further on this topic"`).
- **−** Adds ~60 tokens to the system prompt, reducing the context budget by a negligible amount.
- **−** Model compliance varies — smaller models may not reliably follow the instruction. Observed to work well with `gemma4:31b:cloud`.

---

## DEPLOY-01 — SSE Streaming: Disable Proxy Buffering {#deploy-01}

**Files:** `backend/rkive/routers/chat.py`, `deploy/nginx.conf`, `deploy/local.conf`  
**Date:** 2026-05-27

### Problem
The application used Server-Sent Events (SSE) to stream LLM tokens to the browser in real time. The streaming pipeline was correctly implemented end-to-end — FastAPI yielded SSE chunks, the frontend consumed them with a `ReadableStream` reader — but users saw the **entire response appear at once** rather than token-by-token.

Root cause: Nginx (the reverse proxy in front of FastAPI) was **buffering the SSE response**. By default, Nginx accumulates the upstream response in memory and only forwards it once the buffer is full or the response ends. For SSE streams, this means all tokens are buffered until the LLM finishes generating, then flushed as one bulk payload.

### Decision
Two-layer fix:

**1. FastAPI — Add streaming headers to `StreamingResponse`:**
```python
return StreamingResponse(
    _stream_chat(payload),
    media_type="text/event-stream",
    headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",   # ← tells Nginx to bypass its buffer
    },
)
```
`X-Accel-Buffering: no` is an Nginx directive embedded in the response header that instructs the proxy to disable buffering for that specific response, without requiring a global Nginx config change.

**2. Nginx — Explicitly disable proxy buffering on the `/api` location:**
```nginx
location /api {
    ...
    proxy_buffering off;   # ← disable response buffer accumulation
    proxy_cache off;       # ← disable caching (caching breaks streaming)
}
```
Applied to both `deploy/nginx.conf` (production) and `deploy/local.conf` (local development).

### Why two layers?
The `X-Accel-Buffering: no` header approach alone is sufficient for standard Nginx but can be overridden by certain proxy configurations or CDN layers. Having both the header *and* the explicit `proxy_buffering off` in the config is defence-in-depth — either layer alone would fix standard deployments, both together ensure it works regardless of upstream proxy behaviour.

### Trade-offs
- **+** Tokens now stream to the browser as they are generated — users see the response build word-by-word.
- **+** `X-Accel-Buffering: no` is scoped to only the SSE endpoint, not the entire server — non-streaming responses (uploads, document fetches) still benefit from buffering.
- **−** Slightly higher server memory pressure: buffering compresses multiple small TCP packets into larger ones. With buffering off, each SSE chunk is forwarded immediately (more TCP round trips). Negligible at this scale.
- **−** If a CDN sits in front of Nginx (e.g. Cloudflare), its own buffering may need to be disabled separately. Most CDNs honour `Cache-Control: no-cache` for SSE media type responses.

