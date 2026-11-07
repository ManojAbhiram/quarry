# High-Level Design — Quarry AI Lead Generation Agent

## 1. System Overview

Quarry is an AI-powered B2B lead generation backend. Given an **Ideal Customer Profile (ICP)** — business type, target location, and lead description — the system automatically:

1. Generates targeted Google search queries using an LLM
2. Searches the web via Serper API and collects company URLs
3. Classifies each URL (company site vs aggregator/directory)
4. Scrapes each company website, navigating to contact/about/team sub-pages
5. Extracts structured lead data (email, phone, company name, contact person) using an LLM
6. Persists all results in MongoDB

Clients interact through a REST API. The pipeline runs asynchronously in the background so the HTTP response returns immediately with a `request_id` the client polls.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT  (Frontend / API consumer)              │
└────────────────────┬────────────────────────────────────────────────────────┘
                     │ HTTPS REST
                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        FastAPI Application  (uvicorn)                       │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  /api/auth  │  │ /api/users  │  │ /api/requests│  │   /api/leads     │  │
│  │  register   │  │  profile    │  │  CRUD + stats│  │  trigger pipeline│  │
│  │  login      │  │  password   │  │              │  │  poll status     │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                │                │                    │            │
│         └────────────────┴────────────────┴────────────────────┘            │
│                                      │                                      │
│                          ┌───────────▼────────────┐                        │
│                          │   Services Layer        │                        │
│                          │                         │                        │
│                          │  ┌──────────────────┐  │                        │
│                          │  │  leads.py        │  │   Core pipeline        │
│                          │  │  (orchestrator)  │  │   (background task)    │
│                          │  └────────┬─────────┘  │                        │
│                          │           │             │                        │
│                          │  ┌────────┼──────────┐  │                        │
│                          │  │        │          │  │                        │
│                          │  ▼        ▼          ▼  │                        │
│                          │ groq   serper    scraper │                        │
│                          │  .py    .py        .py  │                        │
│                          └───┬──────┬──────────┬───┘                        │
│                              │      │          │                            │
└──────────────────────────────┼──────┼──────────┼────────────────────────────┘
                               │      │          │
             ┌─────────────────┘      │          └──────────────────────┐
             ▼                        ▼                                  ▼
   ┌──────────────────┐   ┌───────────────────────┐        ┌────────────────────┐
   │   Groq API       │   │   Serper API           │        │  Target Websites   │
   │                  │   │   (Google Search)      │        │                    │
   │  llama-3.3-70b   │   │   /search endpoint     │        │  homepage          │
   │  llama-3.1-8b    │   │   returns organic URLs │        │  /contact          │
   │                  │   │                        │        │  /about            │
   │  • query gen     │   │                        │        │  /team             │
   │  • URL classify  │   │                        │        │  /leadership       │
   │  • lead extract  │   │                        │        │                    │
   └──────────────────┘   └───────────────────────┘        └────────────────────┘
                                                                        │
             ┌──────────────────────────────────────────────────────────┘
             ▼
   ┌─────────────────────────────────────────────┐
   │              MongoDB (motor async)          │
   │                                             │
   │  Collections:                               │
   │    users      — registered accounts         │
   │    requests   — lead requests + results     │
   └─────────────────────────────────────────────┘
