.PHONY: up down logs build dev-api

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f api

build:
	docker compose build

# Run the Python API locally (requires Postgres + Qdrant running via docker compose)
dev-api:
	cd backend && uv run uvicorn rkive.main:app --host 0.0.0.0 --port 3001 --reload
