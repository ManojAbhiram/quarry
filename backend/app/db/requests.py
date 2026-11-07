from datetime import datetime
from typing import Optional
import uuid

from app.core.logger import logger
from app.db.database import get_db
from app.db.mongo_ids import id_query, normalize_object_id


async def get_request_by_id(request_id: str, user_id) -> Optional[dict]:
    db = get_db()
    return await db.requests.find_one({
        **id_query("_id", request_id),
        **id_query("user_id", user_id),
    })


async def get_request_status_doc(request_id: str, user_id) -> Optional[dict]:
    db = get_db()
    return await db.requests.find_one(
        {
            **id_query("_id", request_id),
            **id_query("user_id", user_id),
        },
        {"status": 1, "queries": 1},
    )


async def list_user_requests(user_id) -> list[dict]:
    db = get_db()
    cursor = db.requests.find(id_query("user_id", user_id)).sort("updated_at", -1)
    return [doc async for doc in cursor]


async def get_user_request_stats(user_id) -> dict[str, int]:
    db = get_db()
    uid = normalize_object_id(user_id)
    pipeline = [
        {"$match": id_query("user_id", uid)},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    return {doc["_id"]: doc["count"] async for doc in db.requests.aggregate(pipeline)}


async def create_draft_request(doc: dict) -> str:
    db = get_db()
    result = await db.requests.insert_one(doc)
    logger.info("Created draft request %s", result.inserted_id)
    return str(result.inserted_id)


async def delete_request_by_id(request_id: str) -> bool:
    db = get_db()
    result = await db.requests.delete_one(id_query("_id", request_id))
    return result.deleted_count > 0


async def update_request_fields(request_id: str, update_fields: dict) -> Optional[dict]:
    db = get_db()
    await db.requests.update_one(id_query("_id", request_id), {"$set": update_fields})
    return await db.requests.find_one(id_query("_id", request_id))


# ── Functions moved from db/leads.py ─────────────────────────────────────────

async def update_request_status(request_id: str, status: str, time_taken: float | None = None) -> None:
    db = get_db()
    update_data = {"status": status, "updated_at": datetime.utcnow()}
    if time_taken is not None:
        update_data["time_taken"] = time_taken
    await db.requests.update_one(
        id_query("_id", request_id),
        {"$set": update_data},
    )
    logger.info("Request %s -> status=%s (time_taken=%s)", request_id, status, time_taken)


async def insert_complete_lead_request(request_data: dict, user_id: str) -> str:
    db = get_db()
    request_data["user_id"] = str(user_id)

    req_id = request_data.pop("id", None) or str(uuid.uuid4())
    request_data["_id"] = str(req_id)

    if "created_at" not in request_data:
        request_data["created_at"] = datetime.utcnow()
    if "status" not in request_data:
        request_data["status"] = "Pending"

    await db.requests.insert_one(request_data)
    logger.info("Inserted lead request %s for user %s", req_id, user_id)
    return str(req_id)


async def add_queries_to_lead_request(request_id: str, queries: list[str]) -> None:
    db = get_db()
    await db.requests.update_one(
        id_query("_id", request_id),
        {"$push": {"queries": {"$each": queries}}},
    )


async def delete_user_requests(user_id) -> None:
    db = get_db()
    await db.requests.delete_many(id_query("user_id", user_id))
