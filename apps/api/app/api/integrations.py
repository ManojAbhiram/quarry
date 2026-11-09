"""Integrations API: HubSpot connection, field mapping, list push and sync status, plus REST hooks for Zapier/Make."""
import os
import secrets
from typing import Literal, Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.billing.store import get_plan_for_scope
from app.core.config import settings
from app.core.url_guard import UnsafeURLError, check_url
from app.crm import hooks, service
from app.crm.base import CrmError
from app.crm.hubspot import AUTHORIZE_URL, OAUTH_SCOPES, TOKEN_URL, HubSpotConnector
from app.crm.mapping import COMPANY_FIELDS, CONTACT_FIELDS, DEFAULT_MAPPING, MappingError
from app.db.decision_makers import get_decision_makers_for_lead
from app.db.lead_lists import _attach_lead_ids
from app.db.leads import get_leads_by_ids
from app.db.models import TABLES
from app.teams import store as teams
from app.teams.deps import Workspace, get_workspace, workspace_role

router = APIRouter(prefix="/integrations", tags=["integrations"])
hooks_router = APIRouter(prefix="/hooks", tags=["hooks"])

DEFAULT_REDIRECT = f"{settings.FRONTEND_URL}/integrations/hubspot/callback"


def _redirect_uri() -> str:
    return os.getenv("HUBSPOT_REDIRECT_URI", DEFAULT_REDIRECT)


class TokenBody(BaseModel):
    access_token: str = Field(min_length=8, max_length=4096)


class OAuthCallback(BaseModel):
    code: str = Field(min_length=3)
    state: Optional[str] = None


class MappingBody(BaseModel):
    company: dict = {}
    contact: dict = {}


class PushBody(BaseModel):
    list_id: str
    only_failed: bool = False


async def _connection(ws: Workspace, provider: str = "hubspot") -> dict:
    conn = await service.get_connection(ws.scope_id, provider)
    if not conn:
        raise HTTPException(status_code=404, detail=f"{provider} is not connected")
    return conn


async def _check_plan_allows(ws: Workspace) -> None:
    plan = await get_plan_for_scope(ws.scope_id)
    used = len(await service.list_connections(ws.scope_id))
    if used >= plan.crm_connections:
        raise HTTPException(
            status_code=402,
            detail=f"The {plan.name} plan includes {plan.crm_connections} CRM integration(s). Upgrade to connect more.",
        )


async def _connect(ws: Workspace, access: str, refresh: Optional[str], auth_type: str) -> dict:
    existing = await service.get_connection(ws.scope_id, "hubspot")
    if not existing:
        await _check_plan_allows(ws)
    connector = HubSpotConnector(access)
    try:
        info = await connector.test_connection()
    except CrmError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from None
    finally:
        await connector.aclose()
    conn = await service.save_connection(ws.scope_id, "hubspot", access_token=access, refresh_token=refresh,
                                         auth_type=auth_type, info=info)
    return service.public_connection(conn, "hubspot")


@router.get("")
async def overview(ws: Workspace = Depends(get_workspace)):
    conn = await service.get_connection(ws.scope_id, "hubspot")
    plan = await get_plan_for_scope(ws.scope_id)
    return {
        "integrations": [service.public_connection(conn, "hubspot")],
        "hubspot_oauth_available": bool(os.getenv("HUBSPOT_CLIENT_ID") and os.getenv("HUBSPOT_CLIENT_SECRET")),
        "crm_connections_allowed": plan.crm_connections,
        "can_manage": not ws.org_id or ws.role in ("owner", "admin"),
        "fields": {"company": COMPANY_FIELDS, "contact": CONTACT_FIELDS},
        "default_mapping": DEFAULT_MAPPING,
    }


@router.put("/hubspot/token")
async def connect_token(body: TokenBody, ws: Workspace = Depends(workspace_role("admin"))):
    return await _connect(ws, body.access_token.strip(), None, "private_app")


@router.get("/hubspot/oauth/url")
async def oauth_url(ws: Workspace = Depends(workspace_role("admin"))):
    client_id = os.getenv("HUBSPOT_CLIENT_ID", "")
    if not client_id:
        raise HTTPException(status_code=503, detail="HubSpot OAuth is not configured on this server")
    state = secrets.token_urlsafe(16)
    query = urlencode({"client_id": client_id, "redirect_uri": _redirect_uri(), "scope": OAUTH_SCOPES, "state": state})
    return {"url": f"{AUTHORIZE_URL}?{query}", "state": state}


@router.post("/hubspot/oauth/callback")
async def oauth_callback(body: OAuthCallback, ws: Workspace = Depends(workspace_role("admin"))):
    cid, secret = os.getenv("HUBSPOT_CLIENT_ID", ""), os.getenv("HUBSPOT_CLIENT_SECRET", "")
    if not (cid and secret):
        raise HTTPException(status_code=503, detail="HubSpot OAuth is not configured on this server")
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.post(TOKEN_URL, data={"grant_type": "authorization_code", "client_id": cid,
                                                 "client_secret": secret, "redirect_uri": _redirect_uri(),
                                                 "code": body.code})
    if res.status_code != 200:
        raise HTTPException(status_code=400, detail="HubSpot did not accept the authorization code")
    tok = res.json()
    return await _connect(ws, tok["access_token"], tok.get("refresh_token"), "oauth")


