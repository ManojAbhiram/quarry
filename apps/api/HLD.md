# High-Level Design: Quarry

## 1. What it does

Given an Ideal Customer Profile (ICP), or a list of companies the user already knows, Quarry finds matching
companies, enriches and scores them, finds decision makers and competitors, and lets the user curate and export the
results. All runs are asynchronous: launching returns a `request_id` immediately and the client follows progress by
polling or by server-sent events.

## 2. Components

```
Browser (React SPA, apps/web)
   |  HTTPS, HttpOnly cookie session + X-CSRF-Token on writes (Bearer header also accepted for API clients)
   v
FastAPI app (apps/api, uvicorn)
   |-- routers (app/api): auth, google_auth, users, organizations, requests, request_intake, leads, lists,
   |                      competitors, tech_stack, jobs
   |-- services (app/services): pipeline orchestration, LLM, scraping, scoring, enrichment, exports
   |-- job worker (app/jobs.py): polls the jobs table, runs handlers, retries, resumes after restart
   |-- repositories (app/db): SQLAlchemy async over SQLite, JSON-document tables
   v
External: LiteLLM providers (OpenRouter, Groq, ...), Serper (Google search), target websites (httpx / optional
Playwright), SMTP (password reset), Google OAuth
```

Everything runs in one process. SQLite is the only datastore; the job queue is a table in it, so there is no broker.

## 3. Request lifecycle

1. The user builds an ICP in the wizard (optionally seeding it from pasted text, URLs or files) or supplies a company
   list. `POST /api/requests/launch` (or `/launch-direct`) validates, persists the request as `Pending`, enqueues a
   `pipeline.run` / `pipeline.direct` job and returns 202.
2. The worker claims the job and runs the pipeline (section 4) while the lead and competitor pipelines run in
   parallel. Progress is observable through request status (`Pending`, `Completed`, `Failed`, with a
   `failure_reason`).
3. Results are read with `GET /api/leads?request_id=`; exports stream CSV, XLSX or PDF.
4. Users can star/exclude/validate companies, add them to lists, verify emails, run intent analysis on a lead, and
   retry a lead whose AI enrichment failed (a `lead.retry_enrichment` job).

## 4. Discovery pipeline

1. Generate search queries from the ICP (LLM) and store them on the request.
2. Search Google through Serper (the user's own key from Profile, else the server key).
3. De-duplicate URLs and classify each as a company site or a directory (LLM). Expand directories into nested
   company URLs.
4. In batches: research each company (Serper snippets), extract structured lead data and a match score (LLM),
   drop the seller itself and junk pages, find decision makers, until the requested number of leads is reached or the
   candidate pool is exhausted (one extra query round is allowed).
5. Enrich: tech stack and infrastructure detection, LinkedIn firmographics, funding/news/job/social signals.
6. Optionally filter by ICP score (off by default), save leads, companies, enrichments and decision makers, and mark
   the request `Completed` (or `Failed` with a reason).

## 5. Reliability

* **Durable jobs**: launches and retries are rows in `jobs` with status, attempts, backoff and result. A restart
  re-queues jobs that were `running`; a request whose job is queued is not failed by the startup orphan sweep.
* **Observable LLM failures**: provider errors, empty replies and unparsable replies are logged with model and
  purpose. Lead extraction keeps the lead and records `enrichment_failed` with a reason, which the UI shows with a
  retry action, instead of leaving unexplained blanks.
* **Deletion**: deleting a request or account also deletes the leads, decision makers and enrichments collected for
  it (third-party personal data); shared company facts are kept.

## 6. Security

* **Sessions**: short-lived JWT access token and rotating refresh token in HttpOnly cookies; refresh tokens are
  stored hashed server-side and can be revoked (logout). Cookie-authenticated writes require a CSRF header.
  There is no header-based identity shortcut.
* **SSRF**: every outbound fetch of a user-influenced URL goes through `core/url_guard.py` (public addresses only,
  DNS pinning, redirect re-checks, Playwright route guard).
* **Secrets**: users' Serper keys are encrypted at rest (`core/security_crypto.py`); secrets are never put in job
  payloads. Auth endpoints are rate limited.
* **CORS** is an explicit origin list with credentials enabled.

## 7. Known limits

* One process, one SQLite writer: fine for a single instance, not for horizontal scaling (the job table claim is
  only atomic within one process; move to Postgres with `SELECT ... FOR UPDATE SKIP LOCKED` to scale out).
* No schema migrations (`create_all` only).
* Pipeline resume after a crash re-runs the pipeline from the start (it is idempotent per lead URL but repeats
  API spend).
