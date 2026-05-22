"""
RKive RAG Quality Evaluation Script
====================================
Tests the full pipeline end-to-end using the live FastAPI backend.

Sections:
  1. Infrastructure health
  2. Ingestion quality  (upload → chunk count, dedup, re-ingest)
  3. Retrieval quality  (do citations come back? are scores good?)
  4. Answer quality     (the main thing — does the LLM answer correctly?)

Usage:
  pip install httpx rich
  python eval.py                         # targets localhost
  python eval.py --base http://host:8000
  python eval.py --role "Sales Representative"
"""

import argparse
import json
import sys
import time
import textwrap
from pathlib import Path
import httpx
from rich import print as rprint
from rich.table import Table
from rich.console import Console

console = Console()

# ── CLI ───────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(description="RKive RAG quality evaluator")
parser.add_argument("--base", default="http://localhost:8000", help="API base URL")
parser.add_argument("--role", default="Standard Employee", help="User role for RBAC tests")
parser.add_argument("--timeout", type=int, default=120, help="Per-request timeout (seconds)")
args = parser.parse_args()

BASE = args.base.rstrip("/")
ROLE = args.role
TIMEOUT = args.timeout

# ── Synthetic test document ───────────────────────────────────────────────────
TEST_DOC_CONTENT = textwrap.dedent("""\
    # Parrot Leave Policy – Q3 2025

    ## Eligibility
    All full-time employees at R Systems are entitled to 21 days of paid annual leave per calendar year.
    Contract staff are entitled to 10 days.

    ## Carry-Forward Rule
    Unused leave may be carried forward to the next year, up to a maximum of 10 days.
    Any leave beyond 10 days will lapse on 31 December.

    ## Application Process
    Employees must submit leave requests via the MyRSystems portal at least 5 business days in advance.
    Emergency leave requires manager approval within 24 hours.

    ## Public Holidays
    In addition to annual leave, employees receive 12 public holidays as declared by the company each January.

    ## Contact
    HR queries related to leave should be directed to hr-leaves@rsystems.com.
""")
TEST_DOC_NAME = "parrot_leave_policy_q3_2025.md"

# ── Ground-truth Q&A pairs for the test document ─────────────────────────────
QA_PAIRS = [
    {
        "question": "How many days of paid annual leave do full-time employees get?",
        "must_contain": ["21"],
        "must_not_contain": ["I don't have that information"],
        "label": "Specific fact retrieval",
    },
    {
        "question": "What is the maximum carry-forward limit for unused leave?",
        "must_contain": ["10"],
        "must_not_contain": ["I don't have that information"],
        "label": "Numeric fact retrieval",
    },
    {
        "question": "How many days in advance must leave be submitted?",
        "must_contain": ["5"],
        "must_not_contain": ["I don't have that information"],
        "label": "Procedural detail",
    },
    {
        "question": "Who should I contact for HR leave queries?",
        "must_contain": ["hr-leaves@rsystems.com"],
        "must_not_contain": ["I don't have that information"],
        "label": "Contact detail retrieval",
    },
    {
        "question": "What happens to leave beyond the carry-forward limit?",
        "must_contain": ["lapse", "31 December"],
        "must_not_contain": ["I don't have that information"],
        "label": "Policy consequence",
    },
    {
        "question": "What is the capital of France?",
        "must_contain": ["don't have that information", "do not have that information", "knowledge base"],
        "must_not_contain": ["Paris"],
        "label": "Out-of-scope hallucination guard",
    },
    {
        "question": "What is my salary?",
        "must_contain": ["MyRSystems portal", "MyHR"],
        "must_not_contain": [],
        "label": "Personal HR data guard",
    },
]

# ── Helpers ───────────────────────────────────────────────────────────────────
results: list[dict] = []


def section(title: str):
    console.rule(f"[bold cyan]{title}[/bold cyan]")


def ok(msg: str):
    rprint(f"  [green]✓[/green] {msg}")


def fail(msg: str):
    rprint(f"  [red]✗[/red] {msg}")


def warn(msg: str):
    rprint(f"  [yellow]⚠[/yellow] {msg}")


def record(label: str, passed: bool, detail: str = ""):
    results.append({"label": label, "passed": passed, "detail": detail})
    if passed:
        ok(f"{label}")
    else:
        fail(f"{label}  →  {detail}")


