"""Saved searches + signals HTTP API."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.db.models import TABLES
from app.services.auth import get_current_user
from app.watch import searches, signals

router = APIRouter(prefix="/watch", tags=["watch"])
_searches = TABLES["saved_searches"]
_leads = TABLES["leads"]


def _uid(user: dict) -> str:
    return str(user["_id"])


class QueryIn(BaseModel):
    text: str = ""
    min_score: float = Field(0, ge=0, le=100)
    request_id: Optional[str] = None
    signal_kinds: list[str] = []
    signal_days: int = Field(14, ge=1, le=90)


class SearchIn(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    query: Optional[QueryIn] = None
    email_alerts: Optional[bool] = None
    slack_webhook_url: Optional[str] = None


def _dump(body: SearchIn) -> dict:
    return body.model_dump(exclude_unset=True)


@router.get("/searches")
async def list_searches(user: dict = Depends(get_current_user)):
    rows = await _searches.find(_searches.model.user_id == _uid(user), order_by=_searches.model.id)
    return {"searches": [searches.public(r) for r in rows]}


@router.post("/searches", status_code=201)
async def create_search(body: SearchIn, user: dict = Depends(get_current_user)):
    try:
        return await searches.save_search(_uid(user), _dump(body))
    except searches.SearchError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.put("/searches/{search_id}")
async def update_search(search_id: str, body: SearchIn, user: dict = Depends(get_current_user)):
    try:
        return await searches.save_search(_uid(user), _dump(body), search_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except searches.SearchError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.delete("/searches/{search_id}", status_code=204)
async def delete_search(search_id: str, user: dict = Depends(get_current_user)):
    if not await _searches.get(_id=search_id, user_id=_uid(user)):
        raise HTTPException(404, "search not found")
    await _searches.delete(search_id)
    return Response(status_code=204)


@router.post("/searches/{search_id}/run")
async def run_search(search_id: str, user: dict = Depends(get_current_user)):
    doc = await _searches.get(_id=search_id, user_id=_uid(user))
    if not doc:
        raise HTTPException(404, "search not found")
    return await searches.run_search(doc)


def _ser(ev: dict) -> dict:
    return {**ev, "detected_at": ev["detected_at"].isoformat() + "Z" if ev.get("detected_at") else None}


@router.get("/signals")
async def list_signals(domain: Optional[str] = None, kind: Optional[str] = None, days: int = Query(60, ge=1, le=365),
                       user: dict = Depends(get_current_user)):
    rows = await signals.recent_signals(_uid(user), domain, kind, days)
    return {"signals": [_ser(r) for r in rows]}


@router.get("/leads/{lead_id}/signals")
async def lead_signals(lead_id: str, user: dict = Depends(get_current_user)):
    lead = await _leads.get(_id=lead_id, user_id=_uid(user))
    if not lead:
        raise HTTPException(404, "lead not found")
    domain = signals.domain_of(lead.get("url") or "")
    rows = await signals.recent_signals(_uid(user), domain) if domain else []
    return {"domain": domain, "signals": [_ser(r) for r in rows]}


@router.post("/scan")
async def scan_now(user: dict = Depends(get_current_user)):
    return await signals.scan_user(_uid(user))
