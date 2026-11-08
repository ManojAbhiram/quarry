"""
Company Enrichment — LinkedIn firmographics + lightweight market signals.

Plugs into both lead pipelines (ICP and direct-companies) to populate:
    - employee_size_estimate   (from direct LinkedIn scraping)
    - industry                 (from direct LinkedIn scraping)
    - headquarters             (from direct LinkedIn scraping)
    - founded_year             (from direct LinkedIn scraping)
    - funding_stage            (from funding signals)
    - signals                  (compact label list from funding + job signals)
    - growth                   (inferred from hiring signals)

Cost per lead:
    - LinkedIn firmographics:  ~1 Serper query + 1 HTTP scrape (more accurate than snippets)
    - Market signals:          ~4 Serper queries (2 funding + 2 job)

Both functions are guarded by config toggles and lead caps.
"""

import asyncio
import logging
from urllib.parse import urlparse, parse_qs, unquote

import httpx
from bs4 import BeautifulSoup

from app.core.config import settings
from app.core.url_guard import httpx_request_guard
from app.services.serper import fetch_leads_from_serper
from app.services.llm import _llm_json_completion

logger = logging.getLogger("app.services.company_enrichment")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_SCRAPER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}


def _linkedin_slug(linkedin_url: str) -> str:
    """Extract the company slug from a LinkedIn company URL."""
    if not linkedin_url:
        return ""
    try:
        path = urlparse(linkedin_url).path.rstrip("/")
        # e.g. /company/acme-corp → acme-corp
        parts = [p for p in path.split("/") if p]
        if len(parts) >= 2 and parts[0] == "company":
            return parts[1]
    except Exception:
        pass
    return ""


def _is_empty(value) -> bool:
    """Check if a value is missing / blank."""
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, list) and len(value) == 0:
        return True
    return False


# ---------------------------------------------------------------------------
# Part 1 — LinkedIn firmographics via direct scraping (more accurate)
# ---------------------------------------------------------------------------

async def _scrape_linkedin_company_page(company_name: str, linkedin_url: str = "") -> dict:
    """
    Directly scrape a LinkedIn company page to extract firmographic data.
    This is more accurate than relying on Google snippets.

    Returns dict with: employee_size_estimate, industry, headquarters, founded_year
    """
    empty = {
        "employee_size_estimate": "",
        "industry": "",
        "headquarters": "",
        "founded_year": "",
    }

    if not company_name and not linkedin_url:
        return empty

    # Step 1: Find LinkedIn URL if not provided
    if not linkedin_url:
        try:
            search_data = await fetch_leads_from_serper(f"{company_name} site:linkedin.com/company")
            organic = search_data.get("organic", [])
            for result in organic:
                link = result.get("link", "")
                if "linkedin.com/company/" in link:
                    linkedin_url = link
                    break
        except Exception as exc:
            logger.warning("LinkedIn search failed for %s: %s", company_name, exc)
            return empty

    if not linkedin_url:
        logger.debug("No LinkedIn URL found for %s", company_name)
        return empty

    # Step 2: Scrape the LinkedIn page directly
    try:
        async with httpx.AsyncClient(
            headers=_SCRAPER_HEADERS,
            follow_redirects=True,
            timeout=15,
            event_hooks={"request": [httpx_request_guard]},
        ) as client:
            resp = await client.get(linkedin_url)
            resp.raise_for_status()
            html = resp.text
    except Exception as exc:
        logger.warning("LinkedIn scrape failed for %s (%s): %s", company_name, linkedin_url, exc)
        return empty

    # Step 3: Parse structured fields from HTML
    soup = BeautifulSoup(html, "html.parser")

    def _clean_website(dd_tag) -> str:
        """Extract clean website URL from LinkedIn's wrapped redirect."""
        anchor = dd_tag.find("a", href=True) if dd_tag else None
        if not anchor:
            return dd_tag.get_text(strip=True) if dd_tag else ""
        href = anchor["href"]
        # LinkedIn wraps external URLs: /redir/redirect?url=<encoded>
        if "linkedin.com/redir/redirect" in href:
            params = parse_qs(urlparse(href).query)
            url_values = params.get("url", [])
            if url_values:
                return unquote(url_values[0]).replace("http://", "https://", 1)
        return href.replace("http://", "https://", 1)

    # LinkedIn uses <dt> labels paired with <dd> values
    info: dict[str, str] = {}
    for dt in soup.find_all("dt"):
        label = dt.get_text(strip=True).lower()
        dd = dt.find_next_sibling("dd")
        value = dd.get_text(strip=True) if dd else ""

        if "company size" in label or "employees" in label:
            info["employee_size_estimate"] = value
        elif "industry" in label:
            info["industry"] = value
        elif "headquarters" in label:
            info["headquarters"] = value
        elif "founded" in label:
            info["founded_year"] = value

    result = {
        "employee_size_estimate": info.get("employee_size_estimate", ""),
        "industry": info.get("industry", ""),
        "headquarters": info.get("headquarters", ""),
        "founded_year": info.get("founded_year", ""),
    }

    logger.debug(
        "Scraped LinkedIn for %s: employees=%s, industry=%s, HQ=%s, founded=%s",
        company_name,
        result["employee_size_estimate"],
        result["industry"],
        result["headquarters"],
        result["founded_year"],
    )

    return result


