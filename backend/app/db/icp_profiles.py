from datetime import datetime
from typing import Optional

from app.core.logger import logger
from app.db.models import TABLES, IcpProfile

_icp = TABLES["icp_profiles"]


async def upsert_icp_profile(request_id: str, icp_data: dict, queries: Optional[list] = None) -> str:
    """
    Upsert an icp_profiles document keyed by request_id.
    icp_data should contain the 6 ICP dimension dicts (firmographic, technographic, etc.).
    Returns the _id of the doc.
    """
    now = datetime.utcnow()
    doc = {k: v for k, v in icp_data.items() if k not in ("_id", "request_id")}
    doc["request_id"] = request_id
    doc["updated_at"] = now
    if queries is not None:
        doc["queries"] = queries

    existing = await _icp.get(request_id=request_id)
    if existing:
        await _icp.update(existing["_id"], doc)
        logger.info("Updated icp_profile for request %s", request_id)
        return existing["_id"]
    doc_id = await _icp.insert({**doc, "generated_at": now})
    logger.info("Inserted icp_profile for request %s (id=%s)", request_id, doc_id)
    return doc_id


async def get_icp_profile(request_id: str) -> Optional[dict]:
    return await _icp.get(request_id=request_id)


async def get_icp_profiles_by_request_ids(request_ids: list[str]) -> dict[str, dict]:
    """Batch fetch: {request_id: icp_doc} for the ids that have one."""
    rows = await _icp.find(IcpProfile.request_id.in_(request_ids))
    return {r["request_id"]: r for r in rows}
