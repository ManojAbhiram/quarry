"""
Signal E — Social / Content Signals  [up to 20 pts]

Detects engagement signals from GitHub activity, conference participation,
and LinkedIn thought leadership via Serper dorking.

Signal weights (from PRD Phase 6):
    +5/star   GitHub stars from employees (cap +20)
    +10       Conference participation
    +8        LinkedIn thought leadership posts
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.services.serper import fetch_leads_from_serper

logger = logging.getLogger("app.services.signals.social_signals")


async def _llm_extract_social_signals(
    results: list[dict],
    company_name: str,
) -> list[dict]:
    """Extract structured social/engagement signals from search results via LLM."""
    from app.services.llm import _llm_json_completion, _fence

    if not results:
        return []

    compact = []
    for i, r in enumerate(results[:10]):
        compact.append({
            "id": i,
            "title": (r.get("title") or "")[:120],
            "snippet": (r.get("snippet") or "")[:250],
            "url": r.get("link") or r.get("url") or "",
        })

    system_prompt = (
        "You are a B2B engagement signal analyst.  Examine search results and "
        "identify social/community engagement signals for a company.\n"
        "Return ONLY valid JSON."
    )

    user_prompt = f"""Company: {company_name}

Search results:
{_fence("json", json.dumps(compact, indent=2, ensure_ascii=False))}

Extract engagement signals for "{company_name}" ONLY.

Return JSON:
{{
  "signals": [
    {{
      "signal_type": "github_activity|conference|linkedin_post|blog_post|community_engagement|open_source",
      "title": "Brief description",
      "url": "source URL",
      "confidence": "high|medium|low"
    }}
  ]
}}

Rules:
- Only include signals clearly attributable to this company or its employees.
- GitHub repos, open source contributions, and community posts are relevant.
- Conference talks and speaking engagements are strong signals.
- Return empty signals array if nothing relevant is found.
"""

    parsed = await _llm_json_completion(
        model=settings.LITELLM_MODEL_MINI,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=500,
        timeout=20,
    )

    return parsed.get("signals", [])


# ---------------------------------------------------------------------------
# Weight calculation
# ---------------------------------------------------------------------------

_SOCIAL_WEIGHTS = {
    "github_activity": 10,
    "conference": 10,
    "linkedin_post": 8,
    "blog_post": 6,
    "community_engagement": 8,
    "open_source": 12,
}


def _compute_social_weight(signal: dict) -> int:
    """Map social signal type to point weight."""
    signal_type = (signal.get("signal_type") or "").lower()
    return _SOCIAL_WEIGHTS.get(signal_type, 5)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def detect_social_signals(
    company_name: str,
    domain: str,
) -> list[dict]:
    """
    Detect social/engagement signals using 1 Serper query (most conservative).

    Args:
        company_name: The company to search for
        domain:       The company's domain

    Returns:
        List of signal dicts with type="social_signal"
    """
    if not company_name:
        return []

    now_iso = datetime.now(timezone.utc).isoformat()

    # ── Single conservative query ─────────────────────────────────────────────
    # Combine GitHub + conference + community in one query to save budget
    query = (
        f'"{company_name}" (site:github.com OR conference OR speaker OR '
        f'"open source" OR community OR meetup)'
    )

    try:
        data = await fetch_leads_from_serper(query)
        results = data.get("organic", [])
    except Exception as e:
        logger.warning("Social signal Serper query failed for '%s': %s", company_name, e)
        return []

    if not results:
        logger.info("No social signal results for '%s'", company_name)
        return []

    # ── LLM extraction ────────────────────────────────────────────────────────
    raw_signals = await _llm_extract_social_signals(results, company_name)

    # ── Build signal dicts ────────────────────────────────────────────────────
    signals = []
    for raw in raw_signals:
        weight = _compute_social_weight(raw)

        signals.append({
            "type": "social_signal",
            "source": _extract_domain(raw.get("url", "")),
            "title": raw.get("title", "Social signal detected"),
            "weight": weight,
            "confidence": raw.get("confidence", "medium"),
            "timestamp": now_iso,
            "url": raw.get("url", ""),
            "summary": f"{raw.get('signal_type', 'engagement')}: {raw.get('title', '')}",
            "category": "engagement",
            "signal_subtype": raw.get("signal_type"),
        })

    logger.info(
        "Detected %d social signals for '%s'",
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
