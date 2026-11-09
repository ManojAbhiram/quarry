# Low-Level Design: Quarry API

## 1. Module map

| Module | Responsibility |
| --- | --- |
| `app/main.py` | App factory and lifespan: connect DB, register job handlers, start the worker, sweep orphaned requests; on shutdown stop the worker and close the DB. CORS, global 500 handler, router registration. |
| `app/jobs.py` | Durable job queue and worker (section 3). |
| `app/core/config.py` | `Settings` read from env at import; `SECRET_KEY` and `SERPER_API_KEY` are required. |
| `app/core/cookies.py` | Session cookie helpers and CSRF double-submit check (section 5). |
| `app/core/url_guard.py` | SSRF protection for outbound fetches (httpx, requests, Playwright). |
| `app/core/rate_limit.py` | In-memory sliding-window limiter used by auth routes. |
| `app/core/security_crypto.py` | Fernet-style encryption for stored user Serper keys. |
| `app/core/scoring_config.py` | Score bands, pillar caps, confidence multipliers, decay constants. |
| `app/db/engine.py` | Async SQLAlchemy engine, WAL pragmas, write lock + write/read sessions, `connect_db`/`close_db`. |
| `app/db/docstore.py` | `DocTable`: maps flat documents to rows (`id`, key columns, JSON `data`). |
| `app/db/models.py` | One model per table and the `TABLES` registry. |
| `app/db/*.py` | One repository per table (requests, leads, companies, decision_makers, lead_enrichments, lead_lists, users, user_sessions, signals, erasure, ...). |
| `app/services/leads.py` | Pipeline orchestrator: `run_lead_pipeline`, `run_direct_companies_pipeline`, `retry_lead_enrichment`, `filter_leads_by_icp`. |
| `app/services/pipeline_jobs.py` | Job handlers (`pipeline.run`, `pipeline.direct`, `lead.retry_enrichment`) and startup helper `pending_pipeline_request_ids`. |
| `app/services/llm.py` | LiteLLM calls, prompts, `_llm_json_completion`, `LLMCompletionError`, lead extraction. |
| `app/services/scraper.py` | httpx + BeautifulSoup scraping, structured-data extraction, optional Playwright fallback. |
| `app/services/serper.py` | Serper client with per-pipeline key via the `current_serper_key` ContextVar and a result cache table. |
| `app/services/scoring.py` | 4-pillar intent score with decay. |
| `app/services/company_enrichment.py`, `signals/*` | LinkedIn firmographics and funding/news/job/social/tech signals. |
| `app/services/tech_stack*.py`, `infrastructure_detection.py`, `careers_tech_stack.py` | Technology fingerprinting. |
| `app/services/product_similarity.py`, `competitor_service.py` | Competitor discovery and comparison. |
| `app/services/export_service.py` | CSV, XLSX and PDF generation. |
| `app/services/auth.py` | Password hashing, JWT creation/verification, `get_current_user`. |

## 2. Data model

All tables have `id` (string PK) and `data` (JSON); the columns listed are the real, queryable key columns.

| Table | Key columns | Notes |
| --- | --- | --- |
| `organizations` | `domain` (unique) | |
| `users` | `email` (unique), `google_id` (unique), `org_id` | encrypted Serper key in `data` |
| `user_sessions` | `user_id`, `token_hash` (unique), `expires_at` | hashed refresh tokens |
| `requests` | `user_id`, `org_id`, `status`, `created_at`, `updated_at` | `failure_reason`, `queries`, list marks in `data` |
| `product_intake`, `icp_profiles` | `request_id` (unique) | |
| `competitor_analyses`, `competitors` | `request_id`/`analysis_id`, `url`, `match_score` | |
| `leads` | `request_id`, `user_id`, `url`, `match_score`, `enrichment_status` | unique `(request_id, url)`; `enrichment_failed`, `enrichment_failure_reason`, email verification and intent fields in `data` |
| `lead_enrichments` | `lead_id` (unique), `company_id` | |
| `decision_makers` | `lead_id` | |
| `companies` | `canonical_domain`, `crunchbase_id`, `linkedin_id` (all unique) | shared across requests, deduped by domain |
| `lead_lists`, `lead_list_items` | `user_id`, `created_at`; `(list_id, lead_id)` | |
| `serper_cache` | `query` (unique), `expires_at` | |
| `jobs` | `kind`, `owner_id`, `status`, `run_at`, `created_at` | `payload`, `attempts`, `max_attempts`, `result`, `error`, `started_at`, `finished_at` in `data` |

## 3. Job queue (`app/jobs.py`)

