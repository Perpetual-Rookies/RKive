.PHONY: up down logs build dev-api

local:
	make upOllama
	docker compose -f docker-compose.yml -f docker-compose.local.yml up -d

upOllama:
	docker compose up -d ollama
	docker compose exec ollama ollama run nomic-embed-text 'test'
up:
	make upOllama
	docker compose up --build

down:
	docker compose -f docker-compose.yml -f docker-compose.local.yml down

logs:
	docker compose logs -f api

build:
	docker compose build

# Run the Python API locally (requires Postgres + Qdrant running via docker compose)
dev-api:
	cd backend && uv run uvicorn rkive.main:app --host 0.0.0.0 --port 3001 --reload
