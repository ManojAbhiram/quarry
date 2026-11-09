"""Teams API: organizations, members, invites and org-scoped sharing of requests and lead lists."""
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from app.billing.store import get_plan_for_scope
from app.core.config import settings
from app.core.logger import logger
from app.db.leads import get_leads_by_ids
from app.db.lead_lists import _attach_lead_ids
from app.db.models import TABLES
from app.schemas.requests import request_to_out
from app.services.auth import get_current_user
from app.services.requests import _fetch_enrich_map
from app.teams import store
from app.teams.deps import OrgContext, org_member
from app.teams.mailer import send_invite_email

router = APIRouter(prefix="/orgs", tags=["teams"])


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


def _org_out(org: dict, role: Optional[str] = None) -> dict:
    return {"id": org["_id"], "name": org.get("name", ""), "domain": org.get("domain"), "role": role,
            "created_at": _iso(org.get("created_at"))}


def _fail(exc: store.TeamError):
    raise HTTPException(status_code=exc.status, detail=exc.message)


class OrgCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    domain: Optional[str] = Field(default=None, max_length=200)


class OrgRename(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class RoleChange(BaseModel):
    role: Literal["owner", "admin", "member", "viewer"]


class InviteCreate(BaseModel):
    email: EmailStr
    role: Literal["admin", "member", "viewer"] = "member"


class InviteAccept(BaseModel):
    token: str = Field(min_length=10)


class ShareCreate(BaseModel):
    resource_type: Literal["request", "list"]
    resource_id: str


@router.get("")
async def my_orgs(user: dict = Depends(get_current_user)):
    return {"organizations": [_org_out(x["org"], x["role"]) for x in await store.list_user_orgs(user)]}


@router.post("", status_code=201)
async def create_org(body: OrgCreate, user: dict = Depends(get_current_user)):
    org = await store.create_org(user, body.name, body.domain)
    return _org_out(org, "owner")


@router.post("/invites/accept")
async def accept_invite(body: InviteAccept, user: dict = Depends(get_current_user)):
    try:
        org = await store.accept_invite(body.token, user)
    except store.TeamError as e:
        _fail(e)
    m = await store.get_membership(org["_id"], str(user["_id"]))
    return _org_out(org, m["role"] if m else None)


@router.get("/{org_id}")
async def get_org(ctx: OrgContext = Depends(org_member("viewer"))):
    org = await TABLES["organizations"].get(_id=ctx.org_id)
    plan = await get_plan_for_scope(ctx.org_id)
    return {**_org_out(org, ctx.role), "plan": plan.id, "seat_limit": plan.seats}


@router.put("/{org_id}")
async def rename_org(body: OrgRename, ctx: OrgContext = Depends(org_member("admin"))):
    org = await TABLES["organizations"].update(ctx.org_id, {"name": body.name.strip(), "updated_at": datetime.utcnow()})
    return _org_out(org, ctx.role)


# -- members ------------------------------------------------------------------------------------------------------

@router.get("/{org_id}/members")
async def members(ctx: OrgContext = Depends(org_member("viewer"))):
    out = await store.list_members(ctx.org_id)
    return {"members": [{**m, "joined_at": _iso(m["joined_at"])} for m in out]}


@router.put("/{org_id}/members/{user_id}")
async def change_member_role(user_id: str, body: RoleChange, ctx: OrgContext = Depends(org_member("admin"))):
    try:
        m = await store.change_role(ctx.org_id, user_id, body.role, ctx.role)
    except store.TeamError as e:
        _fail(e)
    return {"user_id": m["user_id"], "role": m["role"]}


@router.delete("/{org_id}/members/{user_id}", status_code=204)
async def remove_member(user_id: str, ctx: OrgContext = Depends(org_member("viewer"))):
    try:
        await store.remove_member(ctx.org_id, user_id, str(ctx.user["_id"]), ctx.role)
    except store.TeamError as e:
        _fail(e)


# -- invites ------------------------------------------------------------------------------------------------------

def _invite_out(i: dict) -> dict:
    return {"id": i["_id"], "email": i["email"], "role": i["role"], "expires_at": _iso(i["expires_at"])}


@router.get("/{org_id}/invites")
async def invites(ctx: OrgContext = Depends(org_member("admin"))):
    return {"invites": [_invite_out(i) for i in await store.list_pending_invites(ctx.org_id)]}


@router.post("/{org_id}/invites", status_code=201)
async def invite(body: InviteCreate, ctx: OrgContext = Depends(org_member("admin"))):
    plan = await get_plan_for_scope(ctx.org_id)
    try:
        doc, token = await store.create_invite(ctx.org_id, body.email, body.role, str(ctx.user["_id"]), plan.seats)
    except store.TeamError as e:
        _fail(e)
    link = f"{settings.FRONTEND_URL}/invite?token={token}"
    org = await TABLES["organizations"].get(_id=ctx.org_id)
    emailed = False
    try:
        await send_invite_email(doc["email"], org.get("name", "a team"), ctx.user.get("name") or "A teammate", link)
        emailed = True
    except Exception as exc:  # SMTP is optional: the inviter can still copy the link
        logger.warning("Invite email not sent: %s", exc)
    return {**_invite_out(doc), "invite_url": link, "emailed": emailed}


@router.delete("/{org_id}/invites/{invite_id}", status_code=204)
async def revoke(invite_id: str, ctx: OrgContext = Depends(org_member("admin"))):
    try:
        await store.revoke_invite(ctx.org_id, invite_id)
    except store.TeamError as e:
        _fail(e)


# -- sharing ------------------------------------------------------------------------------------------------------

@router.post("/{org_id}/shares", status_code=201)
async def share(body: ShareCreate, ctx: OrgContext = Depends(org_member("member"))):
    try:
        return await store.share_resource(ctx.org_id, body.resource_type, body.resource_id, str(ctx.user["_id"]))
    except store.TeamError as e:
        _fail(e)


@router.delete("/{org_id}/shares/{resource_type}/{resource_id}", status_code=204)
async def unshare(resource_type: str, resource_id: str, ctx: OrgContext = Depends(org_member("member"))):
    try:
        await store.unshare_resource(ctx.org_id, resource_type, resource_id, str(ctx.user["_id"]), ctx.role)
    except store.TeamError as e:
        _fail(e)


@router.get("/{org_id}/shared/requests")
async def shared_requests(ctx: OrgContext = Depends(org_member("viewer"))):
    ids = [s["resource_id"] for s in await store.list_shares(ctx.org_id, "request")]
    docs = [d for d in [await TABLES["requests"].get(_id=i) for i in ids] if d]
    enrich = await _fetch_enrich_map([d["_id"] for d in docs]) if docs else {}
    return {"requests": [request_to_out(d, enrich.get(d["_id"], {})).model_dump() for d in docs]}


@router.get("/{org_id}/shared/requests/{request_id}")
async def shared_request(request_id: str, ctx: OrgContext = Depends(org_member("viewer"))):
    if not await store.is_shared_with_org(ctx.org_id, "request", request_id):
        raise HTTPException(status_code=404, detail="Request not found")
    doc = await TABLES["requests"].get(_id=request_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Request not found")
    enrich = await _fetch_enrich_map([request_id])
    return request_to_out(doc, enrich.get(request_id, {})).model_dump()


def _list_out(d: dict) -> dict:
    return {**d, "created_at": _iso(d.get("created_at")), "updated_at": _iso(d.get("updated_at"))}


@router.get("/{org_id}/shared/lists")
async def shared_lists(ctx: OrgContext = Depends(org_member("viewer"))):
    ids = [s["resource_id"] for s in await store.list_shares(ctx.org_id, "list")]
    docs = [d for d in [await TABLES["lead_lists"].get(_id=i) for i in ids] if d]
    return {"lists": [_list_out(d) for d in await _attach_lead_ids(docs)]}


@router.get("/{org_id}/shared/lists/{list_id}")
async def shared_list(list_id: str, ctx: OrgContext = Depends(org_member("viewer"))):
    if not await store.is_shared_with_org(ctx.org_id, "list", list_id):
        raise HTTPException(status_code=404, detail="List not found")
    doc = await TABLES["lead_lists"].get(_id=list_id)
    if not doc:
        raise HTTPException(status_code=404, detail="List not found")
    doc = (await _attach_lead_ids([doc]))[0]
    leads = await get_leads_by_ids(doc["lead_ids"], None) if doc["lead_ids"] else []
    by_id = {str(x["_id"]): x for x in leads}
    rows = [
        {"id": lid, "title": by_id[lid].get("title", ""), "url": by_id[lid].get("url", ""),
         "email": by_id[lid].get("email"), "match_score": by_id[lid].get("match_score")}
        for lid in doc["lead_ids"] if lid in by_id
    ]
    return {**_list_out(doc), "leads": rows}
