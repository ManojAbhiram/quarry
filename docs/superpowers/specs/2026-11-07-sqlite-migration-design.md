# Quarry: move the database from MongoDB to SQLite (design)

Date: 2026-11-07 · Status: draft, awaiting owner approval

## Intent and why

Quarry is now a personal project with no deployment target. The owner tried to install MongoDB to run it locally, stopped, and asked for the best database instead. A database that needs no server removes that step: clone, `uv sync`, run. The owner wants the backend to start with nothing installed beyond Python.

## Goals

- Replace MongoDB (Motor/PyMongo) with SQLite accessed through SQLAlchemy 2.0 async (`aiosqlite`).
- The app starts and works with zero external services. The database is a single file (`backend/quarry.db`, git-ignored).
- Keep all HTTP API behavior and response shapes identical, so the React frontend needs no changes.
- Make a later move to Postgres a small change (connection URL plus minor tweaks), not a rewrite.

## Non-goals

- No migration of existing data. There is none worth keeping; the owner starts fresh.
- No frontend changes, no API changes, no new features.
- No deployment/hosting work. No Postgres now.
- Not a redesign of the pipeline, scoring, or scraping logic.

## Anti-goals (a failure even if it "works")

- Changing the shape of any API response (for example `_id` becoming `id`, or ids no longer being strings).
- Silently dropping a uniqueness rule or index that the Mongo version enforced.
- A hidden Mongo-emulation layer that fakes `$set`/`$in` semantics and is hard to reason about.

## How it works today (relevant facts)

- 17 modules in `backend/app/db/` (~1,400 lines) wrap 14 collections: organizations, users, user_sessions, requests, product_intake, icp_profiles, competitor_analyses, competitors, leads, lead_enrichments, decision_makers, companies, lead_lists, plus signals.
- Most calls are simple: `find_one`, `insert_one`, `update_one` with `$set`, `delete_one`, `find(...).sort(...)`, and `$in`/`$or`/`$nin` filters.
- Callers outside `app/db/` also reach into the database directly through `get_db()` (28 places across `api/leads.py`, `api/lists.py`, `services/requests.py`, `services/leads.py`, `services/competitor_service.py`, `services/product_similarity.py`). These must be moved behind repository functions.
- A handful of aggregations: `$group`/`$match` with `$sum`, `$avg`, `$push`, `$addToSet`, `$size`, `$ifNull` (request lists with lead counts and average score, decision-maker counts, per-status request stats).
- Ids are mixed: some documents use string UUIDs, others (users, requests) use Mongo ObjectIds, normalised through `db/mongo_ids.py`.
- Indexes to preserve: unique on organizations.domain, users.email, users.google_id (sparse), user_sessions.token_hash, product_intake/icp_profiles/competitor_analyses.request_id, lead_enrichments.lead_id, companies.canonical_domain (+ sparse unique crunchbase_id, linkedin_id), leads (request_id, url) sparse unique, competitors (analysis_id, url) sparse unique; multikey on companies.tech_stack and lead_lists.lead_ids (used for reverse lookup); a TTL index that expires user_sessions.

## Approaches considered

1. **Hybrid tables (chosen).** One table per collection with an `id` text primary key, real columns only for fields used to filter, join, sort, or enforce uniqueness, and a `data` JSON column for everything else. The existing function names and signatures in `app/db/*` are kept, so most callers do not change. The 28 direct `get_db()` uses become new repository functions.
   Trade-off: JSON fields cannot be queried as cheaply as columns, but the code rarely queries inside them, and enrichment payloads change shape often.
2. **Fully relational schema.** Every field becomes a column, with child tables for lists such as decision makers and tech stack. Cleanest long term, but the highest effort and risk: hundreds of fields, and enrichment data that keeps changing shape.
3. **Mongo-compatible shim.** Implement `find_one`/`$set`/`$in` over SQLite so callers do not change at all. Smallest diff, but it hides behavior, is brittle at the aggregations, and is an anti-goal above.

Chosen: approach 1. It keeps the change contained in the data layer and keeps the API identical. (The owner delegated this choice; this is the author's call.)

## Design

- **Engine/session:** `app/db/database.py` creates an async SQLAlchemy engine from `DATABASE_URL` (default `sqlite+aiosqlite:///./quarry.db`). On connect it enables `PRAGMA journal_mode=WAL`, `foreign_keys=ON`, and a busy timeout of ~5 s, then creates tables if missing. A session-per-operation helper replaces `get_db()`.
- **Models:** `app/db/models.py` holds one SQLAlchemy model per table, with the key columns and unique constraints listed above (SQLite already allows many NULLs in a unique column, which replaces Mongo's sparse indexes). `lead_lists.lead_ids` becomes a join table `lead_list_items(list_id, lead_id)` so the reverse lookup is a normal indexed query. `companies.tech_stack` stays in JSON unless a query needs it as rows (see "left to the builder").
- **Ids:** all primary keys become strings. New rows get UUID4 strings. API output keeps the key name `_id` where it is returned today. `db/mongo_ids.py` and the `bson` dependency are removed.
- **Timestamps:** stored as UTC datetimes, same as today.
- **Sessions expiry (replaces the TTL index):** reads ignore expired rows, and expired rows are deleted at startup and on login.
- **Aggregations:** rewritten as SQL (`GROUP BY`, `COUNT`, `AVG`) in repository functions. Where a grouped list of titles or ids is needed, fetch the rows and group in Python.
- **Config:** add `DATABASE_URL`; remove `MONGODB_URL`, `DATABASE_NAME`, `MONGO_USERNAME`, `MONGO_PASSWORD` from config, `.env.example`, and docs. Dependencies: add `sqlalchemy[asyncio]`, `aiosqlite`; remove `motor`, `pymongo`. Update `requirements.txt`, `pyproject.toml`, `uv.lock`.
- **Docs:** update README, HLD, and LLD (data model, setup steps, "MongoDB" mentions).
- **Tests:** install pytest/pytest-asyncio; run tests against a temporary SQLite file. Add repository tests for: unique constraints, session expiry, list membership and reverse lookup, request stats, the lead-count aggregation.

## Constraints

- Python/FastAPI app with ~25 concurrent scrape workers: SQLite allows one writer at a time. WAL mode plus short transactions should be enough; if writes block, batch inserts per scrape result.
- The API contract must stay unchanged; the frontend is the proof.

## Verification (definition of done)

1. Backend starts with no database server installed; `GET /health` returns OK.
2. Backend tests pass.
3. Through the real UI: sign up, log in, create a request, view it, create a lead list, add a lead to it, delete the request.
4. `git grep -i "mongo\|motor\|pymongo\|bson"` returns nothing outside git history and this document.

## Left to the builder

- Which columns each table needs as real columns versus JSON (rule: used in a `WHERE`, `JOIN`, `ORDER BY`, or uniqueness check).
- Exact repository function names for the 28 direct-access sites.
- Whether companies.tech_stack needs a child table based on how it is queried.
- Migrations: the author's call is `create_all` on startup now, and add Alembic when the schema settles.
- Splitting the work into steps (data layer first, then callers) is the builder's call.
