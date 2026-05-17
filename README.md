# RKive

**Hackathon Progress Tracker**:
- [x] **Phase 1:** Security — Hallucination Prevention & Prompt Injection Defence
- [x] **Phase 2:** Search Quality Improvement
- [x] **Phase 3:** Premium UI/UX Upgrade
- [x] **Phase 4:** Demo Data Preparation

Reactive org-level knowledge chat: React UI, Python API, Python (uv) ingestion, **PostgreSQL**, **Qdrant**, and a configurable LLM/embedding provider (Gemini by default).

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

Upload a `.md` file from the UI, then ask questions in the chat. Answers use RAG over Qdrant; ingestion runs the Python package under `scripts/` via `uv run`.

## Local development (without Docker for Node/React)

1. Start **Postgres** and **Qdrant** (e.g. `docker compose up postgres qdrant -d`).
2. **Backend:** `cd backend && cp ../.env.example ../.env` — set `DATABASE_URL`, `QDRANT_URL`, `LLM_PROVIDER`, and `LLM_API_KEY`, then `npm install && npm run dev`.
3. **Ingest scripts:** `cd scripts && uv sync` (requires [uv](https://github.com/astral-sh/uv)).
4. **Frontend:** `cd frontend && npm install && npm run dev` — Vite proxies `/api` and `/ws` to `http://localhost:3001` by default (`VITE_API_BASE` in `frontend/.env`).

## Environment variables

See [.env.example](.env.example). Important:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string |
| `QDRANT_URL` | Qdrant REST URL |
| `QDRANT_COLLECTION` | Vector collection name (default `org-default`) |
| `LLM_PROVIDER` | Provider name (`gemini` by default) |
| `LLM_API_KEY` | Provider API key |
| `LLM_CHAT_MODEL` / `EMBEDDING_MODEL` | Model names |
| `EMBEDDING_DIM` | Vector size for collection creation |
| `SCRIPTS_ROOT` | Path to `scripts/` (default: sibling of `backend/` in dev; `/app/scripts` in Docker) |

## Makefile

| Target | Command |
|--------|---------|
| `make up` | `docker compose up --build` |
| `make down` | `docker compose down` |
| `make logs` | Tail API logs |
| `make build` | Build images |

## Layout

- `frontend/` — Vite + React chat and upload UI  
- `backend/` — FastAPI API, Postgres, Qdrant, and provider adapters
- `scripts/` — uv project; `python -m rkive_ingest ingest …` for markdown → embeddings → Qdrant  
- `deploy/` — Dockerfiles and nginx config for the `web` service  

Optional port overrides: copy [docker-compose.override.example.yml](docker-compose.override.example.yml) to `docker-compose.override.yml` and edit.
