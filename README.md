# RKive

Reactive org-level knowledge chat: React UI, Node API, Python (uv) ingestion, **PostgreSQL**, **Qdrant**, and **Ollama** (you run Ollama where you like; the API uses `OLLAMA_BASE_URL`).

## Prerequisites

- Docker with Compose v2
- [Ollama](https://ollama.com/) on the host (or any URL reachable from the API container) with models pulled, for example:

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

## Quick start (Docker)

From the repo root:

```bash
cp .env.example .env
# Edit OLLAMA_BASE_URL if Ollama is not at host.docker.internal:11434 (see below).
make up
```

- **Web UI:** http://localhost:8080  
- **API only:** http://localhost:3001 (health: http://localhost:3001/health)

Upload a `.md` file from the UI, then ask questions in the chat. Answers use RAG over Qdrant; ingestion runs the Python package under `scripts/` via `uv run`.

### Ollama URL from Docker

- **Docker Desktop (Mac/Windows):** default `http://host.docker.internal:11434` in `.env.example` usually works (compose adds `extra_hosts: host.docker.internal:host-gateway` for Linux too).
- **Linux:** if `host.docker.internal` fails, set `OLLAMA_BASE_URL` to `http://172.17.0.1:11434` or your LAN IP, or run Ollama in a container on the same compose network and point to that hostname.

## Local development (without Docker for Node/React)

1. Start **Postgres** and **Qdrant** (e.g. `docker compose up postgres qdrant -d`).
2. **Backend:** `cd backend && cp ../.env.example ../.env` — set `DATABASE_URL`, `QDRANT_URL`, `OLLAMA_BASE_URL`, then `npm install && npm run dev`.
3. **Ingest scripts:** `cd scripts && uv sync` (requires [uv](https://github.com/astral-sh/uv)).
4. **Frontend:** `cd frontend && npm install && npm run dev` — Vite proxies `/api` and `/ws` to `http://localhost:3001` by default (`VITE_API_BASE` in `frontend/.env`).

## Environment variables

See [.env.example](.env.example). Important:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres (set automatically in compose for `api`) |
| `QDRANT_URL` | Qdrant REST URL |
| `QDRANT_COLLECTION` | Vector collection name (default `org-default`) |
| `OLLAMA_BASE_URL` | Ollama root URL (no trailing slash required) |
| `OLLAMA_CHAT_MODEL` / `OLLAMA_EMBED_MODEL` | Model names |
| `EMBEDDING_DIM` | Vector size for collection creation (768 for `nomic-embed-text`) |
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
- `backend/` — Express + WebSocket API, Drizzle + Postgres, Qdrant + Ollama  
- `scripts/` — uv project; `python -m rkive_ingest ingest …` for markdown → embeddings → Qdrant  
- `deploy/` — Dockerfiles and nginx config for the `web` service  

Optional port overrides: copy [docker-compose.override.example.yml](docker-compose.override.example.yml) to `docker-compose.override.yml` and edit.
