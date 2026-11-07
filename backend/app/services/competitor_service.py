import logging
from datetime import datetime

from fastapi import HTTPException

from app.db.competitors import insert_competitors_request
from app.db.requests import update_request_status
from app.services.product_similarity import run_similarity_pipeline

logger = logging.getLogger("app.services.competitor_service")


async def run_competitor_pipeline(request_id: str, product_description: str, user_id: str) -> None:
    """Background task: run the full competitor similarity pipeline."""
    await run_similarity_pipeline(request_id, product_description, user_id)


async def find_competitors(request_id: str, product_description: str, user_id: str) -> list:
    """Synchronous competitor discovery — returns enriched list."""
    return await run_similarity_pipeline(request_id, product_description, user_id)


async def get_competitors(request_id: str, user_id: str) -> dict:
    """Retrieve stored competitor results from competitor_analyses + competitors (ERD schema)."""
    from app.db.database import get_db
    db = get_db()

    analysis = await db.competitor_analyses.find_one(
        {"request_id": request_id, "user_id": user_id}
    )
    if not analysis:
        # Legacy fallback: check competitor_test embedded array
        legacy = await db.competitor_test.find_one({"_id": request_id, "user_id": user_id})
        if legacy and legacy.get("competitors"):
            return {"status": legacy.get("status"), "competitors": legacy["competitors"]}
        raise HTTPException(status_code=404, detail="No competitor data found for this request_id")

    competitors = await db.competitors.find(
        {"analysis_id": str(analysis["_id"])}
    ).sort("match_score", -1).to_list(length=None)

    # Strip internal Mongo fields
    for c in competitors:
        c.pop("_id", None)
        c.pop("analysis_id", None)

    return {"status": analysis.get("status"), "competitors": competitors}


async def start_similarity_research(product_description: str, user_id: str) -> str:
    """
    Create a competitor pipeline request document and return its ID.
    The caller is responsible for scheduling the background task.
    """
    payload = {
        "title": "Product similarity research",
        "product_description": product_description,
        "status": "Pending",
        "created_at": datetime.utcnow(),
    }
    return await insert_competitors_request(payload, user_id)