async def _fetch_linkedin_snippet(company_name: str, linkedin_url: str) -> dict:
    """
    Search Google for the company's LinkedIn page and extract firmographic
    data from the snippet (Google's knowledge-panel text for LinkedIn pages
    typically includes employee count, industry, and location).

    Returns a dict with keys: employee_size_estimate, industry, headquarters,
    founded_year — any of which may be empty.
    """
    slug = _linkedin_slug(linkedin_url)
    if not slug and not company_name:
        return {}

    # Build a targeted query that returns the LinkedIn page with its snippet
    if slug:
        query = f'site:linkedin.com/company/{slug} "{company_name or slug}"'
    else:
        query = f'site:linkedin.com/company/ "{company_name}"'

    try:
        data = await fetch_leads_from_serper(query)
    except Exception as exc:
        logger.warning("Serper query failed for LinkedIn snippet (%s): %s", company_name, exc)
        return {}

    organic = data.get("organic", [])
    if not organic:
        return {}

    # Collect snippets from top results (usually 1-2)
    snippets = []
    for item in organic[:3]:
        link = item.get("link") or item.get("url") or ""
        if "linkedin.com/company" not in link.lower():
            continue
        title = item.get("title") or ""
        snippet = item.get("snippet") or ""
        snippets.append(f"Title: {title}\nSnippet: {snippet}")

    if not snippets:
        return {}

    combined = "\n---\n".join(snippets)

    # Use LLM to extract structured firmographics from the snippets
    system_prompt = (
        "You are a data extraction assistant. Extract company firmographic data "
        "from LinkedIn search snippets. Return ONLY valid JSON."
    )

    user_prompt = f"""Company: {company_name}
LinkedIn URL: {linkedin_url}

Google search snippets for this company's LinkedIn page:
{combined}

Extract the following fields from the snippets. Use null for any field that cannot be determined:

{{
  "employee_size_estimate": "e.g. '51-200', '1,001-5,000', '11-50' — use LinkedIn's standard ranges if visible, otherwise a numeric estimate",
  "industry": "e.g. 'Computer Software', 'Financial Services', 'Information Technology'",
  "headquarters": "e.g. 'San Francisco, California', 'New York, NY', 'Bangalore, India'",
  "founded_year": "e.g. '2019' — just the 4-digit year or null"
}}

Rules:
- Only extract data that is clearly stated or strongly implied in the snippets.
- Do NOT guess or fabricate data.
- For employee_size_estimate, prefer LinkedIn range format (e.g. "51-200") if available.
- Return null for any field you're not confident about.
"""

    parsed = await _llm_json_completion(
        model=settings.LITELLM_MODEL_MINI,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=200,
        timeout=15,
    )

    # Clean up nulls
    result = {}
    for key in ("employee_size_estimate", "industry", "headquarters", "founded_year"):
        val = parsed.get(key)
        if val and str(val).lower() not in ("null", "none", "n/a", "unknown", ""):
            result[key] = str(val).strip()

    return result


