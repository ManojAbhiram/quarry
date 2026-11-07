from datetime import datetime
from typing import Optional
import uuid

from app.core.logger import logger
from app.db.database import get_db


async def get_enrichment_for_lead(lead_id: str) -> Optional[dict]:
    db = get_db()
    return await db.lead_enrichments.find_one({"lead_id": lead_id})


async def upsert_lead_enrichment(lead_id: str, company_id: Optional[str], enrichment_data: dict) -> None:
    db = get_db()
    now = datetime.utcnow()
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
        "enriched_at": now,
    }
    existing = await db.lead_enrichments.find_one({"lead_id": lead_id})
    if existing:
        await db.lead_enrichments.update_one({"_id": existing["_id"]}, {"$set": doc})
    else:
        doc["_id"] = str(uuid.uuid4())
        await db.lead_enrichments.insert_one(doc)
    logger.info("Upserted lead_enrichment for lead %s", lead_id)
