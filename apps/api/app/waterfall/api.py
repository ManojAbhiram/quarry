"""Enrichment HTTP API: credits, BYO provider keys, per-lead waterfall, optional Claude batch scoring."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.db.models import TABLES
from app.p3.config import p3_settings
from app.services.auth import get_current_user
from app.waterfall import claude_scoring, service
from app.waterfall.providers import PROVIDER_ORDER

router = APIRouter(prefix="/enrichment", tags=["enrichment"])
_leads = TABLES["leads"]
_requests = TABLES["requests"]


def _uid(user: dict) -> str:
    return str(user["_id"])


@router.get("/credits")
async def credits(user: dict = Depends(get_current_user)):
    uid = _uid(user)
    return {"balance": await service.balance(uid), "history": await service.history(uid),
            "order": list(PROVIDER_ORDER), "providers": await service.list_keys(uid),
            "claude_batch_scoring": p3_settings.claude_batch_scoring}


class KeyIn(BaseModel):
    key: str = Field(..., min_length=4, max_length=300)


@router.put("/keys/{provider}")
async def set_key(provider: str, body: KeyIn, user: dict = Depends(get_current_user)):
    try:
        return await service.set_key(_uid(user), provider, body.key)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/keys/{provider}", status_code=204)
async def delete_key(provider: str, user: dict = Depends(get_current_user)):
    if not await service.delete_key(_uid(user), provider):
        raise HTTPException(404, "No key stored for that provider")
    return Response(status_code=204)


@router.post("/leads/{lead_id}/waterfall")
async def waterfall_lead(lead_id: str, user: dict = Depends(get_current_user)):
    try:
        return await service.enrich_lead(_uid(user), lead_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


class ScoreIn(BaseModel):
    request_id: str
    icp: str = Field("", max_length=4000)


@router.post("/scoring/batch")
async def scoring_submit(body: ScoreIn, user: dict = Depends(get_current_user)):
    uid = _uid(user)
    if not await _requests.get(_id=body.request_id, user_id=uid):
        raise HTTPException(404, "Request not found")
    leads = await _leads.find(_leads.model.request_id == body.request_id, _leads.model.user_id == uid, limit=500)
    try:
        return {"batch_id": await claude_scoring.submit(leads, body.icp), "leads": len(leads)}
    except claude_scoring.Disabled as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/scoring/batch/{batch_id}")
async def scoring_collect(batch_id: str, apply: Optional[bool] = False, user: dict = Depends(get_current_user)):
    try:
        res = await claude_scoring.collect(batch_id)
    except claude_scoring.Disabled as exc:
        raise HTTPException(409, str(exc)) from exc
    if apply and res["status"] == "ended":
        for lead_id, s in res["scores"].items():
            if await _leads.get(_id=lead_id, user_id=_uid(user)):
                await _leads.update(lead_id, {"match_score": float(s["score"]), "score_reason": s["reason"]})
    return res
