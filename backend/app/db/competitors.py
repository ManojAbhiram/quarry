from app.db.database import get_db
from app.core.logger import logger
from datetime import datetime
import uuid


async def insert_competitors_request(request_data: dict, user_id: str) -> str:
    """
    Insert a new lead request document into the competitors collection (legacy product-similarity pipeline).
    Returns the string _id of the inserted document.
    """
    db = get_db()
    request_data["user_id"] = str(user_id)

    req_id = request_data.pop("id", None) or str(uuid.uuid4())
    request_data["_id"] = str(req_id)

    if "created_at" not in request_data:
        request_data["created_at"] = datetime.utcnow()
    if "status" not in request_data:
        request_data["status"] = "Pending"

    await db.competitors.insert_one(request_data)
    logger.info("Inserted competitors request %s for user %s", req_id, user_id)
    return str(req_id)


async def create_competitor_run(request_id: str, user_id: str, product_description: str = "") -> None:
    """
    Upsert a run-level document in competitor_test keyed by request_id.
    Sets status to Pending on first creation; does not overwrite an existing doc.
    Also creates/updates a corresponding competitor_analyses document.
    """
    db = get_db()
    now = datetime.utcnow()

    # Legacy competitor_test collection (backward compat)
    await db.competitor_test.update_one(
        {"_id": request_id},
        {
            "$setOnInsert": {
                "_id": request_id,
                "request_id": request_id,
                "user_id": str(user_id),
                "status": "Pending",
                "created_at": now,
            }
        },
        upsert=True,
    )
    logger.info("Competitor run created for request_id=%s (status=Pending)", request_id)

    # Also write to competitor_analyses (new normalized collection)
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
    """
    Update the status of the run-level document in competitor_test.
    Also mirrors the status into competitor_analyses.
    """
    db = get_db()
    now = datetime.utcnow()

    # Legacy competitor_test collection (backward compat)
    await db.competitor_test.update_one(
        {"_id": request_id},
        {"$set": {"status": status, "updated_at": now}},
    )
    logger.info("Competitor run %s -> status=%s", request_id, status)

    # Mirror into competitor_analyses
    try:
        from app.db.competitor_analyses import update_competitor_analysis_status
        await update_competitor_analysis_status(request_id, status)
    except Exception as exc:
        logger.warning("Failed to update competitor_analysis status for request %s: %s", request_id, exc)