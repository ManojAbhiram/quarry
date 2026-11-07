from datetime import datetime
from typing import Optional

from app.core.logger import logger
from app.db.models import TABLES

_orgs = TABLES["organizations"]


async def create_organization(name: str, domain: str) -> dict:
    """Insert a new organization and return the inserted doc."""
    now = datetime.utcnow()
    doc = {
        "name": name,
        "domain": domain.lower().strip(),
        "created_at": now,
        "updated_at": now,
    }
    doc["_id"] = await _orgs.insert(doc)
    logger.info("Created organization %s (domain=%s)", doc["_id"], domain)
    return doc


async def get_organization_by_id(org_id: str) -> Optional[dict]:
    return await _orgs.get(_id=str(org_id))


async def get_organization_by_domain(domain: str) -> Optional[dict]:
    return await _orgs.get(domain=domain.lower().strip())


async def update_organization(org_id: str, update_fields: dict) -> Optional[dict]:
    """Update organization fields and return the updated doc."""
    return await _orgs.update(str(org_id), {**update_fields, "updated_at": datetime.utcnow()})