async def enrich_leads_with_linkedin_firmographics(leads: list[dict]) -> list[dict]:
    """
    Enrich leads with firmographic data by directly scraping their LinkedIn company pages.
    This provides more accurate employee counts and other data compared to snippet-based extraction.

    Mutates lead dicts in-place (only fills empty fields). Returns the same list.
    """
    if not settings.ENABLE_LINKEDIN_ENRICHMENT:
        logger.info("LinkedIn enrichment disabled via ENABLE_LINKEDIN_ENRICHMENT")
        return leads

    if not leads:
        return leads

    # Cap the number of leads to enrich
    to_enrich = []
    for idx, lead in enumerate(leads):
        if len(to_enrich) >= settings.LINKEDIN_ENRICH_MAX_LEADS:
            break
        company_name = lead.get("company_name") or lead.get("title") or ""
        linkedin_url = lead.get("linkedin_url") or ""
        # Need at least a company name or LinkedIn URL
        if company_name or linkedin_url:
            to_enrich.append((idx, company_name, linkedin_url))

    if not to_enrich:
        logger.info("No leads eligible for LinkedIn firmographic enrichment")
        return leads

    logger.info("Enriching %d leads with LinkedIn firmographics (direct scraping)...", len(to_enrich))

    sem = asyncio.Semaphore(settings.ENRICH_CONCURRENCY)

    async def _enrich_one(idx: int, company_name: str, linkedin_url: str) -> tuple[int, dict]:
        async with sem:
            try:
                # Use direct scraping instead of snippet-based extraction
                return idx, await _scrape_linkedin_company_page(company_name, linkedin_url)
            except Exception as exc:
                logger.warning("LinkedIn enrichment failed for '%s': %s", company_name, exc)
                return idx, {}

    results = await asyncio.gather(
        *(_enrich_one(idx, cn, lu) for idx, cn, lu in to_enrich),
        return_exceptions=True,
    )

    enriched_count = 0
    for result in results:
        if isinstance(result, Exception):
            logger.warning("LinkedIn enrichment task raised: %s", result)
            continue
        idx, firmographics = result
        if not firmographics:
            continue

        lead = leads[idx]
        any_set = False
        for key in ("employee_size_estimate", "industry", "headquarters", "founded_year"):
            if key in firmographics and firmographics[key] and _is_empty(lead.get(key)):
                lead[key] = firmographics[key]
                any_set = True

        if any_set:
            enriched_count += 1
            logger.debug(
                "LinkedIn firmographics set for '%s': employees=%s, industry=%s, HQ=%s, founded=%s",
                lead.get("company_name", "?"),
                firmographics.get("employee_size_estimate"),
                firmographics.get("industry"),
                firmographics.get("headquarters"),
                firmographics.get("founded_year"),
            )

    logger.info("LinkedIn firmographic enrichment complete — %d/%d leads enriched", enriched_count, len(to_enrich))
    return leads


# ---------------------------------------------------------------------------
# Part 2 — Market signals (funding + job) → funding_stage, signals, growth
# ---------------------------------------------------------------------------

async def _collect_market_signals_for_lead(
    company_name: str,
    domain: str,
) -> dict:
    """
    Run funding + job signal detection for a single lead.

    Returns:
        {
            "funding_stage": str or None,
            "signals": list[str],       # compact label list
            "growth": str or None,
            "raw_funding_signals": list[dict],
            "raw_job_signals": list[dict],
        }
    """
    from app.services.signals.funding_signals import detect_funding_signals
    from app.services.signals.job_signals import detect_job_signals

    # Run both in parallel (2 + 2 = 4 Serper queries)
    funding_task = detect_funding_signals(company_name, domain)
    job_task = detect_job_signals(company_name, domain)

    results = await asyncio.gather(funding_task, job_task, return_exceptions=True)

    funding_signals = results[0] if isinstance(results[0], list) else []
    job_signals = results[1] if isinstance(results[1], list) else []

    if isinstance(results[0], Exception):
        logger.warning("Funding signals failed for '%s': %s", company_name, results[0])
    if isinstance(results[1], Exception):
        logger.warning("Job signals failed for '%s': %s", company_name, results[1])

    # --- Derive funding_stage ---
    funding_stage = None
    if funding_signals:
        # Pick the highest-confidence, most recent funding stage
        for sig in sorted(
            funding_signals,
            key=lambda s: (
                {"high": 3, "medium": 2, "low": 1}.get(s.get("confidence", ""), 0),
                s.get("timestamp", ""),
            ),
            reverse=True,
        ):
            stage = sig.get("funding_stage")
            if stage and str(stage).lower() not in ("null", "none", "n/a", "unknown"):
                funding_stage = str(stage).strip()
                break

    # --- Derive signal labels ---
    signal_labels = []
    for sig in funding_signals:
        title = sig.get("title", "")
        if title:
            # Compact: "Series B Funding Raised" → "Series B Raised"
            label = title[:60]
            if label not in signal_labels:
                signal_labels.append(label)

    for sig in job_signals:
        title = sig.get("title", "")
        if title:
            label = title[:60]
            if label not in signal_labels:
                signal_labels.append(label)

    # Cap at 5 most important signals
    signal_labels = signal_labels[:5]

    # --- Derive growth indicator ---
    growth = None
    if job_signals:
        # Count hiring-related signals
        hiring_count = sum(
            1 for s in job_signals
            if any(kw in (s.get("title") or "").lower() for kw in ("hiring", "job", "role", "position", "recruit"))
        )
        expansion_count = sum(
            1 for s in job_signals
            if any(kw in (s.get("title") or "").lower() for kw in ("expansion", "new office", "new market", "international"))
        )

        if hiring_count >= 3:
            growth = "Actively Hiring"
        elif hiring_count >= 1:
            growth = "Hiring"
        elif expansion_count >= 1:
            growth = "Expanding"

    return {
        "funding_stage": funding_stage,
        "signals": signal_labels,
        "growth": growth,
        "raw_funding_signals": funding_signals,
        "raw_job_signals": job_signals,
    }


