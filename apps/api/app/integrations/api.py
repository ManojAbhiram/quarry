"""Integrations HTTP API: API keys, webhooks, CSV/webhook export (session auth) and the public read API (key auth)."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.db import lead_lists as db_lists
from app.db.models import TABLES
from app.integrations import apikeys, webhooks
from app.integrations.apikeys import require_scope
from app.services.auth import get_current_user
from app.services.export_service import generate_csv

router = APIRouter(prefix="/integrations", tags=["integrations"])
public_v1 = APIRouter(prefix="/public/v1", tags=["public-api"])

_requests = TABLES["requests"]
_leads = TABLES["leads"]
_keys = TABLES["api_keys"]
_hooks = TABLES["webhooks"]
_deliveries = TABLES["webhook_deliveries"]

LEAD_COLUMNS = ["title", "url", "email", "phone", "match_score", "snippet"]
HIDDEN = {"user_id", "org_id"}


def _uid(user: dict) -> str:
    return str(user["_id"])


def clean(doc: dict) -> dict:
    out = {}
    for k, v in doc.items():
        if k in HIDDEN:
            continue
        out[k] = v.isoformat() + "Z" if isinstance(v, datetime) else v
    return out


# ------------------------------------------------------------------ API keys
class KeyIn(BaseModel):
    name: str = Field("API key", max_length=80)
    scopes: list[str] = list(apikeys.SCOPES)


@router.get("/api-keys")
async def list_keys(user: dict = Depends(get_current_user)):
    rows = await _keys.find(_keys.model.user_id == _uid(user))
    return {"keys": [apikeys.public(r) for r in rows], "scopes": list(apikeys.SCOPES)}


@router.post("/api-keys", status_code=201)
async def create_key(body: KeyIn, user: dict = Depends(get_current_user)):
    try:
        doc, key = await apikeys.create_key(_uid(user), body.name, body.scopes)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {**doc, "key": key}  # the only time the plaintext key is returned


@router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_key(key_id: str, user: dict = Depends(get_current_user)):
    if not await apikeys.revoke_key(_uid(user), key_id):
        raise HTTPException(404, "Key not found")
    return Response(status_code=204)


# ------------------------------------------------------------------ webhooks
class HookIn(BaseModel):
    url: str
    events: list[str] = ["*"]


class HookPatch(BaseModel):
    active: Optional[bool] = None
    events: Optional[list[str]] = None


@router.get("/webhooks")
async def list_hooks(user: dict = Depends(get_current_user)):
    rows = await _hooks.find(_hooks.model.user_id == _uid(user))
    return {"webhooks": [webhooks.public(r) for r in rows], "events": list(webhooks.EVENTS)}


@router.post("/webhooks", status_code=201)
async def create_hook(body: HookIn, user: dict = Depends(get_current_user)):
    try:
        doc, secret = await webhooks.create_webhook(_uid(user), body.url, body.events)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {**doc, "secret": secret}  # shown once; used by the receiver to verify X-Quarry-Signature


@router.patch("/webhooks/{hook_id}")
async def patch_hook(hook_id: str, body: HookPatch, user: dict = Depends(get_current_user)):
    if not await _hooks.get(_id=hook_id, user_id=_uid(user)):
        raise HTTPException(404, "Webhook not found")
    fields = body.model_dump(exclude_none=True)
    return webhooks.public(await _hooks.update(hook_id, fields))


@router.delete("/webhooks/{hook_id}", status_code=204)
async def delete_hook(hook_id: str, user: dict = Depends(get_current_user)):
    if not await _hooks.get(_id=hook_id, user_id=_uid(user)):
        raise HTTPException(404, "Webhook not found")
    await _deliveries.delete_where(_deliveries.model.webhook_id == hook_id)
    await _hooks.delete(hook_id)
    return Response(status_code=204)


@router.post("/webhooks/{hook_id}/test")
async def test_hook(hook_id: str, user: dict = Depends(get_current_user)):
    if not await _hooks.get(_id=hook_id, user_id=_uid(user)):
        raise HTTPException(404, "Webhook not found")
    await webhooks.emit(_uid(user), "webhook.test", {"message": "Hello from Quarry"}, only_webhook_id=hook_id)
    return await webhooks.deliver_pending()


@router.get("/webhooks/{hook_id}/deliveries")
async def hook_deliveries(hook_id: str, user: dict = Depends(get_current_user)):
    if not await _hooks.get(_id=hook_id, user_id=_uid(user)):
        raise HTTPException(404, "Webhook not found")
    rows = await _deliveries.find(_deliveries.model.webhook_id == hook_id, order_by=_deliveries.model.id, limit=50)
    return {"deliveries": [clean({k: v for k, v in r.items() if k != "payload"}) for r in rows]}


# ------------------------------------------------------------------ export
class ExportIn(BaseModel):
    source: Literal["request", "list"]
    id: str
    destination: Literal["csv", "webhook"] = "csv"
    webhook_id: Optional[str] = None


async def leads_for_source(user_id: str, source: str, source_id: str) -> list[dict]:
    if source == "request":
        req = await _requests.get(_id=source_id, user_id=user_id)
        if not req:
            raise HTTPException(404, "Request not found")
        return await _leads.find(_leads.model.request_id == source_id, _leads.model.user_id == user_id)
    lst = await db_lists.get_lead_list_by_id(source_id, user_id)
    if not lst:
        raise HTTPException(404, "List not found")
    from app.db.leads import get_leads_by_ids

    return await get_leads_by_ids(lst.get("lead_ids", []), user_id)


@router.post("/export")
async def export(body: ExportIn, user: dict = Depends(get_current_user)):
    uid = _uid(user)
    leads = await leads_for_source(uid, body.source, body.id)
    if body.destination == "csv":
        data = generate_csv(LEAD_COLUMNS, [[lead.get(c) for c in LEAD_COLUMNS] for lead in leads])
        return Response(data, media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="quarry_{body.source}_{body.id}.csv"'})
    if not body.webhook_id or not await _hooks.get(_id=body.webhook_id, user_id=uid):
        raise HTTPException(422, "Choose one of your webhooks")
    payload = {"source": body.source, "source_id": body.id,
               "leads": [{"id": lead["_id"], **{c: lead.get(c) for c in LEAD_COLUMNS}} for lead in leads]}
    queued = await webhooks.emit(uid, "leads.export", payload, only_webhook_id=body.webhook_id)
    return {"queued": queued, "leads": len(leads)}


# ------------------------------------------------------------------ public read API
def _page(limit: int, offset: int):
    return limit, offset


@public_v1.get("/requests")
async def pub_requests(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                       key: dict = require_scope("read:requests")):
    rows = await _requests.find(_requests.model.user_id == key["user_id"], order_by=_requests.model.created_at.desc())
    return {"data": [clean(r) for r in rows[offset:offset + limit]], "total": len(rows)}


@public_v1.get("/requests/{request_id}/leads")
async def pub_request_leads(request_id: str, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                            key: dict = require_scope("read:leads")):
    if not await _requests.get(_id=request_id, user_id=key["user_id"]):
        raise HTTPException(404, "Request not found")
    rows = await _leads.find(_leads.model.request_id == request_id, _leads.model.user_id == key["user_id"],
                             order_by=_leads.model.match_score.desc())
    return {"data": [clean(r) for r in rows[offset:offset + limit]], "total": len(rows)}


@public_v1.get("/leads/{lead_id}")
async def pub_lead(lead_id: str, key: dict = require_scope("read:leads")):
    lead = await _leads.get(_id=lead_id, user_id=key["user_id"])
    if not lead:
        raise HTTPException(404, "Lead not found")
    return clean(lead)


@public_v1.get("/lists")
async def pub_lists(key: dict = require_scope("read:lists")):
    return {"data": [clean(d) for d in await db_lists.get_lead_lists_for_user(key["user_id"])]}


@public_v1.get("/lists/{list_id}/leads")
async def pub_list_leads(list_id: str, key: dict = require_scope("read:lists")):
    return {"data": [clean(lead) for lead in await leads_for_source(key["user_id"], "list", list_id)]}
