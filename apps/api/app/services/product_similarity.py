"""
Product Similarity Pipeline

Discovers real-market competitors for a product using:
  1. LLM-generated search queries
  2. Serper Google Search API
  3. LLM URL classification (standalone vs directory)
  4. LLM match scoring using Serper title + snippet as evidence

No website scraping — all inference is done from search result metadata.
"""

import asyncio
import json
import logging
import re
from urllib.parse import urlparse, parse_qs, unquote

from bs4 import BeautifulSoup

from app.core.config import settings
from app.core.url_guard import GuardedAsyncClient
from app.db.competitors import create_competitor_run, update_competitor_run_status
from app.services.llm import _llm_json_completion
from app.services.scraper import scrape_url_with_discovery
from app.services.serper import fetch_leads_from_serper

logger = logging.getLogger("app.services.product_similarity_pipeline")

_MODEL = settings.LITELLM_MODEL
_MODEL_MINI = settings.LITELLM_MODEL_MINI

_DENY_DOMAINS = {
    "linkedin.com", "facebook.com", "twitter.com", "x.com",
    "instagram.com", "youtube.com", "reddit.com", "pinterest.com",
    "github.com", "gitlab.com", "medium.com", "wikipedia.org",
    "stackoverflow.com", "quora.com", "trustpilot.com",
}


# =============================================================================
# STEP 1 — QUERY GENERATION
# =============================================================================

async def generate_competitor_queries(product_description: str) -> list[str]:
    """Generate competitor-discovery Google search queries from a product description."""

    if not product_description or not product_description.strip():
        return []

    system_prompt = """
        You are a search query generation engine for a B2B competitor discovery pipeline.

        Your task is to generate Google search queries that retrieve REAL COMPANY WEBSITES
        offering products similar to the described product.

        IMPORTANT:
        The product/company may be:

        very new
        unknown
        niche
        pre-category
        early-stage

        Therefore:

        NEVER generate queries using:
        competitor names
        "alternatives to X"
        "competitors of X"
        direct company references
        NEVER assume the market already has a recognized category
        NEVER generate comparison/listicle-style queries intended for blogs

        Your goal is to maximize retrieval of:

        official SaaS websites
        startup product websites
        B2B product landing pages
        vendor/company pages

        Search behavior rules:

        Queries must resemble realistic Google searches
        Queries should target:
        capabilities
        workflows
        pain points
        use cases
        automation tasks
        operational problems
        infrastructure patterns
        integrations
        buyer intent
        Queries should naturally surface company domains

        Avoid queries likely to return:

        blogs
        educational articles
        Reddit
        directories
        review platforms
        generic SEO listicles

        Do NOT include:

        years
        "top 10"
        "best"
        "review"
        "vs"
        "compare"
        "alternatives"

        Generate diverse retrieval angles with high semantic coverage.
        Return only valid JSON.
    """

    user_prompt = f"""
        PRODUCT DESCRIPTION:
        {product_description}

        Generate 15 highly diverse Google search queries that can discover
        real companies building similar products.

        The queries should focus on:

        * core functionality
        * business workflows
        * automation use cases
        * operational problems solved
        * infrastructure behavior
        * target users
        * integrations
        * platform behavior
        * technical capabilities
        * business outcomes

        GOOD QUERY EXAMPLES:

        * customer onboarding workflow automation
        * AI outbound sales personalization platform
        * warehouse inventory forecasting software
        * API monitoring alerting platform
        * clinical documentation automation
        * browser based video editing platform
        * ecommerce return management software
        * AI contract review workflow
        * logistics dispatch optimization software

        BAD QUERY EXAMPLES:

        * competitors of X
        * alternatives to X
        * best tools for X
        * top X platforms
        * X vs Y
        * review of X

        Rules:

        * 3-8 words per query
        * highly specific
        * commercially relevant
        * each query should target a different semantic angle
        * avoid near-duplicates
        * no quotation marks
        * no numbering
        * no explanations

        Return ONLY:
        {{
        "queries": [
        "query 1",
        "query 2"
        ]
        }}
    """


    parsed = await _llm_json_completion(
        model=_MODEL,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=800,
        timeout=25,
    )

    if not parsed:
        return []

    queries = parsed.get("queries", [])

    if not isinstance(queries, list):
        return []

    return [str(q).strip() for q in queries if str(q).strip()]


# =============================================================================
# STEP 2 — FETCH SEARCH RESULTS
# =============================================================================