@router.delete("/hubspot", status_code=204)
async def disconnect(ws: Workspace = Depends(workspace_role("admin"))):
    await service.delete_connection(await _connection(ws))


@router.get("/hubspot/mapping")
async def get_mapping(ws: Workspace = Depends(get_workspace)):
    conn = await _connection(ws)
    return {"mapping": conn.get("mapping") or DEFAULT_MAPPING, "fields": {"company": COMPANY_FIELDS, "contact": CONTACT_FIELDS}}


@router.put("/hubspot/mapping")
async def put_mapping(body: MappingBody, ws: Workspace = Depends(workspace_role("admin"))):
    conn = await _connection(ws)
    try:
        updated = await service.set_mapping(conn, body.model_dump())
    except MappingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    return {"mapping": updated["mapping"]}


async def _readable_list(ws: Workspace, list_id: str) -> dict:
    """A list the caller owns, or one shared into the active organization. Otherwise 404."""
    doc = await TABLES["lead_lists"].get(_id=list_id)
    owned = doc and doc.get("user_id") == str(ws.user["_id"])
    shared = doc and ws.org_id and await teams.is_shared_with_org(ws.org_id, "list", list_id)
    if not (owned or shared):
        raise HTTPException(status_code=404, detail="List not found")
    return (await _attach_lead_ids([doc]))[0]


@router.post("/hubspot/push")
async def push(body: PushBody, ws: Workspace = Depends(workspace_role("member"))):
    conn = await _connection(ws)
    lst = await _readable_list(ws, body.list_id)
    lead_ids = lst["lead_ids"]
    if not lead_ids:
        return {"summary": {"synced": 0, "failed": 0, "skipped": 0}, "results": []}
    leads = await get_leads_by_ids(lead_ids, None)
    dms = {x["_id"]: await get_decision_makers_for_lead(x["_id"]) for x in leads}
    connector = service.make_connector(conn)
    try:
        return await service.push_leads(conn, connector, leads, dms, only_failed=body.only_failed)
    finally:
        close = getattr(connector, "aclose", None)
        if close:
            await close()


@router.get("/hubspot/sync")
async def sync_status(list_id: str = Query(...), ws: Workspace = Depends(get_workspace)):
    conn = await _connection(ws)
    lst = await _readable_list(ws, list_id)
    rows = await service.sync_rows(conn["_id"], lst["lead_ids"] or [])
    out = []
    for lid in lst["lead_ids"]:
        r = rows.get(lid)
        out.append({
            "lead_id": lid, "status": r["status"] if r else "not_synced", "error": r.get("error") if r else None,
            "retryable": bool(r and r.get("retryable")), "attempts": r.get("attempts", 0) if r else 0,
            "last_attempt_at": r["last_attempt_at"].isoformat() if r and r.get("last_attempt_at") else None,
        })
    counts = {s: sum(1 for x in out if x["status"] == s) for s in ("synced", "failed", "not_synced")}
    return {"list_id": list_id, "counts": counts, "leads": out}


# -- REST hooks (Zapier / Make) -----------------------------------------------------------------------------------

class HookBody(BaseModel):
    event: Literal["lead.created", "list.updated"]
    target_url: str = Field(min_length=8, max_length=2000)


def _hook_out(h: dict, with_secret: bool = False) -> dict:
    out = {"id": h["_id"], "event": h["event"], "target_url": h["target_url"], "active": h.get("active", True)}
    if with_secret:
        out["secret"] = h["secret"]
    return out


@hooks_router.post("/subscribe", status_code=201)
async def subscribe(body: HookBody, ws: Workspace = Depends(workspace_role("member"))):
    try:
        check_url(body.target_url)
    except UnsafeURLError as exc:
        raise HTTPException(status_code=422, detail=f"target_url rejected: {exc}") from None
    hook = await hooks.subscribe(ws.scope_id, body.event, body.target_url, str(ws.user["_id"]))
    return _hook_out(hook, with_secret=True)  # the signing secret is shown once


@hooks_router.get("")
async def list_hooks(ws: Workspace = Depends(get_workspace)):
    return {"hooks": [_hook_out(h) for h in await hooks.list_subscriptions(ws.scope_id)]}


@hooks_router.delete("/{hook_id}", status_code=204)
async def unsubscribe(hook_id: str, ws: Workspace = Depends(workspace_role("member"))):
    if not await hooks.unsubscribe(ws.scope_id, hook_id):
        raise HTTPException(status_code=404, detail="Hook not found")


@hooks_router.get("/sample/{event}")
async def sample(event: str, ws: Workspace = Depends(get_workspace)):
    if event not in hooks.SAMPLES:
        raise HTTPException(status_code=404, detail="Unknown event")
    return [hooks.SAMPLES[event]]  # Zapier expects an array for performList
