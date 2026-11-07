# Low-Level Design — Quarry AI Lead Generation Agent

## 1. Module & File Map

```
backend/
├── app/
│   ├── main.py                   FastAPI app, middleware, lifespan, routers
│   ├── core/
│   │   ├── config.py             Settings class — all env vars with validation
│   │   └── logger.py             Root logger configuration
│   ├── db/
│   │   ├── database.py           Motor async client singleton
│   │   ├── leads.py              All read/write operations on requests collection
│   │   └── mongo_ids.py          ObjectId ↔ string query helpers
│   ├── api/
│   │   ├── auth.py               POST /register  POST /login
│   │   ├── users.py              GET/PUT /me  PUT /me/password  DELETE /me
│   │   ├── requests.py           GET/POST /requests  GET /requests/{id}  DELETE
│   │   ├── leads.py              POST /leads  GET /leads  GET /leads/status/{id}
│   │   └── scrape_leads.py       POST /scrape  (optional, direct-URL endpoint)
│   ├── schemas/
│   │   ├── __init__.py           Auth + user schemas, request_to_out, user_to_out
│   │   ├── leads.py              Lead, CompleteLeadRequest, SearchQueryList, …
│   │   └── users.py              Minimal user schema (reserved)
│   └── services/
│       ├── auth.py               JWT, bcrypt, get_current_user
│       ├── leads.py              Pipeline orchestrator (10 steps)
│       ├── groq.py               All Groq LLM calls
│       ├── scraper.py            Async web scraper + sub-page discovery
│       └── serper.py             Serper API client
├── scraper/                      Standalone multi-provider scraper package
│   ├── config.py                 API keys, model list, provider client init
│   ├── engine.py                 scrape_leads_from_urls() entry point
│   ├── fetcher.py                fetch_page(), extract_text()
│   ├── discovery.py              discover_lead_pages()
│   ├── parser.py                 parse_ai_response(), regex_fallback()
│   ├── prompt.py                 SYSTEM_PROMPT, build_user_message()
│   └── providers/
│       ├── __init__.py           run_provider_chain() — ordered fallback chain
│       ├── openrouter.py         13 free OpenRouter models in sequence
│       ├── openai.py             gpt-4o-mini fallback
│       ├── claude.py             claude-3-haiku fallback
│       ├── gemini.py             gemini-1.5-flash fallback
│       ├── grok.py               grok-beta fallback
│       └── perplexity.py         llama-3.1-sonar fallback
├── routers/
│   └── leads.py                  Legacy direct-scrape router (not mounted)
├── .env                          Local secrets (git-ignored)
├── .env.example                  Template for onboarding
├── docker-compose.yml            MongoDB + backend containers
├── Dockerfile                    python:3.12-slim image
├── pyproject.toml                uv/pip dependencies
└── requirements.txt              Pip-compatible dependency list
```

---

## 2. Database Schema

### Collection: `users`

```json
{
  "_id":           ObjectId | string,
  "email":         "user@example.com",
  "name":          "Jane Smith",
  "password_hash": "$2b$12$...",
  "company":       "Acme Corp" | null,
  "job_title":     "Sales Engineer" | null,
  "phone":         "+1-555-000-0000" | null
}
```

Indexes to add:
```
{ "email": 1 }   unique: true
```

---

### Collection: `requests`

This is the primary working collection — one document per pipeline run.

```json
{
  "_id":              "uuid4-string",
  "user_id":          "ObjectId-as-string",
  "title":            "Find EdTech leads in South India",
  "business_type":    "SaaS CRM for colleges",
  "target_location":  "Tamil Nadu, India",
  "ideal_lead_profile": "Private engineering colleges with 1000+ students",
  "budget_target_size": "50-500",
  "status":           "Pending | Completed | Failed",
  "created_at":       ISODate,
  "updated_at":       ISODate,

  "queries": [
    "list of private engineering colleges Tamil Nadu",
    "top engineering colleges in Chennai site:.edu.in"
  ],

  "leads": [
    {
      "user_id":     "...",
      "title":       "SRM Institute of Science and Technology",
      "url":         "https://www.srmist.edu.in",
      "snippet":     "India's premier engineering university...",
      "email":       "",
      "phone":       "",
      "description": "",
      "match_score": "0",
      "type":        "standalone"
    }
  ],

  "enriched_leads": [
    {
      "user_id":       "...",
      "title":         "SRM Institute of Science and Technology",
      "url":           "https://www.srmist.edu.in",
      "email":         "admissions@srmist.edu.in",
      "phone":         "+91-44-2745-5510",
      "description":   "Premier private university offering B.Tech programs",
      "match_score":   "87",
      "snippet":       "Expanding enrolment — procurement cycle open",
      "type":          "enriched",
      "company_name":  "SRM Institute",
      "industry":      "Higher Education",
      "location":      "Chennai, Tamil Nadu",
      "contact_name":  "Dr. Rajesh Kumar",
      "contact_title": "Director of Admissions"
    }
  ],

  "has_enriched": true
}
```

