# MongoDB → SQLite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MongoDB (Motor) with SQLite via SQLAlchemy 2.0 async so Quarry's backend runs with no database server, with no change to API behavior or the frontend.

**Architecture:** One SQLite table per Mongo collection: a string `id` primary key, real columns only for fields used in filters/joins/sorting/uniqueness, and a JSON `data` column for the rest. A small generic `DocTable` helper does the document↔row mapping, so each `app/db/*.py` module keeps its existing function names and signatures and becomes thin. The 12 direct `get_db()` call sites outside `app/db/` move behind repository functions. The old Mongo `database.py` stays importable until the final task so the app keeps importing throughout.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 (`sqlalchemy[asyncio]`), `aiosqlite`, pytest + pytest-asyncio (already in `requirements-dev.txt`).

**Spec:** `docs/superpowers/specs/2026-11-07-sqlite-migration-design.md`

## Global Constraints

- API responses keep identical shape: ids are strings, returned under the key `_id` wherever they are today.
- `DATABASE_URL` default is `sqlite+aiosqlite:///./quarry.db` (relative to `backend/`); `quarry.db*` is git-ignored.
- On every connection: `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`, `PRAGMA busy_timeout=5000`.
- Tables are created on startup (`create_all`); no Alembic yet.
- All primary keys are strings (UUID4 for new rows). Timestamps are naive UTC `datetime`, as today.
- No data migration. No frontend changes. No Postgres, no deployment files.
- Every uniqueness rule from the Mongo indexes is preserved (list in the spec's "How it works today").
- Final gate: `git grep -inE "mongo|motor|pymongo|bson"` returns nothing outside `docs/superpowers/` and git history.

## Review Focus

Failure modes the spec implies that most need a pinning test (each is added to the owning task below):

1. Two signups with the same email: second must fail the same way it does today (conflict), not crash with a raw DB error. (Task 2)
2. 25 concurrent writers during a scrape: no `database is locked` error. (Task 1)
3. Expired session token is rejected; unexpired one works. (Task 2)
4. A lead in several lists, and removing/deleting it: membership and reverse lookup stay consistent. (Task 5)
5. `datetime` values and unicode / large nested payloads inside JSON fields survive a round trip unchanged. (Task 1)
6. Leads with no `url` (legacy rows) do not collide on the `(request_id, url)` unique rule. (Task 4)

---

## File Structure

- Create `backend/app/db/engine.py` — async engine, session factory, `connect_db()`, `close_db()`, PRAGMAs, `create_all`.
- Create `backend/app/db/models.py` — SQLAlchemy models, one per table, plus the key-column registry.
- Create `backend/app/db/docstore.py` — generic `DocTable` helper (document↔row mapping, CRUD).
- Modify every `backend/app/db/*.py` repository module (bodies only; signatures unchanged).
- Modify callers listed per task; delete `backend/app/db/database.py` and `mongo_ids.py` in Task 6.
- Create `backend/tests/db/` — tests per task; `backend/tests/conftest.py` gains a `db` fixture.

---

### Task 1: Foundation — engine, models, DocTable

**Files:**
- Create: `backend/app/db/engine.py`, `backend/app/db/models.py`, `backend/app/db/docstore.py`
- Modify: `backend/pyproject.toml`, `backend/requirements.txt` (add `sqlalchemy[asyncio]`, `aiosqlite`; keep `motor` until Task 6), `backend/app/core/config.py` (add `DATABASE_URL`), `backend/.gitignore` (add `quarry.db*`), `backend/tests/conftest.py`
- Test: `backend/tests/db/test_docstore.py`

**Interfaces:**
- Produces (`engine.py`): `async def connect_db() -> None`; `async def close_db() -> None`; `def session() -> AsyncSession` usable as `async with session() as s:` (commits on clean exit when `s.begin()` is used by `DocTable`; callers use `DocTable`, not raw sessions, unless a task says otherwise).
- Produces (`models.py`): one model class per table (names in later tasks), and `TABLES: dict[str, DocTable]` keyed by collection name (`"users"`, `"leads"`, …) built from `docstore.DocTable(model, key_columns=[...])`.
- Produces (`docstore.py`): `class DocTable` with
  - `async def insert(self, doc: dict) -> str` — uses `doc["_id"]` if present, else new UUID4 string; returns the id.
  - `async def get(self, **eq) -> dict | None` — equality match on key columns or `id`.
  - `async def find(self, *where, order_by=None, limit=None) -> list[dict]` — `where` are SQLAlchemy conditions on the model; `order_by` is a model column or `.desc()`.
  - `async def update(self, id: str, fields: dict) -> dict | None` — merges into key columns / `data`, returns the new document or `None` if missing.
  - `async def upsert(self, match: dict, doc: dict) -> str` — update-or-insert on the given equality match.
  - `async def delete(self, id: str) -> bool`; `async def delete_where(self, *where) -> int`.
  - Returned documents always contain `_id` (str), every key column, and every key from `data`, flat. Keys with `None` for key columns are returned as `None`. `datetime` values inside `data` are stored as ISO strings and returned as `datetime`.

- [ ] **Step 1: Write failing tests** in `test_docstore.py` using the `db` fixture (a temp-file SQLite DB per test; fixture sets `DATABASE_URL`, calls `connect_db()`, yields, then `close_db()`). Tests: `test_insert_and_get_roundtrip` (key column + extra field + nested dict + list + unicode `"Zürich 日本語"` + ~1 MB string all return equal); `test_datetime_roundtrip_in_data` (naive UTC datetime in `data` comes back as an equal `datetime`); `test_update_merges_fields` (only given fields change); `test_unique_violation_raises_integrity_error` (second user with same `email` raises `sqlalchemy.exc.IntegrityError`); `test_two_null_urls_do_not_collide` (two leads with `url=None` for the same `request_id` insert fine); `test_25_concurrent_inserts_no_lock_errors` (`asyncio.gather` of 25 inserts into `leads`, all succeed).
- [ ] **Step 2: Run** `cd backend && .venv\Scripts\python -m pytest tests/db/test_docstore.py -q`; expected: FAIL (modules missing). First install deps: `uv pip install "sqlalchemy[asyncio]" aiosqlite pytest pytest-asyncio --python .venv\Scripts\python.exe`; set `asyncio_mode = "auto"` under `[tool.pytest.ini_options]` in `pyproject.toml` if absent.
- [ ] **Step 3: Implement** `engine.py`, `models.py` (all tables from the Task 2–5 lists below, with unique constraints and indexes from the spec; `lead_list_items(list_id, lead_id)` with a composite primary key and index on `lead_id`), and `docstore.py`. Approach: SQLAlchemy `JSON` type for `data` with a custom encoder/decoder that round-trips `datetime`; set PRAGMAs via an `event.listens_for(engine.sync_engine, "connect")` hook.
- [ ] **Step 4: Run** the same pytest command; expected: PASS (6 tests).
- [ ] **Step 5: Commit** `git add backend && git commit -m "feat(db): add SQLite engine, models, and DocTable helper"`

### Task 2: Identity — organizations, users, user_sessions

**Files:**
- Modify: `backend/app/db/organizations.py`, `users.py`, `user_sessions.py`; callers `backend/app/api/auth.py`, `google_auth.py`, `organizations.py`, `users.py`, `backend/app/services/auth.py` only where they import `mongo_ids` or rely on ObjectId behavior.
- Test: `backend/tests/db/test_identity.py`

**Interfaces:**
- Consumes: `TABLES["organizations" | "users" | "user_sessions"]` from Task 1.
- Produces: same public function names/signatures as today in these three modules (see `grep -n "^async def" app/db/{organizations,users,user_sessions}.py`). Key columns — organizations: `domain` (unique); users: `email` (unique), `google_id` (unique, nullable), `org_id`; user_sessions: `user_id`, `token_hash` (unique), `expires_at`. New: `async def purge_expired_sessions() -> int` in `user_sessions.py`.

- [ ] **Step 1: Write failing tests**: `test_insert_user_duplicate_email_fails_cleanly` (via the API signup route using `TestClient` and `db` fixture: second signup with same email returns the same status code the code returns today for an email conflict — read `api/auth.py` to find it, and assert on it); `test_check_email_conflict_excludes_self`; `test_get_session_ignores_expired` (insert a session with `expires_at` in the past, `get_session_by_token_hash` returns `None`; future one returns the doc); `test_purge_expired_sessions_deletes_only_expired`; `test_find_user_by_google_or_email_matches_either`.
- [ ] **Step 2: Run** `pytest tests/db/test_identity.py -q`; expected: FAIL.
- [ ] **Step 3: Rewrite the three modules** on `DocTable`, keeping signatures; replace `$or`/`$nin` logic with SQLAlchemy `or_`/`not_in`; make `get_session_by_token_hash` filter on `expires_at > now`; call `purge_expired_sessions()` from `connect_db()` and from login in `api/auth.py`. Wherever callers pass ObjectId-or-string ids, accept plain strings only.
- [ ] **Step 4: Run** `pytest tests/db/test_identity.py -q`; expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(db): move users, organizations, sessions to SQLite"`

### Task 3: Requests group — requests, product_intake, icp_profiles, competitor_analyses, competitors

**Files:**
- Modify: `backend/app/db/requests.py`, `product_intake.py`, `icp_profiles.py`, `competitor_analyses.py`, `competitors.py`; direct-access callers `backend/app/services/requests.py:35`, `request_intake_service.py:248,306`, `competitor_service.py:26`, `product_similarity.py:1070`.
- Test: `backend/tests/db/test_requests.py`

**Interfaces:**
- Consumes: Task 1 `TABLES`; Task 2 (user ids as strings).
- Produces: unchanged signatures for all existing functions. Key columns — requests: `user_id`, `org_id`, `status`, `created_at`, `updated_at`; product_intake / icp_profiles: `request_id` (unique); competitor_analyses: `request_id` (unique), `user_id`, `status`; competitors: `analysis_id`, `url`, `match_score`, unique `(analysis_id, url)`. New repository functions (one per former direct `get_db()` use; builder names them after what the caller does, e.g. `get_intake_and_icp_maps(request_ids) -> tuple[dict, dict]`, `count_and_score_enriched_leads(request_ids) -> dict[str, dict]` is a Task 4 dependency — leave a stub import and finish in Task 4 if the caller needs leads).

- [ ] **Step 1: Write failing tests**: `test_list_user_requests_sorted_by_updated_at_desc`; `test_get_user_request_stats_counts_by_status` (3 requests, 2 statuses → `{"Draft": 2, "Completed": 1}` style dict); `test_update_request_status_sets_time_taken`; `test_upsert_icp_profile_is_idempotent_per_request` (twice → one row, latest data); `test_delete_user_requests_removes_all_for_user_only`; `test_competitor_url_unique_per_analysis`.
- [ ] **Step 2: Run** `pytest tests/db/test_requests.py -q`; expected: FAIL.
- [ ] **Step 3: Rewrite the five modules** on `DocTable`; `get_user_request_stats` becomes one `GROUP BY status` query via a session; move each listed direct-access site into a named function in the matching `app/db` module and call it from the service.
- [ ] **Step 4: Run** `pytest tests/db -q`; expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(db): move requests, intake, ICP, competitors to SQLite"`

### Task 4: Leads group — leads, lead_enrichments, decision_makers, companies, signals

**Files:**
- Modify: `backend/app/db/leads.py`, `lead_enrichments.py`, `decision_makers.py`, `companies.py`, `signals.py`; direct-access callers `backend/app/api/leads.py:151,229,342,536` (+ the `db.leads.update_one` at ~550), `backend/app/services/leads.py:1216`, `backend/app/services/requests.py` aggregation (`_fetch_enrich_map`).
- Test: `backend/tests/db/test_leads.py`

**Interfaces:**
- Consumes: Task 1 `TABLES`; Task 3 `get_intake_and_icp_maps` (or equivalent).
- Produces: unchanged signatures. Key columns — leads: `request_id`, `user_id`, `url` (nullable), `match_score` (float), `enrichment_status`, unique `(request_id, url)`; lead_enrichments: `lead_id` (unique), `company_id`; decision_makers: `lead_id` (+ `request_id` if `get_decision_makers_for_request` filters on it — read the function); companies: `canonical_domain` (unique), `crunchbase_id` (unique, nullable), `linkedin_id` (unique, nullable). `signals.py`'s serper-result cache gets its own table `serper_cache` keyed by `query` (unique) with an `expires_at` column if the Mongo version expired entries. New: `async def count_enriched_leads_by_request(request_ids: list[str]) -> dict[str, dict]` returning, per request id, `{"count": int, "avg_score": float, "companies": list[str], "lead_ids": list[str], "legacy_dm_count": int}` — same keys the current `$group` stage produces; `async def count_decision_makers_by_lead(lead_ids: list[str]) -> dict[str, int]`.

- [ ] **Step 1: Write failing tests**: `test_save_leads_skips_duplicate_url_for_same_request`; `test_leads_without_url_do_not_collide`; `test_count_enriched_leads_by_request` (3 leads across 2 requests with known scores → exact counts, average, companies, `lead_ids`, and `legacy_dm_count` from embedded `decision_makers` lists); `test_insert_decision_maker_if_new_dedupes`; `test_upsert_company_unique_on_canonical_domain`; `test_get_normalized_leads_for_request_matches_shape` (compare the keys of the returned dicts to what `api/leads.py` reads — keep every key); `test_serper_cache_roundtrip`.
- [ ] **Step 2: Run** `pytest tests/db/test_leads.py -q`; expected: FAIL.
- [ ] **Step 3: Rewrite the five modules** on `DocTable`. Implement the two count functions with SQL for counts/averages and Python for `companies` / `lead_ids` / `legacy_dm_count` (fetch the matching leads, group in Python). Replace each direct `db.leads.*` call at the listed sites with a repository function.
- [ ] **Step 4: Run** `pytest tests/db -q`; expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(db): move leads, enrichments, companies, signals to SQLite"`

### Task 5: Lead lists

**Files:**
- Modify: `backend/app/db/lead_lists.py`; direct-access callers `backend/app/api/lists.py:116,213` (the two `db.leads.find({"_id": {"$in": lead_ids}})` calls); `backend/app/api/leads.py:573` uses `get_lists_for_lead` (signature unchanged).
- Test: `backend/tests/db/test_lead_lists.py`

**Interfaces:**
- Consumes: `TABLES["lead_lists"]`, the `lead_list_items` model from Task 1, leads repository from Task 4.
- Produces: unchanged signatures. Returned list documents still contain a `lead_ids: list[str]` key (built from `lead_list_items`) so `api/lists.py` and the frontend are unaffected. New: `async def get_leads_by_ids(lead_ids: list[str]) -> list[dict]` in `app/db/leads.py`.

- [ ] **Step 1: Write failing tests**: `test_add_leads_to_list_is_idempotent` (adding the same id twice keeps one membership); `test_remove_leads_from_list`; `test_lead_in_multiple_lists_reverse_lookup` (`get_lists_for_lead` returns both lists, scoped to the user); `test_delete_lead_list_removes_memberships`; `test_get_lead_lists_for_user_sorted_newest_first`; `test_lists_are_scoped_per_user` (another user's list id returns `None`).
- [ ] **Step 2: Run** `pytest tests/db/test_lead_lists.py -q`; expected: FAIL.
- [ ] **Step 3: Rewrite `lead_lists.py`** using `DocTable` for the list row and direct SQLAlchemy statements for `lead_list_items`; assemble `lead_ids` on read; replace the two `$in` lookups in `api/lists.py` with `get_leads_by_ids`.
- [ ] **Step 4: Run** `pytest tests/db -q`; expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(db): move lead lists to SQLite with membership table"`

### Task 6: Remove MongoDB

**Files:**
- Modify: `backend/app/main.py` (import `connect_db`/`close_db` from `app.db.engine`), `backend/app/core/config.py` (remove `MONGODB_URL`, `DATABASE_NAME`), `backend/.env.example` and local `backend/.env` (remove Mongo settings, add `DATABASE_URL`), `backend/pyproject.toml`, `backend/requirements.txt`, `uv.lock` (remove `motor`/`pymongo`; run `uv lock` if `uv` is available), `backend/tests/conftest.py` (drop Mongo env defaults), `backend/tests/test_health.py` (drop stale k8s wording; keep assertions), `backend/README.md`, `HLD.md`, `LLD.md` (data model, setup, config table: SQLite).
- Delete: `backend/app/db/database.py`, `backend/app/db/mongo_ids.py`.

**Interfaces:**
- Consumes: Tasks 1–5 complete; nothing imports `app.db.database` or `mongo_ids`.

- [ ] **Step 1: Write the failing gate**: add `backend/tests/test_no_mongo.py::test_no_mongo_references` that runs `git grep -inE "mongo|motor|pymongo|bson" -- . ":!docs"` from the repo root and asserts empty output.
- [ ] **Step 2: Run** it; expected: FAIL listing remaining references.
- [ ] **Step 3: Remove** the files and references above; update docs to describe SQLite setup (`uv sync`, run, database file location, how to move to Postgres via `DATABASE_URL`).
- [ ] **Step 4: Run** `pytest -q` (whole backend suite); expected: all PASS.
- [ ] **Step 5: Commit** `git commit -am "chore: remove MongoDB dependency and references"`

### Task 7: End-to-end verification and push

**Files:** none new (fixes only if something fails).

- [ ] **Step 1: Start the backend** (`.venv\Scripts\python -m uvicorn app.main:app --port 8000`) and the frontend (`npm run dev` in `frontend/`); expected: no MongoDB running anywhere, `curl localhost:8000/api/health` returns `{"status":"ok",...}` and `backend/quarry.db` exists.
- [ ] **Step 2: Walk the UI** at `http://localhost:3000` (Chrome tools): sign up → log out → log in → create a lead request/campaign → open its details page → create a lead list → add a lead to it (use a request that has leads if API keys allow; otherwise insert a lead through the repository in a Python shell) → delete the request. Expected: no error toasts, no 500s in the backend log.
- [ ] **Step 3: Fix** any failure with a failing test first (return to the owning task's test file), then re-run `pytest -q`.
- [ ] **Step 4: Confirm the gate**: `git grep -inE "mongo|motor|pymongo|bson" -- . ":!docs"` prints nothing.
- [ ] **Step 5: Commit any fixes and push** `git push origin main`; expected: remote `main` equals local `HEAD` (`git ls-remote origin`).

---

## Self-review notes

- Spec coverage: engine/PRAGMAs/create_all (T1), preserved uniques (T1 models + per-task tests), identifier/ObjectId removal (T2, T6), TTL replacement (T2), aggregations (T3, T4), join table (T1, T5), config/deps/docs (T6), definition-of-done steps 1–4 (T7).
- Direct `get_db()` sites: `api/leads.py` ×4, `api/lists.py` ×2, `services/{competitor_service,leads,product_similarity,requests,request_intake_service}` — all assigned (Tasks 3–5).
- Names used across tasks (`DocTable`, `TABLES`, `connect_db`, `count_enriched_leads_by_request`, `get_leads_by_ids`, `purge_expired_sessions`) match their defining task.
