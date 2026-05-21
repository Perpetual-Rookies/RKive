# RKive

**Hackathon Progress Tracker**:
- [x] **Phase 1:** Security — Hallucination Prevention & Prompt Injection Defence
- [x] **Phase 2:** Search Quality Improvement
- [x] **Phase 3:** Premium UI/UX Upgrade
- [x] **Phase 4:** Demo Data Preparation

Reactive org-level knowledge chat: React UI, FastAPI backend, markdown and PDF ingestion, **PostgreSQL**, **Qdrant**, and a simple single-endpoint LLM/embedding setup.

## Current Features

- Markdown and PDF document upload with visibility-aware ingestion
- PDF text extraction and markdown-aware processing
- Deduplicated re-upload flow using document checksums
- Markdown-aware chunking with overlap to improve retrieval quality on longer documents
- Metadata-aware embeddings that include filename and visibility context
- Qdrant vector retrieval with visibility filtering
- Lightweight second-stage reranking before context is sent to the LLM
- Grounded answers with citations back to uploaded documents
- Streaming chat UI over WebSocket
- Basic backend unit tests for ingestion, reranking, visibility normalization, and upload deduplication

## Prerequisites

- Docker with Compose v2
- A `.env` file copied from `.env.example`

## Quick start (Docker)

From the repo root:

```bash
cp .env.example .env
make up
```

- **Web UI:** http://localhost:8080  
- **API only:** http://localhost:3001 (health: http://localhost:3001/health)

Upload a `.md` or `.pdf` file from the UI, then ask questions in the chat. Answers use a RAG pipeline over Qdrant:

1. documents are chunked into smaller passages
2. each chunk is embedded and stored with metadata
3. the question is embedded at query time
4. candidate chunks are retrieved from Qdrant
5. candidates are reranked before being sent to the LLM
6. the final answer is streamed back with citations

## Local development (without Docker for Node/React)

1. Start **Postgres** and **Qdrant** (e.g. `docker compose up postgres qdrant -d`).
2. **Backend:** `cp .env.example .env`, set `DATABASE_URL`, `QDRANT_URL`, and `LLM_CHAT_MODEL` / `EMBEDDING_MODEL`, then run `make dev-api`.
3. **Frontend:** `cd frontend && npm install && npm run dev` — Vite proxies `/api` and `/ws` to `http://localhost:3001` by default (`VITE_API_BASE` in `frontend/.env`).

## Search and Retrieval Notes

- Ingestion normalizes visibility labels so filtering stays consistent across upload and chat.
- Re-uploading the same file reuses the existing document record and replaces prior vectors instead of duplicating them.
- Chunk embeddings include filename and visibility text so document metadata can influence semantic retrieval.
- Retrieval is intentionally two-stage:
  - Qdrant provides a broader candidate set for recall
  - a local reranker reorders and trims that set before prompt construction
- The current reranker is a lightweight heuristic, not a cross-encoder model. It is optimized for hackathon simplicity and reliability.

## Environment variables

See [.env.example](.env.example). Important:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string |
| `QDRANT_URL` | Qdrant REST URL |
| `QDRANT_COLLECTION` | Vector collection name (default `org-default`) |
| `LLM_API_KEY` | Optional auth header for chat (only if your endpoint requires it) |
| `EMBEDDING_API_KEY` | Optional auth header for embeddings (only if your embedding endpoint requires it) |
| `LLM_CHAT_MODEL` / `EMBEDDING_MODEL` | Model names |
| `LLM_BASE_URL` | Base URL for chat |
| `EMBEDDING_BASE_URL` | Optional separate base URL for embeddings (defaults to `LLM_BASE_URL`) |
| `EMBEDDING_DIM` | Vector size for collection creation |
| `SCRIPTS_ROOT` | Path to `scripts/` (default: sibling of `backend/` in dev; `/app/scripts` in Docker) |

## Makefile

| Target | Command |
|--------|---------|
| `make up` | `docker compose up --build` |
| `make down` | `docker compose down` |
| `make logs` | Tail API logs |
| `make build` | Build images |
| `make dev-api` | Run the FastAPI backend locally with `uvicorn` |

## Tests

Backend tests currently use the Python standard library `unittest` framework.

Run them inside Docker:

```bash
docker compose build api
docker compose up -d api
docker compose exec api python -m unittest discover -s tests -v
```

## Layout

- `frontend/` — Vite + React chat and upload UI  
- `backend/` — FastAPI API, Postgres, Qdrant, and provider adapters
- `scripts/` — uv project; `python -m rkive_ingest ingest …` for markdown → embeddings → Qdrant  
- `deploy/` — Dockerfiles and nginx config for the `web` service  

Optional port overrides: copy [docker-compose.override.example.yml](docker-compose.override.example.yml) to `docker-compose.override.yml` and edit.