async def _run_single_query(query: str) -> list[dict]:
    try:
        data = await fetch_leads_from_serper(query)
        organic = data.get("organic", [])
        return [
            {
                "url": item.get("link", ""),
                "title": item.get("title", ""),
                "snippet": item.get("snippet", ""),
                "source_query": query,
            }
            for item in organic
            if item.get("link")
        ]
    except Exception as exc:
        logger.warning("Serper query failed: %s -> %s", query, exc)
        return []


async def fetch_all_search_results(queries: list[str]) -> list[dict]:
    """Run all queries concurrently and collect organic results."""

    batches = await asyncio.gather(
        *(_run_single_query(q) for q in queries),
        return_exceptions=True,
    )

    results: list[dict] = []
    for batch in batches:
        if isinstance(batch, Exception):
            continue
        results.extend(batch)

    return results


# =============================================================================
# STEP 3 — DEDUPLICATION & NOISE FILTERING
# =============================================================================

def _normalize_url_for_dedup(url: str) -> str:
    if not url:
        return ""
    normalized = url.strip()
    normalized = re.sub(r"^https?://", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"^www\.", "", normalized, flags=re.IGNORECASE)
    normalized = normalized.split("?")[0].split("#")[0].rstrip("/")
    return normalized.lower()


def _extract_domain(url: str) -> str:
    try:
        parsed = urlparse(url)
        netloc = (parsed.netloc or "").lower()
        if netloc.startswith("www."):
            netloc = netloc[4:]
        return netloc
    except Exception:
        return ""


def deduplicate_and_filter(results: list[dict]) -> list[dict]:
    """Remove duplicates and strip noise/social domains."""

    seen: set[str] = set()
    unique: list[dict] = []

    for item in results:
        url = item.get("url") or ""

        if not url:
            continue

        domain = _extract_domain(url)

        if any(deny in domain for deny in _DENY_DOMAINS):
            continue

        normalized = _normalize_url_for_dedup(url)

        if not normalized or normalized in seen:
            continue

        seen.add(normalized)
        item["normalized_url"] = normalized
        unique.append(item)

    return unique


# =============================================================================
# STEP 4 — CLASSIFY: STANDALONE vs DIRECTORY
# =============================================================================

async def _classify_batch(items: list[dict]) -> list[dict]:
    """LLM classifies a batch of URLs as standalone or directory."""

    compact = [
        {
            "id": i,
            "url": item["url"],
            "title": (item.get("title") or "")[:120],
            "snippet": (item.get("snippet") or "")[:250],
        }
        for i, item in enumerate(items)
    ]

    system_prompt = (
        "Classify web search results as 'standalone' or 'directory'. "
        "standalone = a single company's official product/website. "
        "directory = an aggregator, review platform, list, or marketplace "
        "containing multiple different companies. Return JSON only."
    )

    user_prompt = f"""Classify each result below.

Examples:
- standalone: stripe.com, notion.so, hubspot.com, salesforce.com
- directory: g2.com, capterra.com, getapp.com, producthunt.com, softwareadvice.com

Data:
{json.dumps(compact, indent=2)}

Return ONLY:
{{
  "classifications": [
    {{"id": 0, "type": "standalone"}},
    {{"id": 1, "type": "directory"}}
  ]
}}
"""

    parsed = await _llm_json_completion(
        model=_MODEL_MINI,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=1500,
        timeout=20,
    )

    if not parsed:
        return []

    return parsed.get("classifications", [])


async def classify_and_filter_standalones(items: list[dict]) -> list[dict]:
    """Classify all items in parallel batches, return only standalone URLs."""

    chunk_size = 25
    chunks = [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]

    batch_results = await asyncio.gather(
        *(_classify_batch(chunk) for chunk in chunks),
        return_exceptions=True,
    )

    standalone_items: list[dict] = []

    for chunk_idx, (chunk, result) in enumerate(zip(chunks, batch_results, strict=False)):
        if isinstance(result, Exception):
            logger.warning("Classification chunk %d failed: %s", chunk_idx, result)
            # Conservative fallback: include all on failure
            for item in chunk:
                item["site_type"] = "standalone"
                standalone_items.append(item)
            continue

        type_map = {
            c["id"]: c.get("type", "directory")
            for c in result
            if isinstance(c, dict) and "id" in c
        }

        for i, item in enumerate(chunk):
            site_type = type_map.get(i, "directory")
            item["site_type"] = site_type
            if site_type == "standalone":
                standalone_items.append(item)

    logger.info(
        "Classification: %d standalone out of %d total",
        len(standalone_items),
        len(items),
    )

    return standalone_items


