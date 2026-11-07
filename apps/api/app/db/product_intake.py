from datetime import datetime
from typing import Optional

from app.core.logger import logger
from app.db.models import TABLES, ProductIntake

_intake = TABLES["product_intake"]


async def upsert_product_intake(request_id: str, intake_data: dict) -> str:
    """
    Upsert a product_intake document keyed by request_id.
    Returns the _id of the doc.
    """
    now = datetime.utcnow()
    doc = {k: v for k, v in intake_data.items() if k not in ("_id", "request_id")}
    doc["request_id"] = request_id
    doc["updated_at"] = now

    existing = await _intake.get(request_id=request_id)
    if existing:
        await _intake.update(existing["_id"], doc)
        logger.info("Updated product_intake for request %s", request_id)
        return existing["_id"]
    doc_id = await _intake.insert({**doc, "created_at": now})
    logger.info("Inserted product_intake for request %s (id=%s)", request_id, doc_id)
    return doc_id


async def get_product_intake(request_id: str) -> Optional[dict]:
    return await _intake.get(request_id=request_id)


async def get_product_intakes_by_request_ids(request_ids: list[str]) -> dict[str, dict]:
    """Batch fetch: {request_id: intake_doc} for the ids that have one."""
    rows = await _intake.find(ProductIntake.request_id.in_(request_ids))
    return {r["request_id"]: r for r in rows}
