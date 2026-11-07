from datetime import datetime
from typing import Optional
import uuid

from app.core.logger import logger
from app.db.database import get_db


async def upsert_competitor_analysis(
    request_id: str,
    user_id: str,
    product_description: str = "",
    status: str = "Pending",
) -> str:
    """
    Upsert a competitor_analyses doc keyed by request_id.
    Returns the _id of the doc.
    """
    db = get_db()
    now = datetime.utcnow()

    existing = await db.competitor_analyses.find_one({"request_id": request_id})
    if existing:
        analysis_id = str(existing["_id"])
        await db.competitor_analyses.update_one(
            {"_id": existing["_id"]},
            {"$set": {"status": status, "updated_at": now}},
        )
        logger.info("Updated competitor_analysis for request %s -> status=%s", request_id, status)
        return analysis_id
    else:
        analysis_id = str(uuid.uuid4())
        doc = {
            "_id": analysis_id,
            "request_id": request_id,
            "user_id": str(user_id),
            "product_description": product_description,
            "status": status,
            "created_at": now,
            "updated_at": now,
        }
        await db.competitor_analyses.insert_one(doc)
        logger.info("Inserted competitor_analysis for request %s (id=%s)", request_id, analysis_id)
        return analysis_id


async def update_competitor_analysis_status(request_id: str, status: str) -> None:
    db = get_db()
    await db.competitor_analyses.update_one(
        {"request_id": request_id},
        {"$set": {"status": status, "updated_at": datetime.utcnow()}},
    )
    logger.info("competitor_analysis for request %s -> status=%s", request_id, status)


async def get_competitor_analysis(request_id: str) -> Optional[dict]:
    db = get_db()
    return await db.competitor_analyses.find_one({"request_id": request_id})


async def save_competitors_to_analysis(analysis_id: str, competitors: list) -> None:
    """
    Bulk upsert competitor docs into the competitors collection linked to analysis_id.
    Uses (analysis_id, url) as unique key.
    """
    if not competitors:
        return
    db = get_db()
    now = datetime.utcnow()

    for comp in competitors:
        url = comp.get("url") or comp.get("company_website") or ""
        doc = {
            "analysis_id": analysis_id,
            "url": url,
            "title": comp.get("title") or comp.get("company_name") or "",
            "company_name": comp.get("company_name") or "",
            "match_score": comp.get("match_score") or 0,
            "reason": comp.get("reason") or "",
            "g2_rating": comp.get("g2_rating"),
            "capterra_rating": comp.get("capterra_rating"),
            "linkedin_url": comp.get("linkedin_url"),
            "company_website": comp.get("company_website"),
            "company_size": comp.get("company_size"),
            "headquarters": comp.get("headquarters"),
            "industry": comp.get("industry"),
            "company_type": comp.get("company_type"),
            "founded": comp.get("founded"),
            "specialties": comp.get("specialties"),
            "updated_at": now,
        }
        try:
            existing = await db.competitors.find_one(
                {"analysis_id": analysis_id, "url": url}
            )
            if existing:
                await db.competitors.update_one(
                    {"_id": existing["_id"]},
                    {"$set": doc},
                )
            else:
                doc["_id"] = str(uuid.uuid4())
                doc["created_at"] = now
                await db.competitors.insert_one(doc)
        except Exception as exc:
            logger.warning("Failed to upsert competitor url=%s: %s", url, exc)

    logger.info("Saved %d competitors for analysis %s", len(competitors), analysis_id)
