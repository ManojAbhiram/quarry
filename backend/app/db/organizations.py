from datetime import datetime
from typing import Optional

from bson import ObjectId

from app.core.logger import logger
from app.db.database import get_db


async def create_organization(name: str, domain: str) -> dict:
    """Insert a new organization and return the inserted doc."""
    db = get_db()
    now = datetime.utcnow()
    doc = {
        "name": name,
        "domain": domain.lower().strip(),
        "created_at": now,
        "updated_at": now,
    }
    result = await db.organizations.insert_one(doc)
    doc["_id"] = result.inserted_id
    logger.info("Created organization %s (domain=%s)", result.inserted_id, domain)
    return doc


async def get_organization_by_id(org_id: str) -> Optional[dict]:
    db = get_db()
    try:
        oid = ObjectId(org_id)
    except Exception:
        return None
    return await db.organizations.find_one({"_id": oid})


async def get_organization_by_domain(domain: str) -> Optional[dict]:
    db = get_db()
    return await db.organizations.find_one({"domain": domain.lower().strip()})


async def update_organization(org_id: str, update_fields: dict) -> Optional[dict]:
    """Update organization fields and return the updated doc."""
    db = get_db()
    try:
        oid = ObjectId(org_id)
    except Exception:
        return None
    update_fields["updated_at"] = datetime.utcnow()
    await db.organizations.update_one({"_id": oid}, {"$set": update_fields})
    return await db.organizations.find_one({"_id": oid})
