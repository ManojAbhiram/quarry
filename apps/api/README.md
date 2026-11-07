# Quarry Backend — AI-Powered B2B Lead Generation Engine

Quarry is an advanced, autonomous lead generation engine designed to discover, extract, and qualify B2B prospects at scale. By orchestrating a multi-stage AI pipeline, Quarry transforms high-level Ideal Customer Profiles (ICPs) into actionable business intelligence.

---

## 🏗️ Technical Architecture & Workflow

The engine operates through a high-performance asynchronous pipeline that ensures maximum coverage with minimal resource overhead.

### 1. Intelligent Discovery
- **Contextual Query Generation**: Utilizing LiteLLM (Groq/OpenRouter), the engine parses the user's ICP to generate 5-10 distinct, optimized search queries targeting specific domains, industries, and geographies.
- **Concurrent Search Execution**: Queries are processed in parallel via the Serper (Google) API to build a comprehensive candidate pool of company URLs.
- **URL Triage & Classification**: Each discovered URL is classified as either a "Standalone Company" or a "Directory/Aggregator."

### 2. Autonomous Scraping & Expansion
- **Directory Deep-Crawling**: For aggregator sites, the engine automatically extracts nested company links, expanding the reach of a single search result.
- **Hybrid Scraping Engine**: 
  - **Standard Mode**: High-speed fetching using HTTPX and BeautifulSoup4 for traditional websites.
  - **Playwright Fallback**: If a site is detected as a JavaScript-heavy Single Page Application (SPA), the engine spins up a headless Chromium instance via Playwright to ensure full content visibility.
- **Sub-page Discovery**: The scraper intelligently identifies and crawls `/contact`, `/about`, and `/team` pages to capture deep contact data and company metadata.

### 3. Data Mining & Enrichment
- **Structured Data Prioritization**: The parser prioritizes Schema.org (JSON-LD) blocks to extract deterministic fields like addresses, emails, and phone numbers before calling any AI models.
- **Universal Social Extraction**: Directly mines LinkedIn, X (Twitter), Facebook, and Crunchbase profiles from anchor tags, with smart filtering to ignore sharing intents.
- **AI Qualification**: Enriched data is processed by the LLM to calculate a **Match Score** and identify **Growth Signals** (e.g., funding rounds, leadership changes).

---

## ✨ Key Features

- **LiteLLM Orchestration**: Supports Groq, OpenAI, Gemini, and Anthropic with automatic model fallback and resilience.
- **High-Precision Filtering**: Integrated Regex validation for emails and phone numbers to ensure zero "placeholder" data enters the system.
- **Async Concurrency**: Leverages Python's `asyncio` with semaphore-controlled workers (up to 25 parallel scrapes) for massive throughput.
- **UV Powered**: Built using the modern Python toolchain for lightning-fast dependency management and isolated environments.

---

## 🛠️ API Reference

### Core Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/leads` | **Trigger Pipeline**: Submits ICP and launches background generation. |
| `GET` | `/api/leads/status/{id}` | **Poll Status**: Returns current progress (Pending/Completed/Failed). |
| `GET` | `/api/leads?request_id={id}` | **Fetch Results**: Returns all enriched leads for a specific run. |
| `GET` | `/api/requests/stats` | **Global Stats**: Real-time counts of successful vs pending leads. |

---

## 📦 Quick Start

### 1. Requirements
- Python 3.12+ & [uv](https://docs.astral.sh/uv/)
- Nothing else for the database: Quarry uses a local SQLite file (`quarry.db`), created on first start
- Serper API Key (Google Search)
- Groq or OpenRouter API Key (AI Inference)

### 2. Setup
```bash
# Install dependencies
cd backend
uv sync

# Configure environment
cp .env.example .env
# Edit .env with your SECRET_KEY and API keys
```

### 3. Run
```bash
uv run uvicorn app.main:app --reload
```
Interactive Swagger Docs: `http://localhost:8000/docs`

---

## 📁 Repository Structure

```text
apps/api/
├── app/
│   ├── api/            # REST API controllers & Auth logic
│   ├── core/           # Security, Logger, and Pydantic Config
│   ├── db/             # SQLite (SQLAlchemy async) engine, models and repositories
│   ├── schemas/        # Type-safe Pydantic models
│   └── services/       # Core Business Logic
│       ├── leads.py    # Master Pipeline Orchestrator
│       ├── llm.py      # LiteLLM Integration & Prompt Engineering
│       ├── scraper.py  # Hybrid Scraper (Playwright Fallback)
│       └── serper.py   # Search Discovery Client
└── pyproject.toml      # Modern UV dependency configuration
```

---

## 📁 Project Structure

```text
apps/api/
├── app/

---

## Environment Variables

| Variable | Required | Default | Description |
| -------- | -------- | ------- | ----------- |
| `SECRET_KEY` | **Yes** | — | JWT signing secret — use a 32-byte random hex string |
| `GROQ_API_KEY` | **Yes** | — | Groq API key — [console.groq.com](https://console.groq.com) |
| `SERPER_API_KEY` | **Yes** | — | Serper key — [serper.dev](https://serper.dev) |
| `DATABASE_URL` | No | `sqlite+aiosqlite:///./quarry.db` | SQLAlchemy async database URL (SQLite file by default; e.g. `postgresql+asyncpg://...` also works) |
| `GROQ_MODEL` | No | `llama-3.3-70b-versatile` | Model for query generation |
| `GROQ_MODEL_MINI` | No | `llama-3.1-8b-instant` | Model for classification + extraction |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | No | `60` | JWT lifetime |
| `SCRAPE_TIMEOUT` | No | `15` | HTTP request timeout in seconds |
| `OPENROUTER_API_KEY` | No | — | For `/api/scrape` direct-URL endpoint |

The server **will not start** without the three required variables — this prevents running with insecure defaults.

---

## Development

### Add a dependency

```bash
uv add <package-name>
```

### Database

Tables are created automatically on startup, and expired login sessions are purged then. The data lives in the file named by `DATABASE_URL` (`apps/api/quarry.db` by default, git-ignored). Delete the file to reset all data.

---

## Tech Stack

| Layer | Technology |
| ----- | ---------- |
| API framework | FastAPI + uvicorn |
| Database | SQLite via SQLAlchemy 2.0 async (`aiosqlite`) |
| LLM inference | Groq (llama-3.3-70b, llama-3.1-8b) |
| Web search | Serper API (Google) |
| Web scraping | httpx (async) + BeautifulSoup4 |
| Auth | JWT (python-jose) + bcrypt |
| Schema validation | Pydantic v2 |
| Package manager | uv |