async def enrich_leads_with_market_signals(leads: list[dict]) -> list[dict]:
    """
    Enrich leads with funding stage, signal labels, and growth indicators
    using the existing funding + job signal detectors.

    Mutates lead dicts in-place (only fills empty fields). Returns the same list.
    """
    if not settings.ENABLE_SIGNAL_ENRICHMENT:
        logger.info("Signal enrichment disabled via ENABLE_SIGNAL_ENRICHMENT")
        return leads

    if not leads:
        return leads

    # Cap the number of leads to signal-enrich
    to_enrich = []
    for idx, lead in enumerate(leads):
        if len(to_enrich) >= settings.SIGNAL_ENRICH_MAX_LEADS:
            break
        company_name = lead.get("company_name") or lead.get("title") or ""
        domain = lead.get("website") or lead.get("source_url") or ""
        if company_name:
            to_enrich.append((idx, company_name, domain))

    if not to_enrich:
        logger.info("No leads eligible for market signal enrichment")
        return leads

    logger.info("Enriching %d leads with market signals (funding + job)...", len(to_enrich))

    sem = asyncio.Semaphore(settings.ENRICH_CONCURRENCY)

    async def _enrich_one(idx: int, company_name: str, domain: str) -> tuple[int, dict]:
        async with sem:
            try:
                return idx, await _collect_market_signals_for_lead(company_name, domain)
            except Exception as exc:
                logger.warning("Market signal enrichment failed for '%s': %s", company_name, exc)
                return idx, {}

    results = await asyncio.gather(
        *(_enrich_one(idx, cn, dom) for idx, cn, dom in to_enrich),
        return_exceptions=True,
    )

    enriched_count = 0
    for result in results:
        if isinstance(result, Exception):
            logger.warning("Market signal enrichment task raised: %s", result)
            continue
        idx, market_data = result
        if not market_data:
            continue

        lead = leads[idx]
        any_set = False

        # funding_stage — only set if lead doesn't already have one
        if market_data.get("funding_stage") and _is_empty(lead.get("funding_stage")):
            lead["funding_stage"] = market_data["funding_stage"]
            any_set = True

        # signals — merge with any existing signals
        if market_data.get("signals"):
            existing = lead.get("signals") or []
            if isinstance(existing, str):
                existing = [s.strip() for s in existing.split(",") if s.strip()]
            merged = list(existing) + [s for s in market_data["signals"] if s not in existing]
            lead["signals"] = merged[:8]  # cap total
            any_set = True

        # growth — only set if empty
        if market_data.get("growth") and _is_empty(lead.get("growth")):
            lead["growth"] = market_data["growth"]
            any_set = True

        if any_set:
            enriched_count += 1
            logger.debug(
                "Market signals set for '%s': funding=%s, signals=%s, growth=%s",
                lead.get("company_name", "?"),
                market_data.get("funding_stage"),
                market_data.get("signals"),
                market_data.get("growth"),
            )

    logger.info("Market signal enrichment complete — %d/%d leads enriched", enriched_count, len(to_enrich))
    return leads
