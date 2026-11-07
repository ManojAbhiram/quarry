from datetime import datetime
from typing import Optional
import uuid
from urllib.parse import urlparse

from app.core.logger import logger
from app.core.utils import extract_canonical_domain
from app.db.database import get_db



async def upsert_company(company_data: dict) -> Optional[str]:
    """
    Upsert a company record by canonical_domain.
    Returns the _id of the upserted company, or None if no domain can be derived.
    """
    db = get_db()

    # Derive canonical_domain from website / source_url
    website = (
        company_data.get("website")
        or company_data.get("source_url")
        or company_data.get("linkedin_url")
        or ""
    )
    canonical_domain = extract_canonical_domain(website)
    if not canonical_domain:
        logger.warning("Cannot upsert company — no domain derivable from data: %s", company_data.get("company_name"))
        return None

    now = datetime.utcnow()

    update_doc = {
        "canonical_domain": canonical_domain,
        "company_name": company_data.get("company_name") or "",
        "industry": company_data.get("industry"),
        "headquarters": company_data.get("location") or company_data.get("headquarters"),
        "employee_size_estimate": company_data.get("employee_size_estimate"),
        "funding_stage": company_data.get("funding_stage"),
        "growth": company_data.get("growth"),
        "founded_year": company_data.get("founded_year"),
        "linkedin_url": company_data.get("linkedin_url"),
        "x_url": company_data.get("x_url"),
        "facebook_url": company_data.get("facebook_url"),
        "tech_stack": company_data.get("tech_stack") or [],
        "infrastructure": company_data.get("infrastructure") or {},
        "g2_rating": company_data.get("g2_rating"),
        "capterra_rating": company_data.get("capterra_rating"),
        "enriched_at": now,
    }

    # Optional unique IDs
    if company_data.get("crunchbase_id"):
        update_doc["crunchbase_id"] = company_data["crunchbase_id"]
    if company_data.get("linkedin_id"):
        update_doc["linkedin_id"] = company_data["linkedin_id"]

    existing = await db.companies.find_one({"canonical_domain": canonical_domain})
    if existing:
        company_id = str(existing["_id"])
        await db.companies.update_one(
            {"_id": existing["_id"]},
            {"$set": update_doc},
        )
        logger.info("Updated company for domain %s (id=%s)", canonical_domain, company_id)
        return company_id
    else:
        company_id = str(uuid.uuid4())
        update_doc["_id"] = company_id
        update_doc["created_at"] = now
        await db.companies.insert_one(update_doc)
        logger.info("Inserted company for domain %s (id=%s)", canonical_domain, company_id)
        return company_id


async def get_company_by_domain(domain: str) -> Optional[dict]:
    db = get_db()
    canonical = extract_canonical_domain(domain)
    return await db.companies.find_one({"canonical_domain": canonical})


async def get_company_by_id(company_id: str) -> Optional[dict]:
    db = get_db()
    return await db.companies.find_one({"_id": company_id})