```

---

## 3. Component Breakdown

### 3.1 API Layer  (`app/api/`)

| Module | Prefix | Responsibility |
|--------|--------|----------------|
| `auth.py` | `/api/auth` | Register, login — returns JWT |
| `users.py` | `/api/users` | Profile read/update, password change, account delete |
| `requests.py` | `/api/requests` | CRUD for lead requests, aggregate stats |
| `leads.py` | `/api/leads` | Trigger pipeline, poll status, fetch results |
| `scrape_leads.py` | `/api/scrape` | Optional endpoint — scrape explicit URLs directly (bypass search) |

### 3.2 Service Layer  (`app/services/`)

| Module | Responsibility |
|--------|----------------|
| `leads.py` | **Pipeline orchestrator** — runs all 10 steps end-to-end |
| `groq.py` | All Groq LLM calls: query generation, URL classification, lead extraction |
| `serper.py` | Serper API wrapper — fires a single search query, returns JSON |
| `scraper.py` | Async web scraper — fetches homepage + discovers & fetches sub-pages |
| `auth.py` | JWT creation/verification, bcrypt password hashing, `get_current_user` dep |

### 3.3 Database Layer  (`app/db/`)

| Module | Responsibility |
|--------|----------------|
| `database.py` | Motor async client — `connect_db`, `close_db`, `get_db` |
| `leads.py` | All MongoDB read/write functions for `requests` collection |
| `mongo_ids.py` | ObjectId ↔ string normalisation — handles mixed-ID queries |

### 3.4 Scraper Package  (`scraper/`)

A standalone multi-provider AI scraper used by the `/api/scrape` direct-URL endpoint.

| Module | Responsibility |
|--------|----------------|
| `engine.py` | Orchestrates async site scraping + deduplication |
| `fetcher.py` | `httpx` async page fetcher + HTML text extractor |
| `discovery.py` | Finds internal sub-pages (team/contact/about) from homepage HTML |
| `parser.py` | Parses AI JSON response, regex fallback when no AI is available |
| `prompt.py` | Shared system prompt + user message template for all providers |
| `providers/` | OpenRouter (13 free models) → OpenAI → Claude → Gemini → Grok → Perplexity |
| `config.py` | API keys, free-model list, constants — initialises all provider clients |

### 3.5 Configuration  (`app/core/`)

| Module | Responsibility |
|--------|----------------|
| `config.py` | `Settings` class — loads `.env`, validates required keys at startup |
| `logger.py` | Structured `logging` setup — stdout handler, timestamp + level prefix |

---

## 4. End-to-End Data Flow

```
Client sends:
  POST /api/leads
  {
    "title": "Find EdTech leads in South India",
    "business_type": "SaaS CRM for colleges",
    "target_location": "Tamil Nadu, India",
    "ideal_lead_profile": "Private engineering colleges with 1000+ students",
    "budget_target_size": "50-500 students"
  }

──────────────────────────────────────────────────────────────────────
STEP 1  API layer (leads.py)
  • Validates body against CompleteLeadRequest schema
  • Calls insert_complete_lead_request() → creates MongoDB doc
    {_id, title, business_type, target_location, ideal_lead_profile,
     user_id, status:"Pending", created_at}
  • Registers _run_pipeline_background() as a BackgroundTask
  • Returns HTTP 202:  { request_id, status:"Pending" }

──────────────────────────────────────────────────────────────────────
STEP 2  Pipeline: Query Generation  (services/leads.py + services/groq.py)
  • Sends ICP context to Groq (llama-3.3-70b-versatile)
  • Groq returns 5 targeted queries:
    ["list of private engineering colleges Tamil Nadu",
     "top engineering colleges in Chennai",  ...]
  • Queries saved to MongoDB ($push → queries array)

──────────────────────────────────────────────────────────────────────
STEP 3  Pipeline: Web Search  (services/serper.py)
  • Fires each query at Serper API
  • Collects all organic results: [{title, url, snippet}, ...]
  • Deduplicates by URL

──────────────────────────────────────────────────────────────────────
STEP 4  Pipeline: URL Classification  (services/groq.py)
  • Sends all URLs + titles + snippets to Groq (llama-3.1-8b-instant)
  • Groq classifies each as "standalone" or "directory"
  • Standalone example: srmist.edu.in
  • Directory example:  ranking-sites.com/top-colleges

──────────────────────────────────────────────────────────────────────
STEP 5  Pipeline: Directory Expansion  (services/scraper.py)
  • For directory URLs: sync scrape in thread executor
  • Extracts all href links from the directory page
  • Newly found URLs re-classified by Groq
  • Merged into standalone list

──────────────────────────────────────────────────────────────────────
STEP 6  Pipeline: Basic Lead Save  (db/leads.py)
  • Saves pre-enrichment standalone items to MongoDB
    (title, url, snippet — no contact data yet)

