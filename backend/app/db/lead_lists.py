"""
Lead Lists DB layer
====================
MongoDB CRUD operations for the `lead_lists` collection.

Schema
------
{
    _id:        str (UUID),
    user_id:    str,
    name:       str,
    color:      str,  # hex color for UI badge
    description: str | None,
    lead_ids:   [str],   # list of lead _id values
    created_at: datetime,
    updated_at: datetime,
}
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from app.core.logger import logger
from app.db.database import get_db


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------

async def create_lead_list(user_id: str, name: str, color: str = "#6366f1", description: Optional[str] = None) -> dict:
    db = get_db()
    now = datetime.utcnow()
    doc = {
        "_id": str(uuid.uuid4()),
        "user_id": user_id,
        "name": name,
        "color": color,
        "description": description,
        "lead_ids": [],
        "created_at": now,
        "updated_at": now,
    }
    await db.lead_lists.insert_one(doc)
    logger.info("Created lead list '%s' for user %s", name, user_id)
    return doc


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

async def get_lead_lists_for_user(user_id: str) -> list[dict]:
    db = get_db()
    cursor = db.lead_lists.find({"user_id": user_id}).sort("created_at", -1)
    return await cursor.to_list(length=None)


async def get_lead_list_by_id(list_id: str, user_id: str) -> Optional[dict]:
    db = get_db()
    return await db.lead_lists.find_one({"_id": list_id, "user_id": user_id})


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------

async def update_lead_list(list_id: str, user_id: str, updates: dict) -> Optional[dict]:
    db = get_db()
    updates["updated_at"] = datetime.utcnow()
    result = await db.lead_lists.update_one(
        {"_id": list_id, "user_id": user_id},
        {"$set": updates},
    )
    if result.matched_count == 0:
        return None
    return await get_lead_list_by_id(list_id, user_id)


async def add_leads_to_list(list_id: str, user_id: str, lead_ids: list[str]) -> Optional[dict]:
    db = get_db()
    result = await db.lead_lists.update_one(
        {"_id": list_id, "user_id": user_id},
        {
            "$addToSet": {"lead_ids": {"$each": lead_ids}},
            "$set": {"updated_at": datetime.utcnow()},
        },
    )
    if result.matched_count == 0:
        return None
    return await get_lead_list_by_id(list_id, user_id)


async def remove_leads_from_list(list_id: str, user_id: str, lead_ids: list[str]) -> Optional[dict]:
    db = get_db()
    result = await db.lead_lists.update_one(
        {"_id": list_id, "user_id": user_id},
        {
            "$pullAll": {"lead_ids": lead_ids},
            "$set": {"updated_at": datetime.utcnow()},
        },
    )
    if result.matched_count == 0:
        return None
    return await get_lead_list_by_id(list_id, user_id)


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------

async def delete_lead_list(list_id: str, user_id: str) -> bool:
    db = get_db()
    result = await db.lead_lists.delete_one({"_id": list_id, "user_id": user_id})
    return result.deleted_count > 0


# ---------------------------------------------------------------------------
# Helper: lists that contain a given lead
# ---------------------------------------------------------------------------

async def get_lists_for_lead(lead_id: str, user_id: str) -> list[dict]:
    db = get_db()
    cursor = db.lead_lists.find({"user_id": user_id, "lead_ids": lead_id})
    return await cursor.to_list(length=None)