# =============================================================================
# STEP 5 — BLOG & ARTICLE FILTERING
# =============================================================================

_BLOG_URL_PATH_PATTERNS = {
    "/blog/", "/blogs/", "/news/", "/article/", "/articles/",
    "/post/", "/posts/", "/press-release", "/press-releases",
    "/tips/", "/guide/", "/guides/", "/how-to", "/tutorial", "/tutorials/",
    "/learn/", "/learning/", "/resources/", "/resource/",
    "/case-study/", "/case-studies/", "/whitepaper/", "/whitepapers/",
    "/ebook/", "/webinar/", "/webinars/", "/podcast/", "/podcasts/",
    "/insights/", "/insight/", "/opinion/", "/analysis/",
    "/author/", "/authors/", "/category/", "/tag/", "/tags/",
    "/events/", "/event/", "/glossary/", "/wiki/",
}

_BLOG_DOMAINS = {
    "techcrunch.com", "forbes.com", "businessinsider.com", "venturebeat.com",
    "zdnet.com", "wired.com", "theverge.com", "inc.com", "entrepreneur.com",
    "fastcompany.com", "thenextweb.com", "sifted.eu", "crunchbase.com",
    "wsj.com", "nytimes.com", "reuters.com", "bloomberg.com",
    "substack.com", "wordpress.com", "blogspot.com", "pcmag.com",
    "cnet.com", "gartner.com", "forrester.com", "g2.com", "capterra.com",
    "getapp.com", "trustradius.com", "softwareadvice.com", "producthunt.com",
    "indiehackers.com", "hackernoon.com", "dev.to",
}

_BLOG_TITLE_SIGNALS = {
    "how to ", "guide to ", "what is ", "step-by-step", "step by step",
    "top 10 ", "top 5 ", "top 7 ", "top 15 ", "top 20 ", "top 50 ",
    "best practices", "tutorial:", "learn how", "introduction to",
    "getting started", "a complete guide", "the complete guide",
    "everything you need to know", "tips for ", "tips and tricks",
    "beginners guide", "beginner's guide", "ultimate guide",
}


def filter_non_company_standalones(items: list[dict]) -> list[dict]:
    """
    Remove blog posts, news articles, review sites, and other non-company URLs
    from the standalone list using URL path patterns, domain blocklist, and
    title keyword signals.
    """
    kept: list[dict] = []
    dropped = 0

    for item in items:
        url = (item.get("url") or "").lower()
        title = (item.get("title") or "").lower()
        domain = _extract_domain(url)

        if any(bd in domain for bd in _BLOG_DOMAINS):
            dropped += 1
            continue

        if any(pat in url for pat in _BLOG_URL_PATH_PATTERNS):
            dropped += 1
            continue

        if any(sig in title for sig in _BLOG_TITLE_SIGNALS):
            dropped += 1
            continue

        kept.append(item)

    logger.info(
        "[filter] %d standalones kept, %d dropped as blogs/articles/noise",
        len(kept),
        dropped,
    )
    return kept


# =============================================================================
# STEP 6 — LLM MATCH SCORING
# =============================================================================

async def _score_batch(
    product_description: str,
    batch: list[dict],
) -> list[dict]:
    """Score a batch of standalone URLs against the product description."""

    items_data = [
        {
            "id": i,
            "url": item["url"],
            "title": (item.get("title") or "")[:150],
            "snippet": (item.get("snippet") or "")[:350],
        }
        for i, item in enumerate(batch)
    ]

    system_prompt = (
        "You are a B2B competitive intelligence engine. "
        "Score how similar or competitive each listed company is to the target product, "
        "using only the title and snippet as evidence. "
        "Score every item — never omit any."
    )

    user_prompt = f"""
TARGET PRODUCT DESCRIPTION:
{product_description}

COMPANIES TO EVALUATE:
{json.dumps(items_data, indent=2)}

Score each company's similarity/competitiveness to the target product.

SCORING GUIDE:
- 85-100: Direct competitor — nearly identical product, same use case and market
- 65-84:  Strong overlap — same market, meaningful feature overlap
- 45-64:  Partial overlap — related space, some shared features
- 20-44:  Weak overlap — tangentially related
- 0-19:   Unrelated or insufficient information to judge

RULES:
- Score EVERY item in the list; do not skip any id
- Base scoring only on title + snippet — do not assume knowledge not in the data
- If title/snippet give insufficient signal, score 0-15 and state that in reason
- reason must be one concise sentence

Return ONLY valid JSON:
{{
  "scores": [
    {{
      "id": 0,
      "url": "...",
      "match_score": 85,
      "reason": "one concise sentence"
    }}
  ]
}}
"""

    parsed = await _llm_json_completion(
        model=_MODEL,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=2500,
        timeout=45,
    )

    if not parsed:
        return []

    return parsed.get("scores", [])


