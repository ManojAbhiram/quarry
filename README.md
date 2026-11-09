# Quarry

AI-powered B2B lead generation: describe your ideal customer, and Quarry discovers, enriches and qualifies matching companies and decision makers.

## Layout

| Path | What it is |
|---|---|
| `apps/api` | FastAPI backend (Python 3.12, SQLite via SQLAlchemy). See [`apps/api/README.md`](apps/api/README.md). |
| `apps/web` | React + Vite + Tailwind frontend. See [`apps/web/README.md`](apps/web/README.md). |
| `docs` | Design docs and implementation plans. |

## Run it locally

No database server is needed: the API creates a SQLite file (`apps/api/quarry.db`) on first start.

```bash
# API  (http://localhost:8000)
cd apps/api
cp .env.example .env        # then set SECRET_KEY, SERPER_API_KEY and an LLM key
uv sync
uv run uvicorn app.main:app --reload

# Web  (http://localhost:3000, proxies /api to the API)
cd apps/web
npm install
npm run dev
```

In development the web app also serves a component showcase at `http://localhost:3000/ui-lab`.

## Tests and checks

```bash
cd apps/api && uv run pytest          # backend tests (pytest is a dev dependency, so plain `uv sync` keeps it)
cd apps/api && uv run ruff check .    # lint
cd apps/web && npm run lint && npx vitest run && npm run build
```

CI (`.github/workflows/ci.yml`) runs all of the above on pushes and pull requests.

## Colour palettes

The web app ships seven palettes (Quarry, Midnight, Amethyst, Emerald, Sunset, Rosewood, Graphite). Pick one with the
palette button in the header; it is saved in the browser. Palettes are defined in `apps/web/src/config/palettes.js`.
