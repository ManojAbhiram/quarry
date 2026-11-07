.PHONY: help install env mongo stop-mongo dev up down restart logs logs-mongo logs-backend shell lint format indexes

# ── Variables ─────────────────────────────────────────────────────────────────
PORT ?= 8000


# ── Setup ─────────────────────────────────────────────────────────────────────
install:
	uv sync


env:
	@if [ -f .env ]; then \
		echo ".env already exists — skipping (delete it first to reset)"; \
	else \
		cp .env.example .env && \
		echo ".env created — fill in GROQ_API_KEY, SERPER_API_KEY, SECRET_KEY"; \
	fi

venv:
	@if [ -d .venv ]; then \
		echo "Virtual environment already exists — skipping (delete .venv first to reset)"; \
	else \
		python3 -m venv .venv && \
		echo "Virtual environment created in .venv"; \
	fi

setup: venv env install

# ── Local development ─────────────────────────────────────────────────────────

kill:
	npx kill-port $(PORT)


build-app:
	docker compose build backend


up:
	docker compose up --build -d

down:
	docker compose down

restart: down up


mongo-logs:
	docker compose logs -f mongodb

app-logs:
	docker compose logs -f backend

app-shell:
	docker compose exec backend /bin/bash


mongo-shell:
	docker compose exec mongodb mongosh

# ── Code quality ──────────────────────────────────────────────────────────────
lint:
	uv run ruff check .

format:
	uv run ruff format .