Indexes to add:
```
{ "user_id": 1, "created_at": -1 }
{ "_id": 1, "user_id": 1 }
{ "status": 1 }
```

---

## 3. Pydantic Schemas

### `app/schemas/leads.py`

```python
class CompleteLeadRequest(BaseModel):
    title:               str
    business_type:       str
    target_location:     str
    ideal_lead_profile:  str
    budget_target_size:  Optional[str] = None

class Lead(BaseModel):
    id:           Optional[str]   # alias="_id"
    user_id:      str
    title:        str
    url:          str
    email:        str
    phone:        str
    description:  str
    match_score:  str
    snippet:      str
    type:         str

class SearchQueryList(BaseModel):
    queries: List[str]            # min 2, max 10

class SiteClassification(BaseModel):
    url:       str
    site_type: Literal["standalone", "directory"]
    reasoning: str

class BatchClassificationResponse(BaseModel):
    results: List[SiteClassification]
```

### `app/schemas/__init__.py`

```python
class RegisterRequest(BaseModel):
    email:    EmailStr
    password: str        # min 6 chars (validated)
    name:     str

class LoginRequest(BaseModel):
    email:    EmailStr
    password: str

class UserOut(BaseModel):
    id:        str
    email:     str
    name:      str
    company:   Optional[str]
    job_title: Optional[str]
    phone:     Optional[str]

class AuthResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user:         UserOut

class LeadRequestCreate(BaseModel):
    business_type:       str
    ideal_lead_profile:  str
    budget_target_size:  Optional[str]
    target_location:     str

class LeadRequestOut(BaseModel):
    id:                  str
    title:               str
    business_type:       str
    location:            str
    status:              str
    date:                str
    ideal_lead_profile:  Optional[str]
    budget_target_size:  Optional[str]

class StatsOut(BaseModel):
    total_leads: int
    pending:     int
    completed:   int
```

---

## 4. API Endpoints

### Authentication

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/auth/register` | None | `RegisterRequest` | `AuthResponse` 201 |
| POST | `/api/auth/login` | None | `LoginRequest` | `AuthResponse` 200 |

### Users

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| GET | `/api/users/me` | Bearer | — | `UserOut` |
| PUT | `/api/users/me` | Bearer | `ProfileUpdate` | `UserOut` |
| PUT | `/api/users/me/password` | Bearer | `PasswordUpdate` | 204 |
| DELETE | `/api/users/me` | Bearer | — | 204 |

### Lead Requests (metadata CRUD)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| GET | `/api/requests` | Bearer | — | `List[LeadRequestOut]` |
| POST | `/api/requests` | Bearer | `LeadRequestCreate` | `LeadRequestOut` 201 |
| GET | `/api/requests/stats` | Bearer | — | `StatsOut` |
| GET | `/api/requests/{id}` | Bearer | — | `LeadRequestOut` |
| GET | `/api/requests/{id}/results` | Bearer | — | `GenerateLeadsResponse` |
| DELETE | `/api/requests/{id}` | Bearer | — | 204 |

### Lead Pipeline

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/leads` | Bearer | `CompleteLeadRequest` | `{ request_id, status }` 202 |
| GET | `/api/leads/status/{request_id}` | Bearer | — | `{ status, leads_count, queries_count }` |
| GET | `/api/leads?request_id={id}` | Bearer | — | `{ leads, total_found, status }` |

### Direct Scrape (optional)

| Method | Path | Auth | Request Body | Response |
|--------|------|------|-------------|----------|
| POST | `/api/scrape` | Bearer | `ScrapeLeadsRequest` | `List[LeadOut]` |

### Health

| Method | Path | Auth | Response |
|--------|------|------|----------|
| GET | `/api/health` | None | `{ status, project, version }` |

---

## 5. Function Signatures

### `app/services/leads.py`

```python
async def run_lead_pipeline(request_id: str, request_payload: dict) -> list[dict]
    """Full 10-step pipeline. request_payload must contain user_id."""

async def handle_lead_request(current_user: dict, body: CompleteLeadRequest) -> dict
    """Insert request + run pipeline. Returns { request_id, leads_count }."""

# Internal helpers
async def _generate_and_store_queries(request_id: str, payload: dict) -> list[str]
async def _fetch_all_serper_results(queries: list[str]) -> list[dict]
async def _expand_directories(directory_items: list[dict]) -> list[dict]
async def _scrape_and_extract(standalone_items, context, request_id, user_id) -> list[dict]
def   _deduplicate_urls(results: list[dict]) -> list[dict]
```

