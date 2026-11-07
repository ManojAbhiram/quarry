"""
Signal C — Funding Signals  [up to 20 pts]

Detects funding events via Serper news search (NO Crunchbase paid API).
Scrapes public TechCrunch, PR Newswire, and Crunchbase public profiles.

Signal weights (from PRD Phase 5):
    +15-20  Series A/B raised < 6 months ago
    +20     IPO filing
    +8      Revenue milestone PR
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.services.serper import fetch_leads_from_serper

logger = logging.getLogger("app.services.signals.funding_signals")


async def _llm_extract_funding_signals(
    serper_results: list[dict],
    company_name: str,
) -> list[dict]:
    """Extract structured funding signals from Serper search results via LLM."""
    from app.services.llm import _llm_json_completion, _fence

    if not serper_results:
        return []

    compact = []
    for i, r in enumerate(serper_results[:12]):
        compact.append({
            "id": i,
            "title": (r.get("title") or "")[:120],
            "snippet": (r.get("snippet") or "")[:300],
            "url": r.get("link") or r.get("url") or "",
            "date": r.get("date") or "",
        })

    system_prompt = (
        "You are a B2B funding signal analyst.  Examine search results about a "
        "company and identify funding events, IPO filings, and revenue milestones.\n"
        "Return ONLY valid JSON."
    )

    user_prompt = f"""Company: {company_name}

Search results:
{_fence("json", json.dumps(compact, indent=2, ensure_ascii=False))}

Extract funding signals for "{company_name}" ONLY.  Ignore results about other companies.

Return JSON:
{{
  "signals": [
    {{
      "event_type": "funding_round|ipo_filing|revenue_milestone|acquisition",
      "title": "Series B Funding Raised",
      "amount": "$50M or null",
      "funding_stage": "Seed|Series A|Series B|Series C|IPO|null",
      "date": "YYYY-MM-DD or approximate or null",
      "investors": ["investor1", "investor2"] or [],
      "url": "source URL",
      "confidence": "high|medium|low"
    }}
  ]
}}

Rules:
- Only include events clearly about THIS company (not similarly named ones).
- Set confidence=high if from a reputable source (TechCrunch, Crunchbase, PR Newswire).
- Prefer the most recent event if multiple rounds are mentioned.
- Return empty signals array if no funding events found.
"""

    parsed = await _llm_json_completion(
        model=settings.LITELLM_MODEL_MINI,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=600,
        timeout=20,
    )

    return parsed.get("signals", [])


# ---------------------------------------------------------------------------
# Weight calculation
# ---------------------------------------------------------------------------

_EVENT_WEIGHTS = {
    "funding_round": 18,      # Series A/B/C
    "ipo_filing": 20,
    "revenue_milestone": 8,
    "acquisition": 15,
}


def _compute_funding_weight(signal: dict) -> int:
    """Map funding event type to PRD-defined point weight."""
    event_type = (signal.get("event_type") or "").lower()
    base = _EVENT_WEIGHTS.get(event_type, 10)

    # Boost for recent large rounds
    stage = (signal.get("funding_stage") or "").lower()
    if "series b" in stage or "series c" in stage:
        base = max(base, 20)
    elif "seed" in stage:
        base = min(base, 15)

    return base


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def detect_funding_signals(
    company_name: str,
    domain: str,
) -> list[dict]:
    """
    Detect funding signals using 2 Serper queries (zero cost beyond existing Serper key).

    Args:
        company_name: The company to search for
        domain:       The company's domain

    Returns:
        List of signal dicts with type="funding_event"
    """
    if not company_name:
        return []

    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Build Serper queries (2 queries) ──────────────────────────────────────
    queries = [
        # Query 1: Funding news from reputable sources
        f'"{company_name}" (raised OR funding OR "series" OR investment) '
        f'site:techcrunch.com OR site:crunchbase.com OR site:prnewswire.com',
        # Query 2: General funding search
        f'"{company_name}" funding raised 2025 OR 2026',
    ]

    # ── Run queries concurrently ──────────────────────────────────────────────
    async def _run_query(q: str) -> list[dict]:
        try:
            data = await fetch_leads_from_serper(q)
            return data.get("organic", [])
        except Exception as e:
            logger.warning("Funding signal Serper query failed for '%s': %s", company_name, e)
            return []

    results_batches = await asyncio.gather(*(_run_query(q) for q in queries))
    all_results = [item for batch in results_batches for item in batch]

    if not all_results:
        logger.info("No funding signal results for '%s'", company_name)
        return []

    # Deduplicate by URL
    seen_urls = set()
    unique = []
    for r in all_results:
        url = r.get("link") or r.get("url") or ""
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique.append(r)

    # ── LLM extraction ────────────────────────────────────────────────────────
    raw_signals = await _llm_extract_funding_signals(unique, company_name)

    # ── Build structured signal dicts ─────────────────────────────────────────
    signals = []
    for raw in raw_signals:
        weight = _compute_funding_weight(raw)
        amount_str = f" ({raw['amount']})" if raw.get("amount") else ""
        investors_str = ""
        if raw.get("investors"):
            investors_str = f" from {', '.join(raw['investors'][:3])}"

        signals.append({
            "type": "funding_event",
            "source": _extract_domain(raw.get("url", "")),
            "title": raw.get("title", "Funding event detected"),
            "weight": weight,
            "confidence": raw.get("confidence", "medium"),
            "timestamp": raw.get("date") or now_iso,
            "url": raw.get("url", ""),
            "summary": f"{company_name} {raw.get('event_type', 'funding event')}"
                       f"{amount_str}{investors_str}",
            "category": "intent",
            "funding_stage": raw.get("funding_stage"),
            "amount": raw.get("amount"),
        })

    logger.info(
        "Detected %d funding signals for '%s'",
        len(signals), company_name,
    )
    return signals


def _extract_domain(url: str) -> str:
    if not url:
        return "unknown"
    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        host = parsed.netloc or parsed.path.split("/")[0]
        return host.lower().replace("www.", "")
    except Exception:
        return "unknown"
