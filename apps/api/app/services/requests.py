from datetime import datetime

from fastapi import HTTPException

from app.db import erasure, requests as db
from app.db.decision_makers import count_decision_makers_by_lead
from app.db.leads import count_enriched_leads_by_request
from app.db.product_intake import get_product_intakes_by_request_ids, upsert_product_intake
from app.db.icp_profiles import get_icp_profiles_by_request_ids, upsert_icp_profile
from app.schemas.requests import LeadRequestOut, StatsOut, request_to_out


async def create_request(user_id, org_id, body) -> dict:
    uid = str(user_id)
    doc = {
        "title": body.name,
        "description": body.description,
        "primary_goal": body.primary_goal,
        "target_team_size": body.target_team_size,
        "business_type": "",
        "target_location": "",
        "request_type": getattr(body, "request_type", None) or "icp",
        "status": "Draft",
        "user_id": uid,
        "org_id": org_id,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    inserted_id = await db.create_draft_request(doc)
    return {"id": inserted_id, "status": "Draft"}


async def _fetch_enrich_map(request_ids: list[str]) -> dict[str, dict]:
    """Batch-fetch product_intake, icp_profiles, and leads counts for a list of request IDs."""
    intake_map: dict = {}
    icp_map: dict = {}
    counts_map: dict = {}

    if not request_ids:
        return {}

    for rid, pi in (await get_product_intakes_by_request_ids(request_ids)).items():
        intake_map[rid] = {k: v for k, v in pi.items() if k not in ("_id", "request_id", "created_at", "updated_at")}

    for rid, icp in (await get_icp_profiles_by_request_ids(request_ids)).items():
        icp_map[rid] = {k: v for k, v in icp.items() if k not in ("_id", "request_id", "generated_at", "created_at", "updated_at", "queries")}

    counts_map = await count_enriched_leads_by_request(request_ids)

    all_lead_ids = []
    for agg in counts_map.values():
        all_lead_ids.extend(agg.get("lead_ids", []))

    if all_lead_ids:
        dm_counts = await count_decision_makers_by_lead(all_lead_ids)

        for agg in counts_map.values():
            req_dm_count = agg.get("legacy_dm_count", 0)
            for lid in agg.get("lead_ids", []):
                req_dm_count += dm_counts.get(lid, 0)
            agg["decision_makers_count"] = req_dm_count

    result = {}
    for rid in request_ids:
        result[rid] = {
            "product_intake": intake_map.get(rid, {}),
            "icp_dimensions": icp_map.get(rid, {}),
            "leads_agg": counts_map.get(rid, {}),
        }
    return result


async def list_requests(user_id) -> list[LeadRequestOut]:
    docs = await db.list_user_requests(user_id)
    if not docs:
        return []
    request_ids = [str(doc["_id"]) for doc in docs]
    enrich_map = await _fetch_enrich_map(request_ids)
    return [request_to_out(doc, enrich_map.get(str(doc["_id"]), {})) for doc in docs]


async def get_request_stats(user_id) -> StatsOut:
    counts = await db.get_user_request_stats(user_id)
    return StatsOut(
        total_leads=sum(counts.values()),
        pending=counts.get("Pending", 0),
        active=counts.get("Pending", 0),
        completed=counts.get("Completed", 0),
        failed=counts.get("Failed", 0),
        draft=counts.get("Draft", 0),
    )


async def delete_request(request_id: str, user_id) -> None:
    doc = await db.get_request_by_id(request_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Lead request not found")
    deleted = await erasure.erase_request(request_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete lead request")


async def update_request(request_id: str, user_id, body) -> LeadRequestOut:
    doc = await db.get_request_by_id(request_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Lead request not found")

    update_fields = {"updated_at": datetime.utcnow()}
    if body.product_intake is not None:
        if "product_name" in body.product_intake and body.product_intake["product_name"]:
            update_fields["title"] = f"{body.product_intake['product_name']} Lead Request"
        await upsert_product_intake(request_id, body.product_intake)
    if body.icp_dimensions is not None:
        await upsert_icp_profile(request_id, body.icp_dimensions)
    # `status` is set by the pipeline only; a client-supplied value is ignored on purpose
    if body.title is not None:
        update_fields["title"] = body.title
    if body.description is not None:
        update_fields["description"] = body.description

    updated_doc = await db.update_request_fields(request_id, update_fields)
    enrich_map = await _fetch_enrich_map([request_id])
    return request_to_out(updated_doc, enrich_map.get(request_id, {}))


async def update_request_lists(request_id: str, user_id, body) -> LeadRequestOut:
    doc = await db.get_request_by_id(request_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Lead request not found")

    update_fields = {"updated_at": datetime.utcnow()}
    if body.saved_companies is not None:
        update_fields["saved_companies"] = body.saved_companies
    if body.excluded_companies is not None:
        update_fields["excluded_companies"] = body.excluded_companies
    if body.manual_adds is not None:
        update_fields["manual_adds"] = body.manual_adds

    updated_doc = await db.update_request_fields(request_id, update_fields)
    enrich_map = await _fetch_enrich_map([request_id])
    return request_to_out(updated_doc, enrich_map.get(request_id, {}))
