from datetime import datetime
import uuid

from app.core.logger import logger
from app.db.models import TABLES

_competitors = TABLES["competitors"]


async def insert_competitors_request(request_data: dict, user_id: str) -> str:
    """
    Insert a new lead request document into the competitors table (legacy product-similarity pipeline).
    Returns the string _id of the inserted document.
    """
    request_data["user_id"] = str(user_id)

    req_id = request_data.pop("id", None) or str(uuid.uuid4())
    request_data["_id"] = str(req_id)

    if "created_at" not in request_data:
        request_data["created_at"] = datetime.utcnow()
    if "status" not in request_data:
        request_data["status"] = "Pending"

    await _competitors.insert(request_data)
    logger.info("Inserted competitors request %s for user %s", req_id, user_id)
    return str(req_id)


async def create_competitor_run(request_id: str, user_id: str, product_description: str = "") -> None:
    """Create (or reuse) the competitor_analyses document for a pipeline run, status Pending."""
    logger.info("Competitor run created for request_id=%s (status=Pending)", request_id)
    try:
        from app.db.competitor_analyses import upsert_competitor_analysis
        await upsert_competitor_analysis(
            request_id=request_id,
            user_id=user_id,
            product_description=product_description,
            status="Pending",
        )
    except Exception as exc:
        logger.warning("Failed to upsert competitor_analysis for request %s: %s", request_id, exc)


async def update_competitor_run_status(request_id: str, status: str) -> None:
    """Update the status of a pipeline run (stored on its competitor_analyses document)."""
    logger.info("Competitor run %s -> status=%s", request_id, status)
    try:
        from app.db.competitor_analyses import update_competitor_analysis_status
        await update_competitor_analysis_status(request_id, status)
    except Exception as exc:
        logger.warning("Failed to update competitor_analysis status for request %s: %s", request_id, exc)
