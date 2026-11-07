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