### `app/services/groq.py`

```python
async def generate_sales_queries(context: dict) -> list[str]
    """Groq: generate 5 Google queries from ICP context. Returns [] on failure."""

def classify_results_batch(serper_items: list[dict]) -> list[dict]
    """Groq: classify URLs as standalone/directory. Returns [{url, site_type, reasoning}]."""

def process_serper_results_batch(serper_data: list[dict]) -> tuple[list[dict], list[dict]]
    """Classify + split into (standalone_leads, directory_sources)."""

def extract_lead_from_page(page_text: str, url: str, context: dict) -> dict
    """Groq: extract one lead's structured data from page text."""

def extract_leads_from_pages(pages: list[dict], context: dict) -> list[dict]
    """Iterate pages, call extract_lead_from_page, return enriched list."""
```

### `app/services/scraper.py`

```python
async def scrape_url_with_discovery(url: str) -> str
    """
    Async. Fetches homepage + discovers /contact /about /team sub-pages.
    Returns combined cleaned text capped at MAX_SCRAPE_TEXT_CHARS.
    """

def scrape_url(url: str) -> str
    """Sync. Single-page fetch + HTML clean. Run in thread executor."""

def scrape_directory_links(directory_url: str) -> list[str]
    """Sync. Scrape directory page, return all same-domain hrefs. Run in thread executor."""

def _discover_subpages(html: str, base_url: str) -> list[str]
    """Parse HTML for internal links matching contact/about/team keywords. Max 5."""

def _clean_html(html: str) -> str
    """Strip script/style/nav/footer tags; collapse whitespace."""
```

### `app/services/serper.py`

```python
async def fetch_leads_from_serper(query: str) -> dict
    """POST to Serper API. Returns full response dict (access .get('organic'))."""
```

### `app/services/auth.py`

```python
def hash_password(password: str) -> str
def verify_password(plain: str, hashed: str) -> bool
def create_access_token(user_id: str) -> str
async def get_current_user(credentials: HTTPAuthorizationCredentials) -> dict
    """FastAPI dependency. Decodes JWT, fetches user from DB. Raises 401 on failure."""
```

### `app/db/leads.py`

```python
async def insert_complete_lead_request(request_data: dict, user_id: str) -> str
    """Insert new request doc. Returns string _id."""

async def update_request_status(request_id: str, status: str) -> None

async def add_queries_to_lead_request(request_id: str, queries: list[str]) -> None

async def process_and_save_standalone_leads(
    serper_data: list[dict], request_id: str, user_id: str
) -> List[Lead]
    """Save pre-enrichment Lead objects (no contact data yet)."""

async def save_leads_to_db(request_id: str, leads: List[Lead]) -> None
    """Append Lead model instances to the request.leads array."""

async def save_enriched_leads_to_db(
    request_id: str, user_id: str, enriched: List[dict]
) -> None
    """Append extracted lead dicts to the request.enriched_leads array."""

async def get_lead_request(request_id: str, user_id: str) -> dict | None
```

### `app/db/mongo_ids.py`

```python
def id_query(field: str, value: Any) -> dict
    """Build {field: {$in: [ObjectId, string]}} for mixed-ID tolerance."""

def normalize_object_id(value: Any) -> Any
    """Convert valid ObjectId strings to ObjectId; others unchanged."""

def id_values(value: Any) -> list
    """Return [ObjectId, string] representations — used in $nin queries."""
```

---

## 6. Pipeline Step Detail

