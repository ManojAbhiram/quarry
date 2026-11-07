from datetime import datetime
from typing import Optional

from app.core.logger import logger
from app.db.models import TABLES

_enrichments = TABLES["lead_enrichments"]


async def get_enrichment_for_lead(lead_id: str) -> Optional[dict]:
    return await _enrichments.get(lead_id=lead_id)


async def upsert_lead_enrichment(lead_id: str, company_id: Optional[str], enrichment_data: dict) -> None:
    doc = {
        "lead_id": lead_id,
        "company_id": company_id,
        "contact_name": enrichment_data.get("contact_name") or None,
        "contact_title": enrichment_data.get("contact_title") or None,
        "buying_signals": enrichment_data.get("buying_signals") or None,
        "match_explanation": enrichment_data.get("match_explanation") or None,
        "signals": enrichment_data.get("signals") or [],
        "careers_tech_signals": enrichment_data.get("careers_tech_signals") or None,
        "enrichment_source": "pipeline",
        "enriched_at": datetime.utcnow(),
    }
    await _enrichments.upsert({"lead_id": lead_id}, doc)
    logger.info("Upserted lead_enrichment for lead %s", lead_id)
