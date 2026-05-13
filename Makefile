.PHONY: up down logs build

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f api

build:
	docker compose build
