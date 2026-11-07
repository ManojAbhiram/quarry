.PHONY: install env venv setup kill lint format

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


# ── Code quality ──────────────────────────────────────────────────────────────
lint:
	uv run ruff check .

format:
	uv run ruff format .

