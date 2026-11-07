from datetime import datetime
from typing import Optional
import uuid

from app.core.logger import logger
from app.db.database import get_db


async def upsert_product_intake(request_id: str, intake_data: dict) -> str:
    """
    Upsert a product_intake document keyed by request_id.
    Returns the _id of the doc.
    """
    db = get_db()
    now = datetime.utcnow()

    # Build the doc to store, excluding any existing _id / request_id from the data
    doc = {k: v for k, v in intake_data.items() if k not in ("_id", "request_id")}
    doc["request_id"] = request_id
    doc["updated_at"] = now

    existing = await db.product_intake.find_one({"request_id": request_id})
    if existing:
        doc_id = str(existing["_id"])
        await db.product_intake.update_one(
            {"_id": existing["_id"]},
            {"$set": doc},
        )
        logger.info("Updated product_intake for request %s", request_id)
        return doc_id
    else:
        doc_id = str(uuid.uuid4())
        doc["_id"] = doc_id
        doc["created_at"] = now
        await db.product_intake.insert_one(doc)
        logger.info("Inserted product_intake for request %s (id=%s)", request_id, doc_id)
        return doc_id


async def get_product_intake(request_id: str) -> Optional[dict]:
    db = get_db()
    return await db.product_intake.find_one({"request_id": request_id})
