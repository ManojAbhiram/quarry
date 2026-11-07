"""
Signal A — Job / Hiring Signals  [HIGHEST WEIGHT: up to 28 pts]

Detects hiring intent by dorking job boards (Greenhouse, Lever, LinkedIn Jobs)
via Serper.  Entirely free — uses only the Serper API already in the stack.

Signal weights (from PRD Phase 5):
    +25  Hiring Data Scientist / Data Engineer
    +20  Hiring Head of Data / VP Analytics
    +28  Job post mentions competitor tool
    +10  Rapid headcount growth (multiple open roles)
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.services.serper import fetch_leads_from_serper

logger = logging.getLogger("app.services.signals.job_signals")


# ---------------------------------------------------------------------------
# LLM helper (reuse the shared helper from llm.py)
# ---------------------------------------------------------------------------

async def _llm_extract_job_signals(
    serper_results: list[dict],
    company_name: str,
    icp_roles: list[str],
    competitors: list[str],
) -> list[dict]:
    """
    Send raw Serper job-board results to the LLM and extract structured
    hiring signals with weights and confidence scores.
    """
    from app.services.llm import _llm_json_completion, _fence

    if not serper_results:
        return []

    # Compact the results to save tokens
    compact = []
    for i, r in enumerate(serper_results[:15]):  # cap at 15 results
        compact.append({
            "id": i,
            "title": (r.get("title") or "")[:120],
            "snippet": (r.get("snippet") or "")[:250],
            "url": r.get("link") or r.get("url") or "",
        })

    system_prompt = (
        "You are a B2B intent signal analyst.  Your job is to examine job "
        "posting search results and identify hiring signals that indicate a "
        "company is likely to be in a buying mindset for a relevant product.\n"
        "Return ONLY valid JSON."
    )

    user_prompt = f"""Company: {company_name}
ICP-relevant roles to watch for: {json.dumps(icp_roles)}
Competitor tools to watch for: {json.dumps(competitors)}

Search results from job boards:
{_fence("json", json.dumps(compact, indent=2, ensure_ascii=False))}

For EACH result that represents a genuine job posting by "{company_name}" (or a very close name match), extract a signal.
Ignore results for different companies or generic articles.

CRITICAL: You must completely REJECT any job posting where the hiring company is NOT exactly "{company_name}". If the snippet says "We use {company_name}" or "{company_name} experience required" but the hiring company is someone else, DO NOT extract it.

Return JSON:
{{
  "signals": [
    {{
      "title": "Hiring [Role Title]",
      "role": "the exact role being hired",
      "seniority": "junior|mid|senior|lead|vp|c-level",
      "mentions_competitor": true/false,
      "competitor_mentioned": "name or null",
      "url": "source URL",
      "confidence": "high|medium|low"
    }}
  ]
}}

