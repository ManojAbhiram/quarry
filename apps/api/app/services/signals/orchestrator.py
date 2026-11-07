"""
Signal Orchestrator — Runs all signal sources in parallel for a lead.

This is the main entry point called by the API endpoint when a user
clicks "Analyze Intent" on a lead card.

Budget: ~7-9 Serper queries per lead analysis:
    - Job signals:     2 queries
    - Funding signals: 2 queries
    - News signals:    2 queries
    - Social signals:  1 query
    - Tech signals:    0 queries (uses already-detected data)
"""

import asyncio
import logging
from datetime import datetime, timezone

from app.core.config import settings
from app.services.signals.job_signals import detect_job_signals
from app.services.signals.funding_signals import detect_funding_signals
from app.services.signals.news_signals import detect_news_signals
from app.services.signals.tech_signals import detect_tech_signals
from app.services.signals.social_signals import detect_social_signals
from app.services.scoring import compute_intent_score

logger = logging.getLogger("app.services.signals.orchestrator")


async def _generate_intent_summary(
    company_name: str,
    score_result: dict,
    signals: list[dict],
) -> str:
    """
    Use LLM to generate a 1-paragraph human-readable intent summary
    explaining why this lead appears (or doesn't appear) to be in a
    buying mindset right now.
    """
    from app.services.llm import _llm_text_completion

    if not signals:
        return f"No intent signals detected for {company_name} at this time."

    # Build a compact summary of signals for the LLM
    signal_summary = "\n".join(
        f"- [{s.get('type', '?')}] {s.get('title', '')} "
        f"(weight: {s.get('weight', 0)}, confidence: {s.get('confidence', '?')})"
        for s in signals[:15]  # Cap to avoid token overflow
    )

    breakdown = score_result.get("score_breakdown", {})
    band = score_result.get("intent_band", "UNKNOWN")
    score = score_result.get("intent_score", 0)

    system_prompt = (
        "You are a B2B sales intelligence analyst.  Write a concise, actionable "
        "1-paragraph summary explaining why a company is or isn't showing buying "
        "intent right now.  Be specific about the signals.  Address the SDR directly."
    )

    user_prompt = f"""Company: {company_name}
Intent Score: {score}/100 ({band})
Score Breakdown: Firmographic={breakdown.get('firmographic', 0)}, Tech={breakdown.get('tech', 0)}, Intent={breakdown.get('intent', 0)}, Engagement={breakdown.get('engagement', 0)}

Detected signals:
{signal_summary}

Write a 2-3 sentence paragraph explaining why this company is classified as {band} and what the key signals mean for an SDR planning outreach.  Be specific and actionable."""

    summary = await _llm_text_completion(
        model=settings.LITELLM_MODEL_MINI,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=200,
        timeout=15,
    )

    return summary or f"{company_name} has an intent score of {score}/100 ({band})."


def _extract_icp_context(request_doc: dict) -> dict:
    """
    Extract ICP-relevant context from the request document for signal detection.

    Returns:
        {
            "icp_roles":       list of target job titles
            "competitors":     list of competitor names
            "icp_tech_keywords": list of technologies the ICP cares about
        }
    """
    icp_roles = []
    competitors = []
    icp_tech_keywords = []

    # Extract from ICP dimensions if available
    icp_dimensions = request_doc.get("icp_dimensions") or {}
    if isinstance(icp_dimensions, dict):
        # Technographic dimension
        tech_dim = icp_dimensions.get("technographic") or {}
        if isinstance(tech_dim, dict):
            tech_value = tech_dim.get("value", "")
            if tech_value:
                # Simple split on commas and common separators
                icp_tech_keywords = [
                    t.strip() for t in tech_value.replace(";", ",").split(",")
                    if t.strip() and len(t.strip()) > 2
                ]

    # Extract competitors from request
    req_competitors = request_doc.get("competitors") or []
    if isinstance(req_competitors, list):
        for c in req_competitors:
            if isinstance(c, dict):
                name = c.get("company_name") or c.get("name") or ""
                if name:
                    competitors.append(name)
            elif isinstance(c, str) and c.strip():
                competitors.append(c.strip())

    # Extract target roles from ICP text
    icp_text = (
        request_doc.get("ideal_lead_profile")
        or request_doc.get("icp")
        or ""
    )
    if icp_text:
        # Common B2B decision-maker roles to look for in ICP text
        common_roles = [
            "CTO", "VP Engineering", "Head of Data", "Data Engineer",
            "Data Scientist", "VP Analytics", "Head of Engineering",
            "Chief Data Officer", "VP Product", "Product Manager",
            "Director of Engineering", "DevOps", "Platform Engineer",
        ]
        icp_lower = icp_text.lower()
        for role in common_roles:
            if role.lower() in icp_lower:
                icp_roles.append(role)

    # Defaults if nothing found
    if not icp_roles:
        icp_roles = ["CTO", "VP Engineering", "Head of Data"]

    return {
        "icp_roles": icp_roles,
        "competitors": competitors,
        "icp_tech_keywords": icp_tech_keywords,
    }


