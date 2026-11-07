"""
Signal D — News / Web Signals  [up to 30 pts]

Detects news-based buying signals via Serper news search.
Looks for migration announcements, infrastructure changes, vendor complaints.

Signal weights (from PRD Phase 5):
    +20  Press release: "migrating to Snowflake"
    +15  Engineering blog: data infrastructure
    +30  Negative news about current vendor
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.services.serper import fetch_leads_from_serper, get_serper_key

logger = logging.getLogger("app.services.signals.news_signals")


async def _fetch_news_from_serper(query: str) -> list[dict]:
    """
    Run a Serper NEWS search (uses the news endpoint variant).
    Falls back to regular search if news endpoint fails.
    """
    import httpx

    payload = json.dumps({"q": query})
    headers = {
        "X-API-KEY": get_serper_key(),
        "Content-Type": "application/json",
    }

    try:
        # Serper news endpoint
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://google.serper.dev/news",
                headers=headers,
                content=payload,
            )
            response.raise_for_status()
            data = response.json()
            return data.get("news", [])
    except Exception as e:
        logger.warning("Serper news search failed, falling back to regular search: %s", e)
        # Fallback to regular search
        try:
            data = await fetch_leads_from_serper(query)
            return data.get("organic", [])
        except Exception:
            return []


async def _llm_extract_news_signals(
    results: list[dict],
    company_name: str,
    competitors: list[str],
) -> list[dict]:
    """Extract structured news signals from search results via LLM."""
    from app.services.llm import _llm_json_completion, _fence

    if not results:
        return []

    compact = []
    for i, r in enumerate(results[:12]):
        compact.append({
            "id": i,
            "title": (r.get("title") or "")[:150],
            "snippet": (r.get("snippet") or r.get("description") or "")[:300],
            "url": r.get("link") or r.get("url") or "",
            "date": r.get("date") or "",
            "source": r.get("source") or "",
        })

    system_prompt = (
        "You are a B2B intent signal analyst specialized in detecting buying "
        "signals from news and web content.  Identify signals that indicate "
        "a company is likely to be evaluating or purchasing relevant technology.\n"
        "Return ONLY valid JSON."
    )

    user_prompt = f"""Company: {company_name}
Competitor products to watch for: {json.dumps(competitors)}

News/web search results:
{_fence("json", json.dumps(compact, indent=2, ensure_ascii=False))}

Extract news signals for "{company_name}" ONLY.  Classify each into a signal type.

Return JSON:
{{
  "signals": [
    {{
      "signal_type": "migration|infrastructure_change|vendor_complaint|expansion|partnership|product_launch|hiring_news",
      "title": "One-line summary of the signal",
      "mentions_competitor": true/false,
      "competitor_mentioned": "name or null",
      "sentiment": "positive|negative|neutral",
      "url": "source URL",
      "date": "YYYY-MM-DD or null",
      "confidence": "high|medium|low"
    }}
  ]
}}

Rules:
- Only include news ABOUT this specific company.
- migration / infrastructure_change = strongest signals (company is actively changing tools).
- vendor_complaint = negative sentiment about their current vendor/tool.
- Return empty signals array if nothing relevant is found.
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

_NEWS_SIGNAL_WEIGHTS = {
    "migration": 20,
    "infrastructure_change": 20,
    "vendor_complaint": 30,
    "expansion": 12,
    "partnership": 10,
    "product_launch": 8,
    "hiring_news": 10,
}


def _compute_news_weight(signal: dict) -> int:
    """Map news signal type to PRD-defined point weight."""
    signal_type = (signal.get("signal_type") or "").lower()
    base = _NEWS_SIGNAL_WEIGHTS.get(signal_type, 8)

    # Competitor mention boosts any signal
    if signal.get("mentions_competitor"):
        base = max(base, 20)

    return base


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def detect_news_signals(
    company_name: str,
    domain: str,
    competitors: list[str] | None = None,
) -> list[dict]:
    """
    Detect news-based intent signals using 2 Serper queries.

    Uses the Serper News API endpoint (same API key, counts as 1 query each).

    Args:
        company_name: The company to search for
        domain:       The company's domain
        competitors:  Competitor names to watch for in news

    Returns:
        List of signal dicts with type="news_signal"
    """
    if not company_name:
        return []

    competitors = competitors or []
    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Build queries (2 news queries) ────────────────────────────────────────
    queries = [
        # Query 1: Technology / infrastructure news
        f'"{company_name}" (infrastructure OR migration OR "data platform" OR technology)',
        # Query 2: Competitor-related news
        f'"{company_name}" ({" OR ".join(f"{c}" for c in competitors[:3])})' if competitors
        else f'"{company_name}" (vendor OR platform OR switching OR evaluating)',
    ]

    # ── Run queries concurrently ──────────────────────────────────────────────
    results_batches = await asyncio.gather(
        *(_fetch_news_from_serper(q) for q in queries)
    )
    all_results = [item for batch in results_batches for item in batch]

    if not all_results:
        logger.info("No news signal results for '%s'", company_name)
        return []

    # Deduplicate
    seen_urls = set()
    unique = []
    for r in all_results:
        url = r.get("link") or r.get("url") or ""
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique.append(r)

    # ── LLM extraction ────────────────────────────────────────────────────────
    raw_signals = await _llm_extract_news_signals(unique, company_name, competitors)

    # ── Build signal dicts ────────────────────────────────────────────────────
    signals = []
    for raw in raw_signals:
        weight = _compute_news_weight(raw)
        competitor_note = ""
        if raw.get("mentions_competitor") and raw.get("competitor_mentioned"):
            competitor_note = f" (mentions {raw['competitor_mentioned']})"

        signals.append({
            "type": "news_signal",
            "source": _extract_domain(raw.get("url", "")),
            "title": raw.get("title", "News signal detected"),
            "weight": weight,
            "confidence": raw.get("confidence", "medium"),
            "timestamp": raw.get("date") or now_iso,
            "url": raw.get("url", ""),
            "summary": f"{raw.get('signal_type', 'news')}: {raw.get('title', '')}"
                       f"{competitor_note}",
            "category": "intent",
            "signal_subtype": raw.get("signal_type"),
            "sentiment": raw.get("sentiment"),
            "mentions_competitor": raw.get("mentions_competitor", False),
        })

    logger.info(
        "Detected %d news signals for '%s'",
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
