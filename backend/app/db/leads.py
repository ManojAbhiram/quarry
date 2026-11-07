from datetime import datetime
from typing import List
import uuid

from app.core.logger import logger
from app.db.database import get_db
from app.db.mongo_ids import id_query
from app.db.companies import upsert_company
from app.db.lead_enrichments import upsert_lead_enrichment
from app.db.decision_makers import insert_decision_maker_if_new
from app.schemas.leads import Lead


async def process_and_save_standalone_leads(
    serper_data: List[dict],
    request_id: str,
    user_id: str,
) -> List[Lead]:
    logger.info("Saving %d basic standalone leads for request %s", len(serper_data), request_id)
    leads: List[Lead] = []

    for item in serper_data:
        lead = Lead(
            user_id=user_id,
            title=item.get("title", ""),
            url=item.get("url", item.get("link", "")),
            snippet=item.get("snippet", ""),
            type="standalone",
            email="",
            phone="",
            description="",
            match_score="0",
        )
        leads.append(lead)

    if leads:
        await save_leads_to_db(request_id, leads)
    return leads


async def save_leads_to_db(request_id: str, leads: List[Lead]) -> None:
    if not leads:
        return
    db = get_db()
    now = datetime.utcnow()
    saved = 0
    try:
        for lead in leads:
            d = lead.model_dump(by_alias=True, exclude_none=True)
            url = d.get("url") or ""
            existing = await db.leads.find_one({"request_id": request_id, "url": url})
            if existing:
                continue
            doc = {
                "_id": str(uuid.uuid4()),
                "request_id": request_id,
                "user_id": d.get("user_id", ""),
                "title": d.get("title", ""),
                "url": url,
                "email": d.get("email") or None,
                "phone": d.get("phone") or None,
                "snippet": d.get("snippet") or None,
                "match_score": 0.0,
                "lead_type": "standalone",
                "enrichment_status": "pending",
                "created_at": now,
                "updated_at": now,
            }
            await db.leads.insert_one(doc)
            saved += 1
        logger.info("Saved %d standalone leads to leads collection for request %s", saved, request_id)
    except Exception as e:
        logger.error("Failed to save leads to database: %s", e)
        raise


async def save_enriched_leads_to_db(
    request_id: str,
    user_id: str,
    enriched: List[dict],
) -> None:
    if not enriched:
        return
    db = get_db()
    now = datetime.utcnow()

    for item in enriched:
        lead_url = item.get("source_url") or item.get("website") or item.get("url") or ""

        lead_id: str | None = None
        try:
            match_score_raw = item.get("match_score", 0)
            try:
                match_score_float = float(str(match_score_raw).split("/")[0])
            except (ValueError, TypeError):
                match_score_float = 0.0

            lead_doc = {
                "request_id": request_id,
                "user_id": user_id,
                "title": item.get("company_name") or item.get("title") or "",
                "url": lead_url,
                "email": item.get("contact_email") or None,
                "phone": item.get("contact_phone") or None,
                "match_score": match_score_float,
                "lead_type": "enriched",
                "enrichment_status": "enriched",
                "snippet": item.get("buying_signals") or item.get("description") or None,
                "email_verified": item.get("email_verified"),
                "email_confidence": item.get("email_confidence"),
                "email_verify_method": item.get("email_verify_method"),
                "email_verify_reason": item.get("email_verify_reason"),
                "updated_at": now,
            }
            existing_lead = await db.leads.find_one({"request_id": request_id, "url": lead_url})
            if existing_lead:
                lead_id = str(existing_lead["_id"])
                await db.leads.update_one({"_id": existing_lead["_id"]}, {"$set": lead_doc})
            else:
                lead_id = str(uuid.uuid4())
                lead_doc["_id"] = lead_id
                lead_doc["created_at"] = now
                await db.leads.insert_one(lead_doc)
        except Exception as exc:
            logger.warning("Failed to upsert lead (url=%s) to leads collection: %s", lead_url, exc)

        company_id: str | None = None
        try:
            # Deduplication check: look up companies collection by canonical domain first.
            # upsert_company handles this internally (find-then-update-or-insert),
            # ensuring exactly one company record per canonical domain across all requests.
            company_id = await upsert_company(item)
            if company_id:
                logger.info("Company dedup check: domain resolved to company_id=%s for url=%s", company_id, lead_url)
        except Exception as exc:
            logger.warning("Failed to upsert company for lead url=%s: %s", lead_url, exc)

        if lead_id:
            try:
                await upsert_lead_enrichment(lead_id, company_id, item)
            except Exception as exc:
                logger.warning("Failed to upsert lead_enrichment for lead %s: %s", lead_id, exc)

            for dm in item.get("decision_makers") or []:
                try:
                    await insert_decision_maker_if_new(lead_id, dm)
                except Exception as exc:
                    logger.warning("Failed to insert decision_maker for lead %s: %s", lead_id, exc)

    logger.info("Saved %d enriched leads for request %s", len(enriched), request_id)


