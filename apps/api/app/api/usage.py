"""Cost controls: launch estimate, sample run and the user's usage against quota.

GET  /usage/summary     this month's runs, calls, estimated cost and quota left
POST /usage/estimate    estimate calls and cost of a run from the number of leads wanted and the ICP
POST /usage/sample-run  run the first search only and return a few candidates, before committing to the full run
"""
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import usage
from app.db.models import TABLES
from app.db.models_trust import UsageEvent
from app.db.users import get_user_serper_key
from app.schemas.request_intake import RequestIntakeCreate
from app.services import llm, serper
from app.services.auth import get_current_user

router = APIRouter(prefix="/usage", tags=["usage"])

SAMPLE_SIZE = 5
SAMPLES_PER_DAY = 10
SERPER_KEY_REQUIRED_MSG = "Add your Serper API key in Profile to run a sample."


@router.get("/summary")
async def summary(current_user: dict = Depends(get_current_user)):
    return await usage.get_summary(str(current_user["_id"]), current_user)


class EstimateIn(BaseModel):
    num_leads: int = Field(default=10, ge=1, le=200)
    icp_dimensions: Optional[dict[str, Any]] = None


@router.post("/estimate")
async def estimate(body: EstimateIn, current_user: dict = Depends(get_current_user)):
    est = usage.estimate_run(body.num_leads, body.icp_dimensions)
    s = await usage.get_summary(str(current_user["_id"]), current_user)
    est["quota"] = s["quota"]
    est["month_cost_usd"] = s["cost_usd"]
    est["fits_quota"] = s["quota"]["runs_left"] > 0 and s["cost_usd"] + est["cost_usd"]["typical"] <= s["quota"]["cost_usd"]
    return est


@router.post("/sample-run")
async def sample_run(body: RequestIntakeCreate, current_user: dict = Depends(get_current_user)):
    from app.services.request_intake_service import _build_ideal_lead_profile

    user_id = str(current_user["_id"])
    key = await get_user_serper_key(user_id)
    if not key:
        raise HTTPException(status_code=400, detail=SERPER_KEY_REQUIRED_MSG)

    since = datetime.utcnow() - timedelta(days=1)
    today = await TABLES["usage_events"].find(UsageEvent.user_id == user_id, UsageEvent.kind == "sample", UsageEvent.created_at >= since)
    if len(today) >= SAMPLES_PER_DAY:
        raise HTTPException(status_code=429, detail="Sample limit reached for today. Launch the full run or try again tomorrow.")

    payload = {
        "title": f"{body.product_intake.product_name} Lead Request",
        "business_type": body.product_intake.product_category,
        "target_location": body.product_intake.target_geographies,
        "ideal_lead_profile": _build_ideal_lead_profile(body.product_intake, body.icp_dimensions),
        "product_description": body.product_intake.product_description,
    }
    serper_calls = llm_calls = 0
    token = serper.current_serper_key.set(key)
    try:
        queries = await llm.generate_sales_queries(payload)
        llm_calls += 1
        if not queries:
            raise HTTPException(status_code=422, detail="Could not generate search queries from this ICP. Add more detail and try again.")
        try:
            data = await serper.fetch_leads_from_serper(queries[0])
            serper_calls += 1
        except Exception:
            raise HTTPException(status_code=502, detail="The search failed. Check your Serper key and try again.") from None
    finally:
        serper.current_serper_key.reset(token)
        await usage.record_sample(user_id, serper_calls, llm_calls)

    samples = [
        {"title": i.get("title", ""), "url": i.get("link", ""), "snippet": i.get("snippet", "")}
        for i in (data.get("organic") or [])
        if i.get("link")
    ][:SAMPLE_SIZE]
    full = usage.estimate_run(body.num_leads or 10, body.icp_dimensions.model_dump())
    return {
        "query": queries[0],
        "queries_planned": len(queries),
        "samples": samples,
        "sample_cost_usd": usage.cost_of(serper_calls, llm_calls),
        "full_run": full,
    }