```
run_lead_pipeline(request_id, payload)
│
├── [1] generate_sales_queries(payload)          — async Groq call
│         model: llama-3.3-70b-versatile
│         max_tokens: 1000
│         response_format: json_object
│         output: SearchQueryList.queries
│
├── [2] add_queries_to_lead_request(...)          — MongoDB $push
│
├── [3] fetch_leads_from_serper(query) × N        — async httpx POST
│         endpoint: https://google.serper.dev/search
│         extracts: organic[].{title, link, snippet}
│         normalises: link → url
│
├── [4] _deduplicate_urls(results)                — O(n) set dedup
│
├── [5] process_serper_results_batch(urls)        — sync Groq call
│         classify_results_batch():
│           model: llama-3.1-8b-instant
│           max_tokens: 2000
│           response_format: json_object
│           builds class_map: {url → site_type}
│           splits: standalone_items / directory_items
│
├── [6] _expand_directories(directory_items)      — thread executor
│         scrape_directory_links(url):
│           sync requests.get → BeautifulSoup
│           returns same-domain hrefs
│         re-classifies expanded links via Groq
│         deduplicates again
│
├── [7] process_and_save_standalone_leads(...)    — MongoDB $push
│         saves Lead(url, title, snippet, type="standalone")
│
├── [8] _scrape_and_extract(standalone, ctx, ...)
│     │
│     ├── for each url:
│     │     scrape_url_with_discovery(url):      — async httpx
│     │       GET homepage → _discover_subpages() → GET sub-pages
│     │       _clean_html() × all pages
│     │       join + cap at 12,000 chars
│     │
│     └── loop.run_in_executor(extract_leads_from_pages, pages, ctx):
│               for each page:
│                 extract_lead_from_page(text, url, ctx):
│                   model: llama-3.1-8b-instant
│                   max_tokens: 1000
│                   extracts: company_name, website, industry, location,
│                             contact_name, contact_title, contact_email,
│                             contact_phone, description, buying_signals,
│                             match_score (0–100)
│
├── [9] save_enriched_leads_to_db(...)            — MongoDB $push enriched_leads
│         maps extracted dict → storage schema
│         sets has_enriched: true
│
└── [10] update_request_status("Completed")       — MongoDB $set status
```

---

## 7. Groq LLM Call Summary

| Function | Model | Purpose | Input | Output |
|----------|-------|---------|-------|--------|
| `generate_sales_queries` | `llama-3.3-70b-versatile` | Build search queries | Full ICP context JSON | `SearchQueryList` |
| `classify_results_batch` | `llama-3.1-8b-instant` | Classify URLs | URL + title + snippet per result | `[{url, site_type, reasoning}]` |
| `extract_lead_from_page` | `llama-3.1-8b-instant` | Extract contact data | Page text (≤8,000 chars) + ICP | Lead field JSON |

All calls use `response_format: {"type": "json_object"}` to guarantee parseable output.

---

## 8. Configuration Reference

All values read from `.env` via `python-dotenv`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | **Yes** | — | JWT signing secret (min 32 random chars) |
| `GROQ_API_KEY` | **Yes** | — | Groq API key |
| `SERPER_API_KEY` | **Yes** | — | Serper (Google Search) API key |
| `MONGODB_URL` | No | `mongodb://quarry:quarry_secret@localhost:27017/quarry?authSource=admin` | MongoDB connection string |
| `DATABASE_NAME` | No | `quarry` | MongoDB database name |
| `GROQ_MODEL` | No | `llama-3.3-70b-versatile` | Model for query generation |
| `GROQ_MODEL_MINI` | No | `llama-3.1-8b-instant` | Model for classification + extraction |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `60` | JWT lifetime |
| `SCRAPE_TIMEOUT` | No | `15` | Per-request HTTP timeout (seconds) |
| `OPENROUTER_API_KEY` | No | — | Free LLM provider for /scrape endpoint |
| `OPENAI_API_KEY` | No | — | Paid fallback for /scrape endpoint |
| `ANTHROPIC_API_KEY` | No | — | Paid fallback for /scrape endpoint |
| `GEMINI_API_KEY` | No | — | Paid fallback for /scrape endpoint |
| `GROK_API_KEY` | No | — | Paid fallback for /scrape endpoint |
| `PERPLEXITY_API_KEY` | No | — | Paid fallback for /scrape endpoint |

The three Required keys are validated at startup by `_require()` in `config.py` — the server will not start without them.

---

## 9. Error Handling

| Layer | Mechanism |
|-------|----------|
| **Schema validation** | Pydantic raises `422 Unprocessable Entity` automatically for invalid request bodies |
| **Auth failures** | `get_current_user` raises `401` with `"Invalid or expired token"` |
| **Not found** | Endpoint raises `404` explicitly after `find_one` returns `None` |
| **Pipeline exceptions** | `_run_pipeline_background` wraps entire pipeline in try/except; sets status = `"Failed"` |
| **Groq call failure** | Each function returns `[]` / `{}` on exception — pipeline continues with empty data |
| **Scrape failure** | `scrape_url_with_discovery` returns `""` on homepage failure; non-fatal sub-page failures logged and skipped |
| **Serper failure** | Per-query failures logged as warnings; other queries continue |
| **Global handler** | `app/main.py` exception handler logs full traceback server-side, returns `{"detail": "Internal server error"}` to client |

---

## 10. Suggested MongoDB Indexes

Run once after first deployment:

```javascript
// users collection
db.users.createIndex({ "email": 1 }, { unique: true })

// requests collection
db.requests.createIndex({ "user_id": 1, "created_at": -1 })
db.requests.createIndex({ "_id": 1, "user_id": 1 })
db.requests.createIndex({ "status": 1 })
```
