from datetime import datetime
from typing import Optional
import uuid

from sqlalchemy import func, select

from app.core.logger import logger
from app.db import engine as _engine
from app.db.models import TABLES, Request

_reqs = TABLES["requests"]


async def get_request_by_id(request_id: str, user_id) -> Optional[dict]:
    return await _reqs.get(_id=str(request_id), user_id=str(user_id))


async def get_request_status_doc(request_id: str, user_id) -> Optional[dict]:
    doc = await get_request_by_id(request_id, user_id)
    if doc is None:
        return None
    out = {"_id": doc["_id"], "status": doc.get("status")}
    if "queries" in doc:
        out["queries"] = doc["queries"]
    return out


async def list_user_requests(user_id) -> list[dict]:
    return await _reqs.find(Request.user_id == str(user_id), order_by=Request.updated_at.desc())


async def get_user_request_stats(user_id) -> dict[str, int]:
    stmt = select(Request.status, func.count()).where(Request.user_id == str(user_id)).group_by(Request.status)
    async with _engine.read_session() as s, s.begin():
        return {status: count for status, count in (await s.execute(stmt)).all()}


async def create_draft_request(doc: dict) -> str:
    request_id = await _reqs.insert(doc)
    logger.info("Created draft request %s", request_id)
    return request_id


async def delete_request_by_id(request_id: str) -> bool:
    return await _reqs.delete(str(request_id))


async def update_request_fields(request_id: str, update_fields: dict) -> Optional[dict]:
    return await _reqs.update(str(request_id), update_fields)


async def replace_request(request_id: str, doc: dict) -> Optional[dict]:
    """Overwrite a request document entirely (used when a draft is promoted to a full request)."""
    return await _reqs.replace(str(request_id), doc)


# ── Functions moved from db/leads.py ─────────────────────────────────────────

async def update_request_status(
    request_id: str, status: str, time_taken: float | None = None, failure_reason: str | None = None
) -> None:
    # failure_reason is only meaningful for Failed; any other status clears a previous one
    update_data = {
        "status": status,
        "updated_at": datetime.utcnow(),
        "failure_reason": failure_reason if status == "Failed" else None,
    }
    if time_taken is not None:
        update_data["time_taken"] = time_taken
    await _reqs.update(str(request_id), update_data)
    logger.info("Request %s -> status=%s (time_taken=%s)", request_id, status, time_taken)


async def insert_complete_lead_request(request_data: dict, user_id: str) -> str:
    request_data["user_id"] = str(user_id)

    req_id = request_data.pop("id", None) or str(uuid.uuid4())
    request_data["_id"] = str(req_id)

    if "created_at" not in request_data:
        request_data["created_at"] = datetime.utcnow()
    if "status" not in request_data:
        request_data["status"] = "Pending"

    await _reqs.insert(request_data)
    logger.info("Inserted lead request %s for user %s", req_id, user_id)
    return str(req_id)


async def add_queries_to_lead_request(request_id: str, queries: list[str]) -> None:
    await _reqs.modify(str(request_id), lambda doc: {"queries": [*(doc.get("queries") or []), *queries]})


async def delete_user_requests(user_id) -> None:
    await _reqs.delete_where(Request.user_id == str(user_id))


async def request_exists(request_id: str) -> bool:
    return await _reqs.get(_id=str(request_id)) is not None


async def fail_orphaned_requests() -> int:
    """Mark requests still 'Pending' as Failed. Run at startup: pipelines live in this process, so after a restart
    nothing is running and every Pending request is an orphan. Returns how many were failed."""
    orphans = await _reqs.find(Request.status == "Pending")
    for doc in orphans:
        await _reqs.update(doc["_id"], {
            "status": "Failed",
            "failure_reason": "Interrupted by a server restart. Please run it again.",
            "updated_at": datetime.utcnow(),
        })
    return len(orphans)