Rules:
- Only include results that are ACTUALLY job postings by this specific company.
- Set confidence=high if the posting is clearly from this company on a job board.
- Set confidence=medium if it's from a search snippet and attribution is likely but not certain.
- Set confidence=low if the company name match is ambiguous.
- Return empty signals array if no relevant job postings are found.
"""

    parsed = await _llm_json_completion(
        model=settings.LITELLM_MODEL_MINI,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=800,
        timeout=20,
    )

    return parsed.get("signals", [])


# ---------------------------------------------------------------------------
# Weight calculation
# ---------------------------------------------------------------------------

_ROLE_WEIGHTS = {
    # C-level / VP hiring = strong buying signal
    "c-level": 20,
    "vp": 20,
    "lead": 18,
    "senior": 15,
    "mid": 10,
    "junior": 8,
}


def _compute_weight(raw_signal: dict, icp_roles: list[str]) -> int:
    """Map an extracted job signal to its PRD-defined point weight."""
    # Competitor mention is the strongest signal
    if raw_signal.get("mentions_competitor"):
        return 28

    seniority = (raw_signal.get("seniority") or "mid").lower()
    base = _ROLE_WEIGHTS.get(seniority, 10)

    # Boost if the role title matches an ICP-relevant role
    role_title = (raw_signal.get("role") or "").lower()
    for icp_role in icp_roles:
        if icp_role.lower() in role_title or role_title in icp_role.lower():
            base = max(base, 25)  # ICP-relevant role = +25
            break

    return base


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def detect_job_signals(
    company_name: str,
    domain: str,
    icp_roles: list[str] | None = None,
    competitors: list[str] | None = None,
) -> list[dict]:
    """
    Detect hiring/job signals for a company using Serper Google dorking.

    Uses 2-3 Serper queries per company (budget-conscious for free tier).

    Args:
        company_name: The company to search for
        domain:       The company's domain (e.g. "acme.com")
        icp_roles:    ICP-relevant job titles to watch for
        competitors:  Competitor tool/product names to detect in job posts

    Returns:
        List of signal dicts with type="job_hiring"
    """
    if not company_name:
        return []

    icp_roles = icp_roles or ["Data Engineer", "Data Scientist", "Analytics"]
    competitors = competitors or []
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Build Serper queries (2 queries to stay budget-conscious) ─────────────
    queries = []

    # Query 1: Job board dorking (Greenhouse + Lever) tightly bound to company name in title
    queries.append(
        f'(site:greenhouse.io OR site:lever.co OR site:jobs.lever.co) intitle:"{company_name}"'
    )

    # Query 2: General hiring search with ICP roles tightly bound to company name in title
    top_roles = icp_roles[:3]  # Limit to 3 roles for query length
    roles_part = " OR ".join(f'"{r}"' for r in top_roles)
    queries.append(
        f'intitle:"{company_name}" (hiring OR jobs OR careers) ({roles_part})'
    )

    # ── Run queries concurrently ──────────────────────────────────────────────
    async def _run_query(q: str) -> list[dict]:
        try:
            data = await fetch_leads_from_serper(q)
            return data.get("organic", [])
        except Exception as e:
            logger.warning("Job signal Serper query failed for '%s': %s", company_name, e)
            return []

    results_batches = await asyncio.gather(*(_run_query(q) for q in queries))
    all_results = [item for batch in results_batches for item in batch]

    if not all_results:
        logger.info("No job signal results for '%s'", company_name)
        return []

    # Deduplicate by URL
    seen_urls = set()
    unique_results = []
    for r in all_results:
        url = r.get("link") or r.get("url") or ""
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique_results.append(r)

    logger.info(
        "Found %d unique job search results for '%s'",
        len(unique_results), company_name,
    )

    # ── LLM extraction ────────────────────────────────────────────────────────
    raw_signals = await _llm_extract_job_signals(
        unique_results, company_name, icp_roles, competitors,
    )

    # ── Build structured signal dicts ─────────────────────────────────────────
    signals = []
    for raw in raw_signals:
        weight = _compute_weight(raw, icp_roles)
        competitor_note = ""
        if raw.get("mentions_competitor") and raw.get("competitor_mentioned"):
            competitor_note = f" (mentions {raw['competitor_mentioned']})"

        signals.append({
            "type": "job_hiring",
            "source": _extract_domain(raw.get("url", "")),
            "title": raw.get("title", "Hiring signal detected"),
            "weight": weight,
            "confidence": raw.get("confidence", "medium"),
            "timestamp": now_iso,
            "url": raw.get("url", ""),
            "summary": f"{company_name} is hiring {raw.get('role', 'unknown role')} "
                       f"({raw.get('seniority', 'unknown')} level){competitor_note}",
            "category": "intent",
            "raw_role": raw.get("role"),
            "raw_seniority": raw.get("seniority"),
            "mentions_competitor": raw.get("mentions_competitor", False),
            "competitor_mentioned": raw.get("competitor_mentioned"),
        })

    # ── Headcount growth bonus ────────────────────────────────────────────────
    # If 3+ open roles detected, add a growth signal
    if len(signals) >= 3:
        signals.append({
            "type": "job_growth",
            "source": "aggregated",
            "title": f"Rapid hiring: {len(signals)} open positions detected",
            "weight": 10,
            "confidence": "medium",
            "timestamp": now_iso,
            "url": "",
            "summary": f"{company_name} has {len(signals)} active job postings, "
                       f"indicating rapid headcount growth",
            "category": "intent",
        })

    logger.info(
        "Detected %d job signals for '%s' (total weight: %d)",
        len(signals), company_name, sum(s["weight"] for s in signals),
    )
    return signals


def _extract_domain(url: str) -> str:
    """Extract domain from URL for source attribution."""
    if not url:
        return "unknown"
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host = parsed.netloc or parsed.path.split("/")[0]
        return host.lower().replace("www.", "")
    except Exception:
        return "unknown"
