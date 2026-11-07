from datetime import datetime
from typing import List
import uuid

from app.core.logger import logger
from app.db.database import get_db


async def get_decision_makers_for_lead(lead_id: str) -> List[dict]:
    db = get_db()
    return await db.decision_makers.find({"lead_id": lead_id}).to_list(length=None)


async def get_decision_makers_for_request(request_id: str) -> List[dict]:
    """Return all decision makers across every lead in a request, with company_name attached."""
    db = get_db()
    lead_docs = await db.leads.find(
        {"request_id": request_id}, {"_id": 1, "title": 1}
    ).to_list(length=None)
    if not lead_docs:
        return []

    lead_id_to_company = {str(doc["_id"]): doc.get("title") or "" for doc in lead_docs}
    lead_ids = list(lead_id_to_company.keys())

    raw_dms = await db.decision_makers.find(
        {"lead_id": {"$in": lead_ids}}
    ).to_list(length=None)

    result = []
    for dm in raw_dms:
        lead_id = dm.get("lead_id", "")
        result.append({
            "id": str(dm.get("_id", "")),
            "lead_id": lead_id,
            "company_name": lead_id_to_company.get(lead_id, ""),
            "name": dm.get("name") or "",
            "title": dm.get("title") or "",
            "linkedin_url": dm.get("linkedin_url") or "",
            "email": dm.get("email") or "",
            "snippet": dm.get("snippet"),
            "recent_activity_summary": dm.get("recent_activity_summary"),
            "recent_posts": dm.get("recent_posts") or [],
        })
    return result


async def insert_decision_maker_if_new(lead_id: str, dm_data: dict) -> None:
    db = get_db()
    linkedin_url = dm_data.get("linkedin_url") or dm_data.get("url") or ""
    existing = await db.decision_makers.find_one(
        {"lead_id": lead_id, "linkedin_url": linkedin_url}
    )
    if existing:
        return
    doc = {
        "_id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "name": dm_data.get("name") or "",
        "title": dm_data.get("title") or "",
        "linkedin_url": linkedin_url,
        "email": dm_data.get("email") or None,
        "snippet": dm_data.get("snippet") or None,
        "recent_activity_summary": dm_data.get("recent_activity_summary") or None,
        "recent_posts": dm_data.get("recent_posts") or [],
        "created_at": datetime.utcnow(),
    }
    await db.decision_makers.insert_one(doc)
    logger.info("Inserted decision_maker for lead %s: %s", lead_id, dm_data.get("name"))
