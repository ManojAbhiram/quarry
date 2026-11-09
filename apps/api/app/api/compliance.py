"""Compliance routes: suppression ledger, public opt-out, erasure by email, audit log, retention.

GET    /compliance/suppressions                list the ledger
POST   /compliance/suppressions                add an email or domain
DELETE /compliance/suppressions?value=...      remove by value or entry id
POST   /compliance/opt-out-link                signed opt-out link for an address
POST   /compliance/erase                       erase a person's data by email (writes the audit log)
GET    /compliance/audit-log                   erasure and retention history
POST   /compliance/leads/{id}/reject|restore   mark a lead rejected (deleted after 30 days) or undo
POST   /compliance/retention/run               run the 30-day deletion for the caller's leads (?dry_run=true)
GET    /public/opt-out?token=...               (no auth) who the link is for
POST   /public/opt-out                         (no auth) confirm the opt-out
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import suppression
from app.compliance import audit, optout, retention
from app.compliance.person_erasure import erase_person_by_email
from app.core.rate_limit import auth_rate_limit
from app.services.auth import get_current_user

router = APIRouter(prefix="/compliance", tags=["compliance"])
public_router = APIRouter(prefix="/public", tags=["public"])


def _entry_out(doc: dict) -> dict:
    created = doc.get("created_at")
    return {
        "id": doc["_id"], "value": doc.get("value"), "kind": doc.get("kind"), "reason": doc.get("reason") or "",
        "source": doc.get("source") or "manual", "created_at": created.isoformat() if created else None,
    }


class SuppressionIn(BaseModel):
    value: str = Field(min_length=1, max_length=320)
    reason: str = Field(default="", max_length=300)


@router.get("/suppressions")
async def get_suppressions(current_user: dict = Depends(get_current_user)):
    rows = await suppression.list_suppressions(str(current_user["_id"]))
    return {"items": [_entry_out(r) for r in rows], "total": len(rows)}


@router.post("/suppressions", status_code=201)
async def post_suppression(body: SuppressionIn, current_user: dict = Depends(get_current_user)):
    try:
        doc = await suppression.add_suppression(str(current_user["_id"]), body.value, body.reason, "manual")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _entry_out(doc)


@router.delete("/suppressions", status_code=204)
async def delete_suppression(value: str = Query(min_length=1), current_user: dict = Depends(get_current_user)):
    if not await suppression.remove_suppression(str(current_user["_id"]), value):
        raise HTTPException(status_code=404, detail="Not on the suppression list")


class OptOutLinkIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)


@router.post("/opt-out-link")
async def make_opt_out_link(body: OptOutLinkIn, current_user: dict = Depends(get_current_user)):
    try:
        return {"url": optout.optout_url(str(current_user["_id"]), body.email)}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


class EraseIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    add_to_suppression: bool = True


@router.post("/erase")
async def erase(body: EraseIn, current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    try:
        return await erase_person_by_email(user_id, body.email, actor_id=user_id, add_to_suppression=body.add_to_suppression)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/audit-log")
async def get_audit_log(current_user: dict = Depends(get_current_user)):
    rows = await audit.list_entries(str(current_user["_id"]))
    return {"items": [
        {"id": r["_id"], "action": r.get("action"), "details": r.get("details") or {},
         "created_at": r["created_at"].isoformat() if r.get("created_at") else None}
        for r in rows
    ]}


@router.post("/leads/{lead_id}/reject")
async def reject(lead_id: str, current_user: dict = Depends(get_current_user)):
    if not await retention.reject_lead(str(current_user["_id"]), lead_id):
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"rejected": True, "deleted_after_days": retention.RETENTION_DAYS}


@router.post("/leads/{lead_id}/restore")
async def restore(lead_id: str, current_user: dict = Depends(get_current_user)):
    if not await retention.restore_lead(str(current_user["_id"]), lead_id):
        raise HTTPException(status_code=404, detail="Lead not found")
    return {"rejected": False}


@router.post("/retention/run")
async def run_retention(dry_run: bool = False, days: Optional[int] = Query(None, ge=1, le=3650),
                        current_user: dict = Depends(get_current_user)):
    return await retention.purge_stale_leads(
        owner_id=str(current_user["_id"]), days=days or retention.RETENTION_DAYS, dry_run=dry_run
    )


# ── public opt-out (no auth) ─────────────────────────────────────────────────

class OptOutIn(BaseModel):
    token: str = Field(min_length=10, max_length=2000)


def _mask(email: str) -> str:
    return audit.mask_email(email)


@public_router.get("/opt-out", dependencies=[Depends(auth_rate_limit)])
async def opt_out_info(token: str = Query(min_length=10, max_length=2000)):
    parsed = optout.read_token(token)
    if not parsed:
        raise HTTPException(status_code=400, detail="This opt-out link is invalid or has expired.")
    owner_id, email = parsed
    return {"email_masked": _mask(email), "already_opted_out": await suppression.is_suppressed(owner_id, email)}


@public_router.post("/opt-out", dependencies=[Depends(auth_rate_limit)])
async def opt_out_confirm(body: OptOutIn):
    parsed = optout.read_token(body.token)
    if not parsed:
        raise HTTPException(status_code=400, detail="This opt-out link is invalid or has expired.")
    owner_id, email = parsed
    await suppression.add_suppression(owner_id, email, "Opted out via link", "opt_out")
    return {"opted_out": True, "email_masked": _mask(email)}
