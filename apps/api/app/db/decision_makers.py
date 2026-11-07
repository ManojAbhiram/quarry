from datetime import datetime
from typing import List

from sqlalchemy import func, select

from app.core.logger import logger
from app.db import engine as _engine
from app.db.models import TABLES, DecisionMaker, Lead

_dms = TABLES["decision_makers"]
_leads = TABLES["leads"]


async def get_decision_makers_for_lead(lead_id: str) -> List[dict]:
    return await _dms.find(DecisionMaker.lead_id == lead_id)


async def get_decision_makers_for_request(request_id: str) -> List[dict]:
    """Return all decision makers across every lead in a request, with company_name attached."""
    lead_docs = await _leads.find(Lead.request_id == request_id)
    if not lead_docs:
        return []

    lead_id_to_company = {doc["_id"]: doc.get("title") or "" for doc in lead_docs}
    raw_dms = await _dms.find(DecisionMaker.lead_id.in_(list(lead_id_to_company)))

    result = []
    for dm in raw_dms:
        lead_id = dm.get("lead_id") or ""
        result.append({
            "id": dm["_id"],
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


async def count_decision_makers_by_lead(lead_ids: list[str]) -> dict[str, int]:
    """{lead_id: number of decision makers} for the leads that have any."""
    if not lead_ids:
        return {}
    stmt = (
        select(DecisionMaker.lead_id, func.count())
        .where(DecisionMaker.lead_id.in_(lead_ids))
        .group_by(DecisionMaker.lead_id)
    )
    async with _engine.read_session() as s, s.begin():
        return {lead_id: count for lead_id, count in (await s.execute(stmt)).all()}


async def insert_decision_maker_if_new(lead_id: str, dm_data: dict) -> None:
    linkedin_url = dm_data.get("linkedin_url") or dm_data.get("url") or ""
    for existing in await get_decision_makers_for_lead(lead_id):
        if existing.get("linkedin_url") == linkedin_url:
            return
    await _dms.insert({
        "lead_id": lead_id,
        "name": dm_data.get("name") or "",
        "title": dm_data.get("title") or "",
        "linkedin_url": linkedin_url,
        "email": dm_data.get("email") or None,
        "snippet": dm_data.get("snippet") or None,
        "recent_activity_summary": dm_data.get("recent_activity_summary") or None,
        "recent_posts": dm_data.get("recent_posts") or [],
        "created_at": datetime.utcnow(),
    })
    logger.info("Inserted decision_maker for lead %s: %s", lead_id, dm_data.get("name"))