async def get_normalized_leads_for_request(request_id: str) -> list[dict]:
    """
    Fetch normalized leads joined with enrichment, company, and decision-maker data.
    Returns an empty list if no normalized leads exist (caller should fall back to embedded).
    """
    from app.db.lead_enrichments import get_enrichment_for_lead
    from app.db.decision_makers import get_decision_makers_for_lead

    db = get_db()
    raw_leads = await db.leads.find(
        {"request_id": request_id, "enrichment_status": "enriched"}
    ).sort("match_score", -1).to_list(length=None)

    if not raw_leads:
        return []

    combined = []
    for nl in raw_leads:
        lead_id = str(nl.get("_id", ""))
        enrichment = await get_enrichment_for_lead(lead_id) if lead_id else None
        company_doc: dict = {}
        if enrichment and enrichment.get("company_id"):
            company_doc = await db.companies.find_one({"_id": enrichment["company_id"]}) or {}

        dms = []
        if lead_id:
            raw_dms = await get_decision_makers_for_lead(lead_id)
            dms = [
                {
                    "name": d.get("name"),
                    "title": d.get("title"),
                    "linkedin_url": d.get("linkedin_url"),
                    "email": d.get("email"),
                    "snippet": d.get("snippet"),
                    "recent_activity_summary": d.get("recent_activity_summary"),
                    "recent_posts": d.get("recent_posts") or [],
                }
                for d in raw_dms
            ]

        combined.append({
            "id": lead_id,
            "_id": lead_id,
            "user_id": nl.get("user_id"),
            "title": nl.get("title"),
            "url": nl.get("url"),
            "email": nl.get("email"),
            "phone": nl.get("phone"),
            "email_verified": nl.get("email_verified"),
            "email_confidence": nl.get("email_confidence"),
            "match_score": str(nl.get("match_score", "0")),
            "snippet": nl.get("snippet"),
            "type": nl.get("lead_type", "enriched"),
            "company_name": company_doc.get("company_name") or nl.get("title"),
            "industry": company_doc.get("industry"),
            "location": company_doc.get("headquarters"),
            "employee_size_estimate": company_doc.get("employee_size_estimate"),
            "funding_stage": company_doc.get("funding_stage"),
            "founded_year": company_doc.get("founded_year"),
            "linkedin_url": company_doc.get("linkedin_url"),
            "x_url": company_doc.get("x_url"),
            "facebook_url": company_doc.get("facebook_url"),
            "growth": company_doc.get("growth"),
            "tech_stack": company_doc.get("tech_stack") or [],
            "infrastructure": company_doc.get("infrastructure") or {},
            "contact_name": enrichment.get("contact_name") if enrichment else None,
            "contact_title": enrichment.get("contact_title") if enrichment else None,
            "buying_signals": enrichment.get("buying_signals") if enrichment else None,
            "match_explanation": enrichment.get("match_explanation") if enrichment else None,
            "signals": enrichment.get("signals") if enrichment else [],
            "decision_makers": dms,
            "intent_score": nl.get("intent_score"),
            "intent_band": nl.get("intent_band"),
            "band_emoji": nl.get("band_emoji"),
            "band_action": nl.get("band_action"),
            "intent_signals": nl.get("intent_signals") or [],
            "intent_summary": nl.get("intent_summary"),
            "score_breakdown": nl.get("score_breakdown") or {},
            "pillar_details": nl.get("pillar_details") or {},
            "total_signals": nl.get("total_signals", 0),
            "intent_score_updated_at": nl.get("intent_score_updated_at"),
            "signal_timeline": nl.get("signal_timeline") or [],
            "serper_queries_used": nl.get("serper_queries_used", 0),
        })

    return combined
