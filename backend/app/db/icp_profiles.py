from datetime import datetime
from typing import Optional
import uuid

from app.core.logger import logger
from app.db.database import get_db


async def upsert_icp_profile(request_id: str, icp_data: dict, queries: Optional[list] = None) -> str:
    """
    Upsert an icp_profiles document keyed by request_id.
    icp_data should contain the 6 ICP dimension dicts (firmographic, technographic, etc.).
    Returns the _id of the doc.
    """
    db = get_db()
    now = datetime.utcnow()

    # Build the document
    doc = {k: v for k, v in icp_data.items() if k not in ("_id", "request_id")}
    doc["request_id"] = request_id
    doc["updated_at"] = now
    if queries is not None:
        doc["queries"] = queries

    existing = await db.icp_profiles.find_one({"request_id": request_id})
    if existing:
        doc_id = str(existing["_id"])
        await db.icp_profiles.update_one(
            {"_id": existing["_id"]},
            {"$set": doc},
        )
        logger.info("Updated icp_profile for request %s", request_id)
        return doc_id
    else:
        doc_id = str(uuid.uuid4())
        doc["_id"] = doc_id
        doc["generated_at"] = now
        await db.icp_profiles.insert_one(doc)
        logger.info("Inserted icp_profile for request %s (id=%s)", request_id, doc_id)
        return doc_id


async def get_icp_profile(request_id: str) -> Optional[dict]:
    db = get_db()
    return await db.icp_profiles.find_one({"request_id": request_id})