async def collect_all_signals(
    lead: dict,
    request_doc: dict,
) -> dict:
    """
    Run all 5 signal sources for a single lead and compute intent score.

    This is the main entry point called when a user clicks "Analyze Intent".

    Args:
        lead:        The lead dict (from enriched_leads array)
        request_doc: The full request document (for ICP context)

    Returns:
        {
            "intent_score":          int (0-100),
            "intent_band":           str,
            "band_emoji":            str,
            "band_action":           str,
            "intent_signals":        list[dict],
            "intent_summary":        str,
            "score_breakdown":       dict,
            "pillar_details":        dict,
            "total_signals":         int,
            "intent_score_updated_at": str (ISO datetime),
            "signal_timeline":       list[dict],
            "serper_queries_used":   int,
        }
    """
    company_name = lead.get("company_name") or lead.get("title") or ""
    domain = lead.get("url") or lead.get("website") or ""
    existing_match_score = lead.get("match_score")

    if not company_name:
        logger.warning("Cannot analyze intent — no company name on lead")
        return {"intent_score": 0, "intent_band": "COLD", "intent_signals": []}

    logger.info("Starting intent analysis for '%s' (%s)", company_name, domain)

    # Extract ICP context
    icp_ctx = _extract_icp_context(request_doc)

    # ── Run all signal sources in parallel ────────────────────────────────────
    # Tech signals are sync (no network), so we wrap them
    tech_stack = lead.get("tech_stack") or []
    infrastructure = lead.get("infrastructure") or {}

    job_task = detect_job_signals(
        company_name, domain,
        icp_roles=icp_ctx["icp_roles"],
        competitors=icp_ctx["competitors"],
    )
    funding_task = detect_funding_signals(company_name, domain)
    news_task = detect_news_signals(
        company_name, domain,
        competitors=icp_ctx["competitors"],
    )
    social_task = detect_social_signals(company_name, domain)

    # Run network-bound signals concurrently
    results = await asyncio.gather(
        job_task, funding_task, news_task, social_task,
        return_exceptions=True,
    )

    # Collect all signals, handling errors gracefully
    all_signals = []
    serper_queries_used = 0

    signal_sources = [
        ("job_signals", results[0], 2),
        ("funding_signals", results[1], 2),
        ("news_signals", results[2], 2),
        ("social_signals", results[3], 1),
    ]

    for name, result, query_count in signal_sources:
        if isinstance(result, Exception):
            logger.warning("Signal source '%s' failed for '%s': %s", name, company_name, result)
        elif isinstance(result, list):
            all_signals.extend(result)
            serper_queries_used += query_count
        else:
            logger.warning("Unexpected result type from '%s': %s", name, type(result))

    # Tech signals are synchronous — run inline
    try:
        tech_sigs = detect_tech_signals(
            tech_stack, infrastructure,
            icp_tech_keywords=icp_ctx["icp_tech_keywords"],
            competitors=icp_ctx["competitors"],
        )
        all_signals.extend(tech_sigs)
    except Exception as e:
        logger.warning("Tech signal detection failed for '%s': %s", company_name, e)

    logger.info(
        "Collected %d total signals for '%s' using %d Serper queries",
        len(all_signals), company_name, serper_queries_used,
    )

    # ── Compute intent score ──────────────────────────────────────────────────
    # Find the most recent signal date for decay calculation
    signal_dates = [
        s.get("timestamp") for s in all_signals
        if s.get("timestamp")
    ]
    last_signal_date = max(signal_dates) if signal_dates else None

    score_result = compute_intent_score(
        all_signals,
        existing_match_score=existing_match_score,
        last_signal_date=last_signal_date,
    )

    # ── Generate AI intent summary ────────────────────────────────────────────
    intent_summary = await _generate_intent_summary(
        company_name, score_result, all_signals,
    )

    # ── Build signal timeline (sorted by timestamp, newest first) ─────────────
    signal_timeline = sorted(
        all_signals,
        key=lambda s: s.get("timestamp", ""),
        reverse=True,
    )

    now_iso = datetime.now(timezone.utc).isoformat()

    return {
        "intent_score": score_result["intent_score"],
        "intent_band": score_result["intent_band"],
        "band_emoji": score_result["band_emoji"],
        "band_action": score_result["band_action"],
        "intent_signals": all_signals,
        "intent_summary": intent_summary,
        "score_breakdown": score_result["score_breakdown"],
        "pillar_details": score_result["pillar_details"],
        "total_signals": score_result["total_signals"],
        "decay_applied": score_result["decay_applied"],
        "intent_score_updated_at": now_iso,
        "signal_timeline": signal_timeline,
        "serper_queries_used": serper_queries_used,
    }