def ask(question: str, conversation_id: str | None = None) -> dict:
    """Send a chat request via SSE and collect the full response."""
    payload = {
        "type": "chat",
        "content": question,
        "role": ROLE,
        "conversationId": conversation_id,
    }
    answer_tokens = []
    citations = []
    new_conversation_id = conversation_id

    with httpx.Client(timeout=TIMEOUT) as client:
        with client.stream("POST", f"{BASE}/api/chat", json=payload) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = json.loads(line[5:].strip())
                if data.get("type") == "token":
                    answer_tokens.append(data.get("text", ""))
                elif data.get("type") == "citations":
                    citations = data.get("citations", [])
                elif data.get("type") == "conversation":
                    new_conversation_id = data.get("id", conversation_id)
                elif data.get("type") == "error":
                    raise RuntimeError(f"API error: {data.get('message')}")

    return {
        "answer": "".join(answer_tokens).strip(),
        "citations": citations,
        "conversation_id": new_conversation_id,
    }


# ── 1. Health ─────────────────────────────────────────────────────────────────
section("1 · Infrastructure Health")
try:
    r = httpx.get(f"{BASE}/health", timeout=10)
    r.raise_for_status()
    data = r.json()
    record("API reachable", True)
    record("Postgres connected", data.get("ok", False))
    ok(f"Qdrant collection: {data.get('qdrant_collection')}")
    ok(f"Chat model:        {data.get('chat_model')}")
except Exception as e:
    record("API reachable", False, str(e))
    rprint("\n[bold red]Cannot reach the API. Aborting.[/bold red]")
    sys.exit(1)

# ── 2. Ingestion quality ──────────────────────────────────────────────────────
section("2 · Ingestion Quality")

doc_id = None
chunks = 0

try:
    files = {"file": (TEST_DOC_NAME, TEST_DOC_CONTENT.encode(), "text/markdown")}
    data_form = {"visibility": "org_public"}
    r = httpx.post(f"{BASE}/api/upload", files=files, data=data_form, timeout=60)
    r.raise_for_status()
    resp = r.json()
    doc_id = resp.get("documentId")
    chunks = resp.get("chunks", 0)
    record("Upload succeeds", True)
    record("Document ID returned", bool(doc_id), str(doc_id))
    record("Chunks produced > 0", chunks > 0, f"{chunks} chunks")
    if chunks > 1:
        ok(f"Good chunk count ({chunks}) — document was split into multiple searchable passages")
    else:
        warn(f"Only {chunks} chunk — document may be too small or chunking config is off")
except Exception as e:
    record("Upload succeeds", False, str(e))

# Deduplication check
if doc_id:
    try:
        files2 = {"file": (TEST_DOC_NAME, TEST_DOC_CONTENT.encode(), "text/markdown")}
        data_form2 = {"visibility": "org_public"}
        r2 = httpx.post(f"{BASE}/api/upload", files=files2, data=data_form2, timeout=60)
        r2.raise_for_status()
        resp2 = r2.json()
        record("Re-upload deduplication works", resp2.get("deduplicated", False),
               "deduplicated=False — duplicate stored again")
    except Exception as e:
        record("Re-upload deduplication works", False, str(e))

# Document list check
try:
    r = httpx.get(f"{BASE}/api/documents", timeout=10)
    r.raise_for_status()
    docs = r.json().get("documents", [])
    our_doc = next((d for d in docs if str(d.get("id")) == str(doc_id)), None)
    record("Document appears in listing", our_doc is not None)
except Exception as e:
    record("Document appears in listing", False, str(e))

# ── 3. Retrieval quality (via citations) ──────────────────────────────────────
section("3 · Retrieval Quality")
rprint("  [dim]Asking factual questions and checking citations are returned...[/dim]")

retrieval_test_q = "How many days of paid annual leave do full-time employees get?"
try:
    time.sleep(1)  # small pause so embeddings settle
    result = ask(retrieval_test_q)
    citations = result["citations"]
    record("Citations returned for factual query", len(citations) > 0,
           f"got {len(citations)} citation(s)")

    if citations:
        top_score = citations[0].get("score", 0)
        record("Top citation score ≥ 0.35", top_score >= 0.35,
               f"score={top_score:.3f} — below threshold means retrieval is weak")
        record("Test document cited", any(
            TEST_DOC_NAME in (c.get("filename") or "") for c in citations
        ), f"citations: {[c.get('filename') for c in citations]}")
except Exception as e:
    record("Citations returned for factual query", False, str(e))

# ── 4. Answer quality ─────────────────────────────────────────────────────────
section("4 · Answer Quality  (main evaluation)")
rprint(f"  Role: [bold]{ROLE}[/bold]  |  Document: [bold]{TEST_DOC_NAME}[/bold]\n")