```python
job_id = await enqueue(kind, payload, owner_id=None, run_at=None, max_attempts=None)
register_handler(kind, async_fn)        # async def fn(payload: dict) -> dict | None
```

* Statuses: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
* The worker loop (`start_worker` / `stop_worker`, owned by the lifespan) claims the oldest due `queued` row inside a
  write transaction (status -> `running`, `attempts += 1`) and runs it as an asyncio task, up to
  `JOB_WORKER_CONCURRENCY` at a time.
* Outcomes: success stores `result`; `PermanentJobError` fails at once; any other exception re-queues with
  `run_at = now + min(max, base * 2^(attempt-1))` until `max_attempts`, then `failed` with the error text.
* `cancel_job`: a queued job becomes `cancelled`; a running job's task is cancelled (the handler sees
  `CancelledError`) and the row becomes `cancelled`.
* `recover_running_jobs` (called by `start_worker`): rows still `running` belong to a dead process; they are
  re-queued, or failed if attempts are exhausted. A graceful shutdown cancels handlers but leaves their rows `running`,
  so they resume the same way.
* `current_job_id` is a ContextVar available inside handlers.
* The pipeline handlers load the user's Serper key at run time (never stored in the payload), reset a stale `Failed`
  status to `Pending` on a resumed attempt, and raise `PermanentJobError` when the run ended `Failed`.

## 4. LLM calls and failure handling

`_llm_json_completion(model, system_prompt, user_prompt, ..., raise_on_error=False, purpose="")`:

1. JSON-mode completion with LiteLLM fallbacks; if it errors or returns nothing, retry once without JSON mode.
2. Unwrap and parse; failures are classified as `provider_error`, `empty_response`, `parse_error`, `not_an_object`
   and raised internally as `LLMCompletionError`.
3. The public helper logs the failure (model, purpose, reason, detail). With `raise_on_error=True` it re-raises;
   otherwise it returns `{}`.

`extract_lead_from_page` uses `raise_on_error=True`. On failure it returns the deterministic scraped fields plus
`enrichment_failed=True`, `enrichment_failure_reason` (user-facing text) and `enrichment_failure_code`. The lead is
kept (named from the page title), saved with those fields, returned by `GET /api/leads`, and shown in the UI. The
retry endpoint enqueues `lead.retry_enrichment`, which re-runs extraction and overwrites the lead in place.

## 5. Authentication

* `core/cookies.set_auth_cookies(response, access, refresh)` sets `quarry_access` (HttpOnly, path `/`),
  `quarry_refresh` (HttpOnly, path `/api/auth`) and `quarry_csrf` (readable, path `/`).
* `services/auth.get_current_user`: the `Authorization: Bearer` token wins; otherwise the `quarry_access` cookie is
  used and, for non-GET/HEAD/OPTIONS methods, `check_csrf` requires `X-CSRF-Token` to equal the CSRF cookie
  (`hmac.compare_digest`). Tokens must have `type` `access`, so a refresh token is not accepted as an access token.
* `POST /api/auth/refresh` takes the refresh token from the body or the cookie (cookie use requires CSRF), rotates the
  session row and sets fresh cookies. `POST /api/auth/logout` deletes the session and clears the cookies.
* SSE (`/api/leads/status/{id}/stream`) accepts the Bearer header, a `?token=` query parameter, or the cookie.

## 6. Scoring and filtering

* Match score (0-100) comes from the LLM during extraction and is stored on the lead.
* Intent score (`scoring.compute_intent_score`): firmographic (match score scaled to 25), technographic (20), intent
  signals (35) and engagement (20), each pillar capped, weights multiplied by confidence (1.0/0.75/0.5), intent and
  engagement decayed 15% per 30 days since the last signal; bands HOT/WARM/NURTURE/WATCH/COLD.
* `filter_leads_by_icp(leads, icp_dimensions, threshold=None)` is applied before saving only when
  `ICP_FILTER_ENABLED` is true: it drops leads under the threshold and employee sizes outside the ICP range, and never
  drops `enrichment_failed` leads.

## 7. Startup and shutdown order

Startup: `connect_db` (create tables, purge expired sessions) -> register handlers -> `start_worker` (recover running
jobs, begin polling) -> `fail_orphaned_requests(exclude_ids=pending pipeline request ids)`.
Shutdown: `stop_worker` (cancel handlers, leave rows resumable) -> `close_db`.

## 8. Testing

`tests/conftest.py` seeds throwaway env vars; the `db` fixture gives each test a fresh SQLite file. Tests mock all
external calls. Coverage includes the job queue, the pipeline end to end, LLM failure paths, scoring, exports, cookie
auth and CSRF, SSRF guards, ownership checks and cascade deletion.