async def score_urls_against_product(
    product_description: str,
    standalone_items: list[dict],
) -> list[dict]:
    """Score all standalone URLs in parallel batches. Returns all, sorted by score."""

    chunk_size = 20
    chunks = [
        standalone_items[i:i + chunk_size]
        for i in range(0, len(standalone_items), chunk_size)
    ]

    batch_results = await asyncio.gather(
        *(_score_batch(product_description, chunk) for chunk in chunks),
        return_exceptions=True,
    )

    score_map: dict[str, dict] = {}

    for chunk_idx, (chunk, result) in enumerate(zip(chunks, batch_results, strict=False)):
        if isinstance(result, Exception):
            logger.warning("Scoring chunk %d failed: %s", chunk_idx, result)
            for item in chunk:
                score_map[item["url"]] = {"match_score": 0, "reason": "Scoring failed"}
            continue

        scores = result if isinstance(result, list) else []
        id_map = {s["id"]: s for s in scores if isinstance(s, dict) and "id" in s}

        for i, item in enumerate(chunk):
            score_data = id_map.get(i, {})
            try:
                match_score = int(score_data.get("match_score", 0))
            except (ValueError, TypeError):
                match_score = 0
            score_map[item["url"]] = {
                "match_score": max(0, min(100, match_score)),
                "reason": str(score_data.get("reason", "")),
            }

    scored: list[dict] = []

    for item in standalone_items:
        url = item["url"]
        s = score_map.get(url, {"match_score": 0, "reason": ""})
        scored.append({
            "url": url,
            "title": item.get("title", ""),
            "snippet": item.get("snippet", ""),
            "match_score": s["match_score"],
            "reason": s["reason"],
        })

    scored.sort(key=lambda x: x["match_score"], reverse=True)

    return scored


# =============================================================================
# MAIN PIPELINE
# =============================================================================