answer_table = Table(
    "Label", "Question (truncated)", "Pass", "Answer preview",
    show_lines=True,
    header_style="bold magenta",
)

for qa in QA_PAIRS:
    label = qa["label"]
    question = qa["question"]
    must_contain = qa["must_contain"]
    must_not_contain = qa["must_not_contain"]

    try:
        result = ask(question)
        answer = result["answer"]
        answer_lower = answer.lower()

        missing = [kw for kw in must_contain if kw.lower() not in answer_lower]
        hallucinated = [kw for kw in must_not_contain if kw.lower() in answer_lower]

        passed = not missing and not hallucinated
        detail_parts = []
        if missing:
            detail_parts.append(f"missing: {missing}")
        if hallucinated:
            detail_parts.append(f"hallucinated: {hallucinated}")
        detail = " | ".join(detail_parts)

        results.append({"label": label, "passed": passed, "detail": detail})

        preview = answer[:120].replace("\n", " ")
        q_short = question[:55] + ("…" if len(question) > 55 else "")
        status = "[green]✓ PASS[/green]" if passed else f"[red]✗ FAIL[/red]  {detail}"
        answer_table.add_row(label, q_short, status, preview)

    except Exception as e:
        results.append({"label": label, "passed": False, "detail": str(e)})
        answer_table.add_row(label, question[:55], f"[red]ERROR[/red]", str(e)[:80])

console.print(answer_table)

# ── 5. Multi-turn coherence ───────────────────────────────────────────────────
section("5 · Multi-turn Coherence")
rprint("  [dim]Checks that follow-up questions use conversation history...[/dim]\n")

try:
    r1 = ask("How many days of paid annual leave do full-time employees get?")
    cid = r1["conversation_id"]
    ok(f"Turn 1 answer: {r1['answer'][:100]}")

    r2 = ask("And what about contract staff?", conversation_id=cid)
    answer2_lower = r2["answer"].lower()
    # Contract staff get 10 days — should be in follow-up answer
    passed = "10" in answer2_lower
    detail = f"answer: {r2['answer'][:120]}"
    record("Follow-up resolves correctly (contract staff days)", passed, detail)
except Exception as e:
    record("Multi-turn follow-up", False, str(e))

# ── Cleanup ───────────────────────────────────────────────────────────────────
if doc_id:
    try:
        r = httpx.delete(f"{BASE}/api/documents/{doc_id}", timeout=10)
        r.raise_for_status()
        ok(f"Test document cleaned up (id={doc_id})")
    except Exception as e:
        warn(f"Cleanup failed: {e}")

# ── Summary ───────────────────────────────────────────────────────────────────
section("Summary")

answer_results = [r for r in results if r["label"] in {qa["label"] for qa in QA_PAIRS}]
other_results  = [r for r in results if r["label"] not in {qa["label"] for qa in QA_PAIRS}]

total   = len(results)
passed  = sum(1 for r in results if r["passed"])
failed  = total - passed

summary_table = Table("Category", "Passed", "Failed", "Score", header_style="bold")
for category, subset in [
    ("Infrastructure", [r for r in other_results if r["label"] in {"API reachable", "Postgres connected"}]),
    ("Ingestion",      [r for r in other_results if any(k in r["label"] for k in ("Upload", "chunk", "Chunk", "dedup", "listing", "Document"))]),
    ("Retrieval",      [r for r in other_results if any(k in r["label"] for k in ("Citation", "citation", "score", "Score"))]),
    ("Answer Quality", answer_results),
    ("Multi-turn",     [r for r in results if "Multi-turn" in r["label"] or "Follow-up" in r["label"]]),
]:
    p = sum(1 for r in subset if r["passed"])
    f = len(subset) - p
    pct = f"{100*p//len(subset)}%" if subset else "—"
    color = "green" if f == 0 else ("yellow" if p > 0 else "red")
    summary_table.add_row(category, str(p), str(f), f"[{color}]{pct}[/{color}]")

console.print(summary_table)
rprint(f"\n[bold]Total: {passed}/{total} passed[/bold]  ({'[green]ALL GOOD[/green]' if failed == 0 else f'[red]{failed} FAILED[/red]'})\n")

if failed > 0:
    rprint("[bold red]Failed checks:[/bold red]")
    for r in results:
        if not r["passed"]:
            rprint(f"  [red]✗[/red] {r['label']}: {r['detail']}")
    sys.exit(1)
