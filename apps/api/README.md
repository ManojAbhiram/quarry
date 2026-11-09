# Quarry API

FastAPI backend for Quarry, an AI-assisted B2B lead generation tool. A user describes an ideal customer; the API
generates search queries, discovers and scrapes candidate companies, enriches them with an LLM, scores them, finds
decision makers and competitors, and exposes everything over REST (plus a server-sent-events status stream).

Design docs: [`HLD.md`](HLD.md) (architecture) and [`LLD.md`](LLD.md) (modules, data model, flows).

## Quick start

Requirements: Python 3.12+ (3.13 is what CI uses). The database is a local SQLite file created on first start; no
server is needed.

```bash
cd apps/api
cp .env.example .env            # set SECRET_KEY, SERPER_API_KEY and at least one LLM provider key
uv sync                         # or: pip install -r requirements.txt -r requirements-dev.txt
uv run uvicorn app.main:app --reload     # http://localhost:8000  (Swagger UI at /docs)
```

The server refuses to start without `SECRET_KEY` and `SERPER_API_KEY`.

## Checks

```bash
uv run ruff check .             # lint (must be clean)
uv run pytest                   # backend tests; every external call (LLM, Serper, scraping) is mocked
```

CI (`.github/workflows/ci.yml`) runs the same two commands plus the web lint, vitest and build.

## Authentication

* Login, register, refresh and the Google callback set three cookies: `quarry_access` (HttpOnly, JWT),
  `quarry_refresh` (HttpOnly, JWT, path `/api/auth`) and `quarry_csrf` (readable, random).
* Browsers authenticate with the cookies. Unsafe requests (anything but GET/HEAD/OPTIONS) must echo the
  `quarry_csrf` value in an `X-CSRF-Token` header (double-submit). `GET /api/auth/csrf` returns it for
  cross-site deployments where the cookie is not readable.
* API clients and tests can use `Authorization: Bearer <access_token>` instead; that path needs no CSRF header.
  The token endpoints still return the tokens in the JSON body for such clients.
* Cookie flags: `COOKIE_SECURE` (default on when `FRONTEND_URL` is https), `COOKIE_SAMESITE` (default `lax`; `none`
  forces Secure) and `COOKIE_DOMAIN`.
* Google sign-in is a server-side redirect flow: `GET /api/auth/google` -> Google -> `GET /api/auth/google/callback`,
  which sets the cookies and redirects to `${FRONTEND_URL}/auth/google/callback?login=success`. No tokens appear in
  URLs. Register `GOOGLE_REDIRECT_URI` (default `http://localhost:8000/api/auth/google/callback`) with Google.

## Background jobs

