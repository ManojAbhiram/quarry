"""
Database helpers for intent signals.

Stores and retrieves intent analysis results per lead, including
signal cache to avoid redundant Serper queries.
"""

from datetime import datetime, timedelta
import logging

from app.db.models import TABLES

logger = logging.getLogger("app.db.signals")

_leads = TABLES["leads"]
_cache = TABLES["serper_cache"]


async def save_intent_analysis(
    request_id: str,
    lead_index: int,
    intent_data: dict,
) -> bool:
    """
    Save intent analysis results to a specific lead in the leads table.
    """
    from app.db.leads import get_normalized_leads_for_request
    leads = await get_normalized_leads_for_request(request_id)
    if not leads or lead_index < 0 or lead_index >= len(leads):
        logger.warning(
            "No lead found at index %d for request %s to save intent analysis",
            lead_index, request_id
        )
        return False

    lead = leads[lead_index]
    lead_url = lead.get("url")
    if not lead_url:
        logger.warning(
            "Lead at index %d for request %s does not have a url",
            lead_index, request_id
        )
        return False

    update_fields = {
        "intent_score": intent_data.get("intent_score", 0),
        "intent_band": intent_data.get("intent_band", "COLD"),
        "band_emoji": intent_data.get("band_emoji", "🔵"),
        "band_action": intent_data.get("band_action", ""),
        "intent_signals": intent_data.get("intent_signals", []),
        "intent_summary": intent_data.get("intent_summary", ""),
        "score_breakdown": intent_data.get("score_breakdown", {}),
        "pillar_details": intent_data.get("pillar_details", {}),
        "total_signals": intent_data.get("total_signals", 0),
        "intent_score_updated_at": intent_data.get("intent_score_updated_at"),
        "signal_timeline": intent_data.get("signal_timeline", []),
        "serper_queries_used": intent_data.get("serper_queries_used", 0),
    }

    try:
        row = await _leads.get(request_id=request_id, url=lead_url)
        if row:
            await _leads.update(row["_id"], update_fields)
            logger.info(
                "Saved intent analysis to leads table for lead index %d (url=%s) in request %s "
                "(score=%d, band=%s, signals=%d)",
                lead_index, lead_url, request_id,
                intent_data.get("intent_score", 0),
                intent_data.get("intent_band", "?"),
                intent_data.get("total_signals", 0),
            )
            return True
        logger.warning(
            "No lead document found/modified for intent analysis (request=%s, url=%s)",
            request_id, lead_url,
        )
        return False

    except Exception as e:
        logger.error("Failed to save intent analysis: %s", e)
        raise


async def get_lead_with_intent(
    request_id: str,
    lead_index: int,
    user_id: str,
) -> dict | None:
    """
    Retrieve a specific lead with its intent data.
    """
    from app.db.leads import get_normalized_leads_for_request
    leads = await get_normalized_leads_for_request(request_id)
    if not leads or lead_index < 0 or lead_index >= len(leads):
        return None
    return leads[lead_index]


async def cache_serper_result(
    query: str,
    results: list[dict],
    ttl_days: int = 7,
) -> None:
    """
    Cache a Serper query result to avoid redundant API calls.

    Results are stored in a dedicated `serper_cache` table; entries expire after `ttl_days`.
    """
    now = datetime.utcnow()
    try:
        await _cache.upsert(
            {"query": query},
            {"results": results, "created_at": now, "expires_at": now + timedelta(days=ttl_days)},
        )
    except Exception as e:
        logger.warning("Failed to cache Serper result: %s", e)


async def get_cached_serper_result(query: str) -> list[dict] | None:
    """
    Retrieve a cached Serper result if it exists and hasn't expired.
    """
    try:
        doc = await _cache.get(query=query)
        if doc and (doc["expires_at"] is None or doc["expires_at"] > datetime.utcnow()):
            return doc.get("results")
    except Exception as e:
        logger.warning("Failed to read Serper cache: %s", e)

    return None
