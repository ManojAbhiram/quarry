import logging
from datetime import datetime

from fastapi import HTTPException

from app.db.competitors import insert_competitors_request
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
    from app.db.competitor_analyses import get_competitor_analysis_for_user, list_competitors_for_analysis

    analysis = await get_competitor_analysis_for_user(request_id, user_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="No competitor data found for this request_id")

    competitors = await list_competitors_for_analysis(analysis["_id"])

    # Strip internal fields
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