Pipeline runs and enrichment retries execute on a durable queue (`app/jobs.py`, table `jobs`), not on in-process
`BackgroundTasks`. Jobs survive restarts: on startup, jobs left `running` are re-queued (or failed once their attempts
are used up) and requests belonging to queued pipeline jobs are not marked Failed.

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/jobs?status=&kind=&limit=` | The caller's jobs, newest first (payloads are never returned). |
| `GET` | `/api/jobs/{id}` | One job: `status` is queued, running, succeeded, failed or cancelled. |
| `POST` | `/api/jobs/{id}/cancel` | Cancel a queued or running job. |

Retries use exponential backoff (`JOB_BACKOFF_BASE_SECONDS`, capped by `JOB_BACKOFF_MAX_SECONDS`) up to
`max_attempts`. Pipeline jobs get two attempts (one automatic resume). If the queue cannot be written to, launching a
run falls back to in-process `BackgroundTasks` (the run then does not survive a restart).

## Main endpoints

| Area | Endpoints |
| --- | --- |
| Auth | `POST /api/auth/register`, `/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`; `GET /api/auth/csrf`, `/google`, `/google/url`, `/google/callback` |
| Users and orgs | `GET/PUT/DELETE /api/users/me`, `GET/PUT/DELETE /api/users/me/serper-key`, `POST /api/organizations`, `GET/PUT /api/organizations/me` |
| Requests | `GET/POST /api/requests`, `PUT/DELETE /api/requests/{id}`, `PUT /api/requests/{id}/lists`, `GET /api/requests/stats` |
| Launch flow | `POST /api/requests/analyze-source`, `/generate-icp`, `/check-consistency`, `/suggest-chip`, `/launch`, `/launch-direct`, `/parse-companies-csv`; `GET /api/requests/find-competitors` |
| Leads | `GET /api/leads`, `GET /api/leads/status/{request_id}` (+ `/stream` SSE), `GET /api/leads/decision-makers`, `POST /api/leads/{id}/retry-enrichment`, intent analysis, email verification |
| Exports | `GET /api/leads/{request_id}/export/{companies,competitors,decision-makers}?format=csv\|xlsx\|pdf` |
| Lists | `GET/POST /api/lists`, `GET/PUT/DELETE /api/lists/{id}`, `POST/DELETE /api/lists/{id}/leads`, `GET /api/lists/{id}/export` |
| Misc | `POST /api/tech-stack/detect`, `GET /api/health` |

## LLM failures

`_llm_json_completion` in `app/services/llm.py` logs every failure with its model, purpose and reason. By default it
still returns `{}` so best-effort callers keep working; callers that must explain a blank pass `raise_on_error=True`
and get an `LLMCompletionError` (`reason` is `provider_error`, `empty_response`, `parse_error` or `not_an_object`).
Lead extraction does this: a lead whose AI step failed is kept and stored with `enrichment_failed=true` and an
`enrichment_failure_reason`, the UI shows an "Enrichment failed" state, and `POST /api/leads/{id}/retry-enrichment`
queues a retry job.

## ICP filter

The pipeline can drop leads scoring below `ICP_SCORE_THRESHOLD` (or outside the ICP employee range) before saving.
It is off by default (`ICP_FILTER_ENABLED=false`) so nothing is silently discarded; leads whose enrichment failed are
never filtered out.

## Environment variables

See `.env.example` for the full annotated list. The ones that matter most:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SECRET_KEY` | yes | none | JWT signing secret (`openssl rand -hex 32`) |
| `SERPER_API_KEY` | yes | none | Default Serper key; users can store their own in Profile |
| `DATABASE_URL` | no | `sqlite+aiosqlite:///./quarry.db` | SQLAlchemy async URL |
| `LITELLM_MODEL`, `LITELLM_MODEL_MINI`, `LITELLM_FALLBACK_MODELS` | no | OpenRouter / Groq Llama models | LiteLLM model names |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY`, ... | per provider | none | Provider keys read by LiteLLM |
| `ALLOWED_ORIGINS` | no | `http://localhost:3000,http://localhost:5173` | CORS origins (credentials allowed) |
| `FRONTEND_URL` | no | `http://localhost:3000` | Post-login and password-reset redirects |
| `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_DOMAIN` | no | see above | Session cookie attributes |
| `JOB_WORKER_CONCURRENCY`, `JOB_POLL_INTERVAL_SECONDS`, `JOB_MAX_ATTEMPTS` | no | 4, 1.0, 3 | Job worker tuning |
| `ICP_FILTER_ENABLED`, `ICP_SCORE_THRESHOLD` | no | false, 60 | Optional score filter |

## Layout

```text
apps/api/
  app/
    main.py            app + lifespan (DB, job worker, startup recovery), routers, CORS
    jobs.py            durable job queue + worker (enqueue, register_handler, ...)
    api/               routers: auth, google_auth, users, organizations, requests, request_intake, leads, lists,
                       competitors, tech_stack, jobs
    core/              config, cookies (sessions + CSRF), logger, rate_limit, url_guard (SSRF), security_crypto, utils
    db/                engine + docstore (JSON-document tables on SQLite) and one repository module per table
    schemas/           Pydantic models
    services/          leads.py (pipeline), llm.py, scraper.py, serper.py, scoring.py, tech_stack*.py,
                       company_enrichment.py, product_similarity.py, signals/, export_service.py, pipeline_jobs.py ...
  tests/               pytest suite (pipeline, jobs, scoring, exports, LLM failures, auth cookies, DB, SSRF guard)
```

## Database

Tables are created on startup (`Base.metadata.create_all`); there are no migrations. Each table has a few real key
columns plus a JSON `data` column (see `app/db/docstore.py`). Adding a table is safe; changing a key column of an
existing table needs a manual migration or deleting the dev database file. Writes go through a process-wide lock
(SQLite allows one writer); reads use WAL snapshots.