async def run_similarity_pipeline(
    request_id: str,
    product_description: str,
    user_id: str,
) -> list[dict]:
    """
    End-to-end competitor discovery pipeline.

    Steps:
      1. Mark run as Pending in competitor_test
      2. Generate competitor-discovery search queries via LLM
      3. Fetch all search results from Serper (parallel)
      4. Deduplicate and strip noise/social domains
      5. Classify URLs as standalone vs directory; keep standalones only
      6. Filter out blogs, articles, news, and review sites
      7. Score each standalone URL against the product description via LLM
      8. Enrich and store results in competitor_test
      9. Mark run as Completed (or Failed on error)

    Returns enriched competitor list sorted by match_score descending.
    """
    await create_competitor_run(request_id, user_id)

    try:
        if not product_description or not product_description.strip():
            logger.warning("[similarity] Empty product_description — aborting")
            await update_competitor_run_status(request_id, "Failed")
            return []

        # ── Step 1: Query generation ──────────────────────────────────────────
        logger.info("[similarity] Step 1: Generating search queries...")
        queries = await generate_competitor_queries(product_description)

        if not queries:
            logger.error("[similarity] No queries generated — aborting")
            await update_competitor_run_status(request_id, "Failed")
            return []

        logger.info("[similarity] Generated %d queries", len(queries))

        # ── Step 2: Fetch results ─────────────────────────────────────────────
        logger.info("[similarity] Step 2: Fetching Serper results...")
        raw_results = await fetch_all_search_results(queries)

        if not raw_results:
            logger.error("[similarity] No search results — aborting")
            await update_competitor_run_status(request_id, "Failed")
            return []

        logger.info("[similarity] Fetched %d raw results", len(raw_results))

        # ── Step 3: Deduplicate & filter ──────────────────────────────────────
        logger.info("[similarity] Step 3: Deduplicating...")
        unique_results = deduplicate_and_filter(raw_results)
        logger.info("[similarity] %d unique results after dedup", len(unique_results))

        if not unique_results:
            await update_competitor_run_status(request_id, "Failed")
            return []

        # ── Step 4: Classify ──────────────────────────────────────────────────
        logger.info("[similarity] Step 4: Classifying URLs...")
        standalone_items = await classify_and_filter_standalones(unique_results)

        if not standalone_items:
            logger.warning("[similarity] No standalone URLs after classification")
            await update_competitor_run_status(request_id, "Failed")
            return []

        logger.info("[similarity] %d standalone URLs after classification", len(standalone_items))

        # ── Step 5: Filter blogs & articles ───────────────────────────────────
        logger.info("[similarity] Step 5: Filtering blogs, articles, and noise...")
        standalone_items = filter_non_company_standalones(standalone_items)

        if not standalone_items:
            logger.warning("[similarity] No standalone URLs after blog/article filtering")
            await update_competitor_run_status(request_id, "Failed")
            return []

        logger.info("[similarity] %d standalone URLs to score", len(standalone_items))

        # ── Step 6: Score ─────────────────────────────────────────────────────
        logger.info("[similarity] Step 6: Scoring against product description...")
        scored_results = await score_urls_against_product(
            product_description=product_description,
            standalone_items=standalone_items,
        )

        logger.info(
            "[similarity] Done: %d results, top_score=%d",
            len(scored_results),
            scored_results[0]["match_score"] if scored_results else 0,
        )

        # ── Step 7: Enrich & store ────────────────────────────────────────────
        logger.info("[similarity] Step 7: Enriching and storing competitors...")
        enriched = await enrich_and_store_competitors(
            scored_results=scored_results,
            request_id=request_id,
        )

        await update_competitor_run_status(request_id, "Completed")
        logger.info("[similarity] Pipeline completed for request_id=%s", request_id)

        return enriched

    except Exception as exc:
        logger.error("[similarity] Pipeline failed for request_id=%s: %s", request_id, exc, exc_info=True)
        try:
            await update_competitor_run_status(request_id, "Failed")
        except Exception:
            pass
        return []


# =============================================================================
# STEP 6 — REVIEW RATING TOOL
# =============================================================================

_RATING_RE = re.compile(r'(\d+\.\d+)\s*(?:\/5|out of 5)', re.IGNORECASE)


async def fetch_review_ratings(company_name: str) -> dict:
    """
    Reusable tool: one Serper search to pull G2 and Capterra ratings for a company.

    Returns {"g2_rating": "4.5", "capterra_rating": "4.3"} with empty strings
    for any platform where no rating could be parsed.
    """
    if not company_name or not company_name.strip():
        return {"g2_rating": "", "capterra_rating": ""}

    query = f"{company_name} g2 capterra reviews"

    try:
        data = await fetch_leads_from_serper(query)
        organic = data.get("organic", [])
    except Exception as exc:
        logger.warning("Rating search failed for %s: %s", company_name, exc)
        return {"g2_rating": "", "capterra_rating": ""}

    g2_rating = ""
    capterra_rating = ""

    print("Parsing ratings from Serper results for data '%s'", data)

    for item in organic:

        if ( not g2_rating and ( "g2" in item.get("title", "").lower())):
            g2_rating = item.get("rating", "")

        if ( not capterra_rating and ( "capterra" in item.get("title", "").lower())):
            capterra_rating = item.get("rating", "")

        if g2_rating and capterra_rating:
            break

    return {"g2_rating": g2_rating, "capterra_rating": capterra_rating}


# =============================================================================
# STEP 7 — ENRICH + STORE
# =============================================================================

_SCRAPER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}


def _company_name_from_domain(domain: str) -> str:
    """'app.hubspot.com' → 'hubspot', 'salesforce.com' → 'salesforce'."""
    parts = domain.split(".")
    return parts[-2] if len(parts) >= 2 else domain


