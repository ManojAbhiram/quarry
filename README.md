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
cp .env.example .env        # then set SECRET_KEY; configure your provider keys in Account
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

## Personal API connections and introduction

New password and Google accounts receive a six-stop introduction. Existing accounts are not enrolled. Skip or finish persists per account; an interrupted introduction offers Resume on a later session.

Account settings stores each user's Serper and AI provider credentials encrypted. Saving a key never performs a test search or generation. AI providers are OpenAI, Anthropic, Gemini, Groq, OpenRouter and DeepSeek, called directly; primary and optional fast models replace global model settings. Background work reloads the owner's keys. Operator provider keys and LiteLLM fallbacks are no longer used.

**Current rollout:** OpenRouter model discovery is enabled through its documented anonymous public catalogue. In Account, save an OpenRouter key, refresh models, choose a primary/optional fast model and save those choices. Discovery never sends the saved key or performs generation; credentials and model access stay unverified. The other five providers remain deferred under the strict metadata billing rule. See [connection rollout notes](docs/user-api-connections.md) and the [reviewed metadata policy](docs/provider-metadata-policy.md).