──────────────────────────────────────────────────────────────────────
STEP 7  Pipeline: Scrape + Sub-page Discovery  (services/scraper.py)
  For each standalone URL (e.g. srmist.edu.in):
  a. Fetch homepage HTML  (async httpx)
  b. Parse HTML → find internal links matching:
     /contact, /about, /team, /people, /leadership, /management, …
  c. Fetch up to 5 sub-pages concurrently
  d. Strip scripts/nav/footer, extract visible text
  e. Combine all page text (capped at 12,000 chars)

──────────────────────────────────────────────────────────────────────
STEP 8  Pipeline: Lead Extraction  (services/groq.py)
  • Combined page text sent to Groq (llama-3.1-8b-instant)
  • Groq returns structured lead:
    {
      company_name, website, industry, location,
      contact_name, contact_title, contact_email, contact_phone,
      description, buying_signals, match_score (0–100)
    }

──────────────────────────────────────────────────────────────────────
STEP 9  Pipeline: Save Enriched Leads  (db/leads.py)
  • Enriched leads appended to MongoDB request doc
    ($push → enriched_leads array)
  • Flag has_enriched: true set on the doc

──────────────────────────────────────────────────────────────────────
STEP 10  Pipeline: Complete  (db/leads.py)
  • status updated to "Completed" (or "Failed" on unrecoverable error)

──────────────────────────────────────────────────────────────────────
Client polls:
  GET /api/leads/status/{request_id}
  → { status:"Completed", leads_count:14, queries_count:5 }

Client fetches results:
  GET /api/leads?request_id={id}
  → { leads: [...], total_found: 14 }
```

---

## 5. External Integrations

| Service | Purpose | Auth |
|---------|---------|------|
| **Groq API** | LLM inference (query gen, URL classification, lead extraction) | `GROQ_API_KEY` header |
| **Serper API** | Google search — returns organic results JSON | `X-API-KEY` header |
| **MongoDB** | Persistent storage for users, requests, leads | Connection string in `MONGODB_URL` |
| **OpenRouter** *(optional)* | Free LLM models for direct-URL scrape endpoint | `OPENROUTER_API_KEY` |
| **OpenAI / Claude / Gemini / Grok / Perplexity** *(optional)* | Paid fallback providers for direct-URL scrape endpoint | Individual API keys |

---

## 6. Authentication & Security

- **JWT Bearer tokens** — created on login/register, verified via `get_current_user` dependency injected into every protected route
- **bcrypt** password hashing — stored as `password_hash`, never plaintext
- **Token expiry** — configurable via `ACCESS_TOKEN_EXPIRE_MINUTES` (default: 60 min)
- **SECRET_KEY** — required at startup; no insecure fallback; raises `EnvironmentError` if missing
- **Error responses** — stack traces never leak to clients; logged server-side only
- **CORS** — restricted to `localhost:3000` and `localhost:5173` by default

---

## 7. Deployment Architecture

### Development (local)

```
.env  →  uvicorn app.main:app --reload
         │
         └── requires MongoDB at localhost:27017
             (local install or a MongoDB Atlas cluster)
```

### Hosted / production

No deployment setup yet — to be decided.

### Production Checklist

- [ ] Set `SECRET_KEY` to a cryptographically random 32-byte hex string
- [ ] Set `ACCESS_TOKEN_EXPIRE_MINUTES` to ≤ 60
- [ ] Set `ALLOWED_ORIGINS` to your actual frontend domain(s)
- [ ] Use MongoDB Atlas or secured replica set (not default credentials)
- [ ] Put the API behind a reverse proxy with TLS
- [ ] Add MongoDB indexes (see LLD §6)
- [ ] Set up log aggregation and alerting

---

## 8. Non-Functional Characteristics

| Concern | Design Decision |
|---------|----------------|
| **Latency** | Pipeline runs as background task — HTTP returns in < 200ms |
| **Concurrency** | FastAPI + Motor (async) — single process handles many concurrent requests |
| **Scalability** | Stateless API process — can horizontally scale behind a load balancer |
| **Reliability** | Background task catches all exceptions, sets status = "Failed" |
| **Observability** | Structured logging with timestamps and log levels to stdout |
| **Rate limits** | Serper search rate-limited per key; Groq has per-minute token limits |
| **Cost** | Groq is used for all LLM calls (free tier covers moderate usage) |