async def _extract_company_info_via_llm(
    page_text: str,
    structured_data: dict,
    url: str,
) -> dict:
    """
    LLM extracts location and description from actual scraped website content.
    Returns {"location": "...", "description": "..."} with empty strings on failure.
    """
    if not page_text and not structured_data:
        return {"location": "", "description": ""}

    structured_json = json.dumps(structured_data or {}, indent=2)

    system_prompt = (
        "You are a company intelligence extractor. "
        "Extract factual company information from scraped website content. "
        "Return only what is clearly stated in the content — never guess or fabricate. "
        "Return empty string for any field not found."
    )

    user_prompt = f"""
Website: {url}

Structured data (JSON-LD / meta tags extracted from the page):
{structured_json[:1500]}

Full scraped page text:
{page_text[:8000]}

Extract these two fields from the content above:

1. location — The company's headquarters or main office location.
   Examples: "San Francisco, CA", "London, UK", "Berlin, Germany"
   Return empty string if not found.

2. description — A clear 2-3 sentence description of what this company/product does,
   written from the website content in third-person.
   Return empty string if there is not enough content to write one accurately.

Return ONLY valid JSON:
{{
  "location": "...",
  "description": "..."
}}
"""

    parsed = await _llm_json_completion(
        model=_MODEL_MINI,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=350,
        timeout=20,
    )

    return {
        "location": str(parsed.get("location") or ""),
        "description": str(parsed.get("description") or ""),
    }


async def fetch_linkedin_company_info(company_name: str) -> dict:
    """
    Search for a company's LinkedIn page via Serper, then scrape it with httpx
    to extract company size, headquarters, website, industry, type, founded, and specialties.

    Returns a dict with those fields; empty strings for anything not found.
    """
    empty = {
        "linkedin_url": "",
        "company_size": "",
        "headquarters": "",
        "company_website": "",
        "industry": "",
        "company_type": "",
        "founded": "",
        "specialties": "",
    }

    if not company_name or not company_name.strip():
        return empty

    # Step 1 — find the LinkedIn page URL via Serper
    try:
        search_data = await fetch_leads_from_serper(f"{company_name} site:linkedin.com/company")
        organic = search_data.get("organic", [])
    except Exception as exc:
        logger.warning("LinkedIn search failed for %s: %s", company_name, exc)
        return empty

    linkedin_url = ""
    for result in organic:
        link = result.get("link", "")
        if "linkedin.com/company/" in link:
            linkedin_url = link
            break

    if not linkedin_url:
        logger.info("No LinkedIn company page found for %s", company_name)
        return {**empty}

    # Step 2 — scrape the LinkedIn page
    try:
        async with GuardedAsyncClient(
            headers=_SCRAPER_HEADERS,
            follow_redirects=True,
            timeout=15,
        ) as client:
            resp = await client.get(linkedin_url)
            resp.raise_for_status()
            html = resp.text
    except Exception as exc:
        logger.warning("LinkedIn scrape failed for %s (%s): %s", company_name, linkedin_url, exc)
        return {**empty, "linkedin_url": linkedin_url}

    # Step 3 — parse the structured fields from the HTML
    soup = BeautifulSoup(html, "html.parser")

    print("Parsing LinkedIn page for %s: %s", company_name, linkedin_url, soup.prettify())

    def _clean_website(dd_tag) -> str:
        # Prefer the href over get_text() — avoids "External link for X" noise
        anchor = dd_tag.find("a", href=True) if dd_tag else None
        if not anchor:
            return dd_tag.get_text(strip=True) if dd_tag else ""
        href = anchor["href"]
        # LinkedIn wraps external URLs in a redirect: /redir/redirect?url=<encoded>
        if "linkedin.com/redir/redirect" in href:
            params = parse_qs(urlparse(href).query)
            url_values = params.get("url", [])
            if url_values:
                return unquote(url_values[0]).replace("http://", "https://", 1)
        return href.replace("http://", "https://", 1)

    # LinkedIn's public company page uses <dd> elements paired with <dt> labels
    info: dict[str, str] = {}
    for dt in soup.find_all("dt"):
        label = dt.get_text(strip=True).lower()
        dd = dt.find_next_sibling("dd")
        value = dd.get_text(strip=True) if dd else ""
        if "website" in label:
            info["company_website"] = _clean_website(dd)
        elif "industry" in label:
            info["industry"] = value
        elif "company size" in label or "employees" in label:
            info["company_size"] = value
        elif "headquarters" in label:
            info["headquarters"] = value
        elif "type" in label:
            info["company_type"] = value
        elif "founded" in label:
            info["founded"] = value
        elif "specialties" in label:
            info["specialties"] = value

    return {
        "linkedin_url": linkedin_url,
        "company_size": info.get("company_size", ""),
        "headquarters": info.get("headquarters", ""),
        "company_website": info.get("company_website", ""),
        "industry": info.get("industry", ""),
        "company_type": info.get("company_type", ""),
        "founded": info.get("founded", ""),
        "specialties": info.get("specialties", ""),
    }


