"""
Signal B — Technographic Signals  [up to 22 pts]

Wraps the existing tech_stack.py detection engine and compares the
detected stack against the ICP's technographic profile to produce
intent signals.

Signal weights (from PRD Phase 5):
    +18  Company uses competitor tool
    +22  Data warehouse detected (Snowflake, BigQuery, Redshift)
    +15  Recently adopted ICP-adjacent tool (dbt, Fivetran)
    +35  Removed competitor from stack (capped to pillar max 20)
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger("app.services.signals.tech_signals")


# ---------------------------------------------------------------------------
# Known technology categories for intent scoring
# ---------------------------------------------------------------------------

_DATA_WAREHOUSES = {
    "snowflake", "bigquery", "google bigquery", "redshift", "amazon redshift",
    "databricks", "synapse", "azure synapse", "clickhouse", "firebolt",
}

_DATA_TOOLS = {
    "dbt", "fivetran", "airbyte", "stitch", "matillion", "talend",
    "informatica", "apache airflow", "dagster", "prefect", "meltano",
}

_ANALYTICS_TOOLS = {
    "tableau", "looker", "power bi", "metabase", "mode analytics",
    "sigma computing", "thoughtspot", "amplitude", "mixpanel", "heap",
}


def _normalize_tech(name: str) -> str:
    """Lowercase and strip for comparison."""
    return (name or "").strip().lower()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_tech_signals(
    lead_tech_stack: list[str],
    lead_infrastructure: dict,
    icp_tech_keywords: list[str] | None = None,
    competitors: list[str] | None = None,
) -> list[dict]:
    """
    Compare a lead's detected tech stack against ICP requirements to produce
    technographic intent signals.

    This function is SYNCHRONOUS because it operates on already-detected data
    from tech_stack.py — no network calls needed.

    Args:
        lead_tech_stack:    List of technologies detected on the lead's website
        lead_infrastructure: Infrastructure dict from infrastructure_detection.py
        icp_tech_keywords:  Technologies the ICP cares about
        competitors:        Competitor tool/product names

    Returns:
        List of signal dicts with type="tech_signal"
    """
    if not lead_tech_stack and not lead_infrastructure:
        return []

    competitors = competitors or []
    icp_tech_keywords = icp_tech_keywords or []
    now_iso = datetime.now(timezone.utc).isoformat()

    # Normalize everything for comparison
    stack_set = {_normalize_tech(t) for t in lead_tech_stack if t}
    competitor_set = {_normalize_tech(c) for c in competitors if c}
    icp_set = {_normalize_tech(k) for k in icp_tech_keywords if k}

    # Also flatten infrastructure dict into the stack set
    if isinstance(lead_infrastructure, dict):
        for category, items in lead_infrastructure.items():
            if isinstance(items, list):
                for item in items:
                    stack_set.add(_normalize_tech(item))

    signals = []

    # ── Check 1: Competitor tool in stack ─────────────────────────────────────
    for tech in stack_set:
        for comp in competitor_set:
            if comp in tech or tech in comp:
                signals.append({
                    "type": "tech_signal",
                    "source": "tech_stack_detection",
                    "title": f"Uses competitor tool: {tech}",
                    "weight": 18,
                    "confidence": "high",
                    "timestamp": now_iso,
                    "url": "",
                    "summary": f"{tech} (competitor) detected in tech stack — "
                               f"potential displacement target",
                    "category": "tech",
                    "tech_name": tech,
                    "signal_subtype": "competitor_tool",
                })
                break  # Don't double-count the same tech

    # ── Check 2: Data warehouse detected ──────────────────────────────────────
    for tech in stack_set:
        if tech in _DATA_WAREHOUSES:
            signals.append({
                "type": "tech_signal",
                "source": "tech_stack_detection",
                "title": f"Data warehouse detected: {tech}",
                "weight": 22,
                "confidence": "high",
                "timestamp": now_iso,
                "url": "",
                "summary": f"{tech} data warehouse detected — indicates mature data "
                           f"infrastructure and potential need for analytics/data tools",
                "category": "tech",
                "tech_name": tech,
                "signal_subtype": "data_warehouse",
            })
            break  # Only count one warehouse

    # ── Check 3: ICP-adjacent tools ───────────────────────────────────────────
    for tech in stack_set:
        if tech in _DATA_TOOLS or tech in _ANALYTICS_TOOLS:
            # Check if it's also an ICP keyword (stronger signal)
            is_icp_match = any(icp_kw in tech or tech in icp_kw for icp_kw in icp_set)
            signals.append({
                "type": "tech_signal",
                "source": "tech_stack_detection",
                "title": f"Adjacent tool detected: {tech}",
                "weight": 15 if not is_icp_match else 18,
                "confidence": "high" if is_icp_match else "medium",
                "timestamp": now_iso,
                "url": "",
                "summary": f"{tech} detected — indicates data-forward organization"
                           f"{' (ICP match)' if is_icp_match else ''}",
                "category": "tech",
                "tech_name": tech,
                "signal_subtype": "adjacent_tool",
            })

    # ── Check 4: ICP technology keyword matches ───────────────────────────────
    for tech in stack_set:
        for icp_kw in icp_set:
            if (icp_kw in tech or tech in icp_kw) and not any(
                s.get("tech_name") == tech for s in signals
            ):
                signals.append({
                    "type": "tech_signal",
                    "source": "tech_stack_detection",
                    "title": f"ICP tech match: {tech}",
                    "weight": 12,
                    "confidence": "medium",
                    "timestamp": now_iso,
                    "url": "",
                    "summary": f"{tech} matches ICP technographic requirement '{icp_kw}'",
                    "category": "tech",
                    "tech_name": tech,
                    "signal_subtype": "icp_tech_match",
                })
                break

    logger.info(
        "Detected %d tech signals from stack of %d technologies",
        len(signals), len(stack_set),
    )
    return signals
