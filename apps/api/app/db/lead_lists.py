"""
Lead Lists DB layer
====================
CRUD for the `lead_lists` table plus its membership table `lead_list_items`.

Documents returned by this module look like:
{
    _id:         str (UUID),
    user_id:     str,
    name:        str,
    color:       str,  # hex color for UI badge
    description: str | None,
    lead_ids:    [str],   # lead ids in the order they were added (read from lead_list_items)
    created_at:  datetime,
    updated_at:  datetime,
}
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.core.logger import logger
from app.db import engine as _engine
from app.db.models import TABLES, LeadList, LeadListItem

_lists = TABLES["lead_lists"]


async def _attach_lead_ids(docs: list[dict]) -> list[dict]:
    """Fill each list document's `lead_ids` from the membership table (insertion order)."""
    for d in docs:
        d["lead_ids"] = []
    if not docs:
        return docs
    by_list = {d["_id"]: d for d in docs}
    stmt = (
        select(LeadListItem.list_id, LeadListItem.lead_id)
        .where(LeadListItem.list_id.in_(list(by_list)))
        .order_by(LeadListItem.added_at, LeadListItem.lead_id)
    )
    async with _engine.read_session() as s, s.begin():
        for list_id, lead_id in (await s.execute(stmt)).all():
            by_list[list_id]["lead_ids"].append(lead_id)
    return docs


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def create_lead_list(user_id: str, name: str, color: str = "#6366f1", description: Optional[str] = None) -> dict:
    now = datetime.utcnow()
    doc = {
        "user_id": user_id,
        "name": name,
        "color": color,
        "description": description,
        "created_at": now,
        "updated_at": now,
    }
    doc["_id"] = await _lists.insert(doc)
    doc["lead_ids"] = []
    logger.info("Created lead list '%s' for user %s", name, user_id)
    return doc


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

async def get_lead_lists_for_user(user_id: str) -> list[dict]:
    docs = await _lists.find(LeadList.user_id == user_id, order_by=LeadList.created_at.desc())
    return await _attach_lead_ids(docs)


async def get_lead_list_by_id(list_id: str, user_id: str) -> Optional[dict]:
    doc = await _lists.get(_id=list_id, user_id=user_id)
    if doc is None:
        return None
    return (await _attach_lead_ids([doc]))[0]


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

async def update_lead_list(list_id: str, user_id: str, updates: dict) -> Optional[dict]:
    if await _lists.get(_id=list_id, user_id=user_id) is None:
        return None
    fields = {k: v for k, v in updates.items() if k not in ("lead_ids", "_id", "user_id")}
    fields["updated_at"] = datetime.utcnow()
    await _lists.update(list_id, fields)
    return await get_lead_list_by_id(list_id, user_id)


async def add_leads_to_list(list_id: str, user_id: str, lead_ids: list[str]) -> Optional[dict]:
    if await _lists.get(_id=list_id, user_id=user_id) is None:
        return None
    now = datetime.utcnow()
    try:
        async with _engine.session() as s, s.begin():
            existing = set(
                (await s.execute(select(LeadListItem.lead_id).where(LeadListItem.list_id == list_id))).scalars().all()
            )
            new_ids = [lid for lid in dict.fromkeys(lead_ids) if lid not in existing]
            # +i microseconds keeps the order of this batch stable when sorting by added_at
            s.add_all(
                LeadListItem(list_id=list_id, lead_id=lid, added_at=now + timedelta(microseconds=i))
                for i, lid in enumerate(new_ids)
            )
    except IntegrityError:  # the list was deleted between the ownership check and the insert
        return None
    await _lists.update(list_id, {"updated_at": now})
    return await get_lead_list_by_id(list_id, user_id)


async def remove_leads_from_list(list_id: str, user_id: str, lead_ids: list[str]) -> Optional[dict]:
    if await _lists.get(_id=list_id, user_id=user_id) is None:
        return None
    async with _engine.session() as s, s.begin():
        await s.execute(
            delete(LeadListItem).where(LeadListItem.list_id == list_id, LeadListItem.lead_id.in_(lead_ids))
        )
    await _lists.update(list_id, {"updated_at": datetime.utcnow()})
    return await get_lead_list_by_id(list_id, user_id)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

async def delete_lead_list(list_id: str, user_id: str) -> bool:
    if await _lists.get(_id=list_id, user_id=user_id) is None:
        return False
    return await _lists.delete(list_id)  # membership rows go with it (ON DELETE CASCADE)


# ---------------------------------------------------------------------------
# Helper: lists that contain a given lead
# ---------------------------------------------------------------------------

async def get_lists_for_lead(lead_id: str, user_id: str) -> list[dict]:
    stmt = select(LeadListItem.list_id).where(LeadListItem.lead_id == lead_id)
    async with _engine.read_session() as s, s.begin():
        list_ids = (await s.execute(stmt)).scalars().all()
    if not list_ids:
        return []
    docs = await _lists.find(LeadList.id.in_(list_ids), LeadList.user_id == user_id)
    return await _attach_lead_ids(docs)