async def _enrich_single_company(item: dict, scrape_sem: asyncio.Semaphore) -> dict:
    url = item["url"]
    domain = _extract_domain(url)
    company_name = _company_name_from_domain(domain)

    async def _do_scrape():
        async with scrape_sem:
            return await scrape_url_with_discovery(url)

    # Scraping, ratings, and LinkedIn info all run in parallel
    scrape_result, ratings, linkedin_info = await asyncio.gather(
        _do_scrape(),
        fetch_review_ratings(company_name),
        fetch_linkedin_company_info(company_name),
        return_exceptions=True,
    )

    page_text = ""
    structured_data = {}

    if isinstance(scrape_result, Exception):
        logger.warning("Scrape failed for %s: %s", url, scrape_result)
    else:
        page_text, structured_data = scrape_result

    if isinstance(ratings, Exception):
        logger.warning("Rating fetch failed for %s: %s", company_name, ratings)
        ratings = {"g2_rating": "", "capterra_rating": ""}

    if isinstance(linkedin_info, Exception):
        logger.warning("LinkedIn fetch failed for %s: %s", company_name, linkedin_info)
        linkedin_info = {
            "linkedin_url": "", "company_size": "", "headquarters": "",
            "company_website": "", "industry": "", "company_type": "",
            "founded": "", "specialties": "",
        }

    # LLM extraction runs after scraping completes
    extracted = await _extract_company_info_via_llm(
        page_text=page_text,
        structured_data=structured_data,
        url=url,
    )

    return {
        "url": url,
        "title": item.get("title", ""),
        "location": extracted["location"],
        "description": extracted["description"],
        "match_score": item["match_score"],
        "reason": item.get("reason", ""),
        "g2_rating": ratings["g2_rating"],
        "capterra_rating": ratings["capterra_rating"],
        "linkedin_url": linkedin_info["linkedin_url"],
        "company_size": linkedin_info["company_size"],
        "headquarters": linkedin_info["headquarters"],
        "company_website": linkedin_info["company_website"],
        "company_name": company_name,
        "industry": linkedin_info["industry"],
        "company_type": linkedin_info["company_type"],
        "founded": linkedin_info["founded"],
        "specialties": linkedin_info["specialties"],
    }


def _make_fallback_doc(item: dict) -> dict:
    return {
        "url": item.get("url", ""),
        "title": item.get("title", ""),
        "icon": "",
        "location": "",
        "description": "",
        "match_score": item.get("match_score", 0),
        "reason": item.get("reason", ""),
        "g2_rating": "",
        "capterra_rating": "",
    }


async def enrich_and_store_competitors(
    scored_results: list[dict],
    request_id: str,
) -> list[dict]:
    """
    Filter scored results (match_score > 40), enrich each with icon / location /
    description / G2 rating / Capterra rating, then store the entire enriched list
    as a single document in competitor_test (keyed by request_id).
    """
    filtered = [r for r in scored_results if r.get("match_score", 0) > 40]

    if not filtered:
        logger.info("[enrich] No companies above score threshold")
        return []

    logger.info("[enrich] Enriching %d companies (score > 40)", len(filtered))

    scrape_sem = asyncio.Semaphore(20)

    enrich_tasks = await asyncio.gather(
        *(_enrich_single_company(item, scrape_sem) for item in filtered),
        return_exceptions=True,
    )

    enriched: list[dict] = []
    for item, result in zip(filtered, enrich_tasks, strict=False):
        if isinstance(result, Exception):
            logger.warning("Enrichment failed for %s: %s", item.get("url"), result)
            enriched.append(_make_fallback_doc(item))
        else:
            enriched.append(result)

    if enriched:
        # Save to the new normalized schema
        try:
            from app.db.competitor_analyses import get_competitor_analysis, save_competitors_to_analysis
            analysis = await get_competitor_analysis(request_id)
            if analysis:
                await save_competitors_to_analysis(str(analysis["_id"]), enriched)
            else:
                logger.warning("No competitor analysis found for request_id=%s to save competitors", request_id)
        except Exception as exc:
            logger.error("[enrich] Failed to store competitors to competitor_analyses schema: %s", exc)

    return enriched
