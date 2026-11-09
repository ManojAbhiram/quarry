"""Outreach HTTP API (authenticated) plus the public unsubscribe / open-pixel endpoints."""
from __future__ import annotations

import functools
import html
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.db.decision_makers import get_decision_makers_for_lead
from app.db.leads import get_leads_by_ids
from app.db.models import TABLES
from app.outreach import deps, dnscheck, inbound, logic, service
from app.services.auth import get_current_user

router = APIRouter(prefix="/outreach", tags=["outreach"])
public_router = APIRouter(prefix="/public", tags=["outreach-public"])

_boxes = TABLES["outreach_mailboxes"]
_seqs = TABLES["outreach_sequences"]
_enr = TABLES["outreach_enrollments"]
_msgs = TABLES["outreach_messages"]
_lists = TABLES["lead_lists"]


def _uid(user: dict) -> str:
    return str(user["_id"])


def _wrap(fn):
    @functools.wraps(fn)
    async def inner(*a, **kw):
        try:
            return await fn(*a, **kw)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except service.OutreachError as exc:
            raise HTTPException(422, str(exc)) from exc

    return inner


def _ser(doc: dict) -> dict:
    return {k: (v.isoformat() + "Z" if isinstance(v, datetime) else v) for k, v in doc.items()}


class MailboxIn(BaseModel):
    email: Optional[str] = None
    from_name: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = Field(None, ge=1, le=65535)
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    imap_host: Optional[str] = None
    imap_port: Optional[int] = Field(None, ge=1, le=65535)
    imap_username: Optional[str] = None
    imap_password: Optional[str] = None
    daily_cap: Optional[int] = Field(None, ge=1, le=2000)
    warmup: Optional[bool] = None
    timezone: Optional[str] = None


class StepIn(BaseModel):
    subject: str = ""
    body: str
    delay_days: int = 2


class SequenceIn(BaseModel):
    name: Optional[str] = None
    mailbox_id: Optional[str] = None
    steps: Optional[list[StepIn]] = None
    timezone: Optional[str] = None
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    days: Optional[list[int]] = None
    track_opens: Optional[bool] = None


class ContactIn(BaseModel):
    email: Optional[str] = None
    name: Optional[str] = None
    title: Optional[str] = None
    company: Optional[str] = None
    lead_id: Optional[str] = None
    timezone: Optional[str] = None


class EnrollIn(BaseModel):
    contacts: list[ContactIn] = []
    lead_ids: list[str] = []
    list_id: Optional[str] = None


class PreviewIn(BaseModel):
    contact: ContactIn = ContactIn(name="Alex Rivera", title="Head of Growth", company="Acme", email="alex@acme.test")


# ---------------------------------------------------------------- mailboxes
@router.get("/mailboxes")
async def list_mailboxes(user: dict = Depends(get_current_user)):
    boxes = await _boxes.find(_boxes.model.user_id == _uid(user))
    return {"mailboxes": [_ser(service.mailbox_public(b)) for b in boxes]}


@router.post("/mailboxes", status_code=201)
@_wrap
async def create_mailbox(body: MailboxIn, user: dict = Depends(get_current_user)):
    return _ser(await service.save_mailbox(_uid(user), body.model_dump(exclude_unset=True)))


@router.put("/mailboxes/{box_id}")
@_wrap
async def update_mailbox(box_id: str, body: MailboxIn, user: dict = Depends(get_current_user)):
    return _ser(await service.save_mailbox(_uid(user), body.model_dump(exclude_unset=True), box_id))


@router.delete("/mailboxes/{box_id}", status_code=204)
@_wrap
async def delete_mailbox(box_id: str, user: dict = Depends(get_current_user)):
    await service.get_owned(_boxes, box_id, _uid(user))
    await _boxes.delete(box_id)
    return Response(status_code=204)


@router.post("/mailboxes/{box_id}/resume")
@_wrap
async def resume_mailbox(box_id: str, user: dict = Depends(get_current_user)):
    await service.get_owned(_boxes, box_id, _uid(user))
    return _ser(service.mailbox_public(await _boxes.update(box_id, {"paused": False, "pause_reason": None})))


@router.post("/mailboxes/{box_id}/preflight")
@_wrap
async def mailbox_preflight(box_id: str, user: dict = Depends(get_current_user)):
    box = await service.get_owned(_boxes, box_id, _uid(user))
    return await dnscheck.preflight(box["email"].split("@")[-1])


@router.post("/mailboxes/{box_id}/poll")
@_wrap
async def poll_now(box_id: str, user: dict = Depends(get_current_user)):
    box = await service.get_owned(_boxes, box_id, _uid(user))
    return {"processed": await inbound.poll_mailbox(box)}


# ---------------------------------------------------------------- sequences
@router.get("/sequences")
async def list_sequences(user: dict = Depends(get_current_user)):
    seqs = await _seqs.find(_seqs.model.user_id == _uid(user), order_by=_seqs.model.id)
    return {"sequences": [_ser(s) for s in seqs]}


@router.post("/sequences", status_code=201)
@_wrap
async def create_sequence(body: SequenceIn, user: dict = Depends(get_current_user)):
    return _ser(await service.save_sequence(_uid(user), body.model_dump(exclude_unset=True)))


@router.put("/sequences/{seq_id}")
@_wrap
async def update_sequence(seq_id: str, body: SequenceIn, user: dict = Depends(get_current_user)):
    return _ser(await service.save_sequence(_uid(user), body.model_dump(exclude_unset=True), seq_id))


@router.delete("/sequences/{seq_id}", status_code=204)
@_wrap
async def delete_sequence(seq_id: str, user: dict = Depends(get_current_user)):
    await service.get_owned(_seqs, seq_id, _uid(user))
    await _enr.delete_where(_enr.model.sequence_id == seq_id)
    await _seqs.delete(seq_id)
    return Response(status_code=204)


@router.post("/sequences/{seq_id}/preview")
@_wrap
async def preview(seq_id: str, body: PreviewIn = PreviewIn(), user: dict = Depends(get_current_user)):
    seq = await service.get_owned(_seqs, seq_id, _uid(user))
    box = await _boxes.get(_id=seq["mailbox_id"]) if seq.get("mailbox_id") else None
    return {"steps": service.preview_sequence(seq, body.contact.model_dump(), (box or {}).get("from_name") or "")}


@router.post("/sequences/{seq_id}/start")
@_wrap
async def start(seq_id: str, user: dict = Depends(get_current_user)):
    return _ser(await service.set_sequence_status(_uid(user), seq_id, "active"))


@router.post("/sequences/{seq_id}/pause")
@_wrap
async def pause(seq_id: str, user: dict = Depends(get_current_user)):
    return _ser(await service.set_sequence_status(_uid(user), seq_id, "paused"))


@router.get("/sequences/{seq_id}/stats")
@_wrap
async def stats(seq_id: str, user: dict = Depends(get_current_user)):
    return await service.sequence_stats(await service.get_owned(_seqs, seq_id, _uid(user)))


@router.get("/sequences/{seq_id}/enrollments")
@_wrap
async def enrollments(seq_id: str, user: dict = Depends(get_current_user)):
    await service.get_owned(_seqs, seq_id, _uid(user))
    rows = await _enr.find(_enr.model.sequence_id == seq_id, limit=500)
    return {"enrollments": [_ser({k: v for k, v in r.items() if k != "contact"} | {"contact": r.get("contact")}) for r in rows]}


async def contacts_from_leads(user_id: str, lead_ids: list[str]) -> list[dict]:
    out: list[dict] = []
    for lead in await get_leads_by_ids(lead_ids, user_id):
        lid = str(lead.get("_id") or lead.get("id"))
        company = lead.get("title") or ""
        dms = [d for d in await get_decision_makers_for_lead(lid) if d.get("email")]
        for d in dms:
            out.append({"email": d["email"], "name": d.get("name"), "title": d.get("title"), "company": company, "lead_id": lid})
        if not dms and lead.get("email"):
            out.append({"email": lead["email"], "name": "", "title": "", "company": company, "lead_id": lid})
    return out


@router.post("/sequences/{seq_id}/enroll")
@_wrap
async def enroll(seq_id: str, body: EnrollIn, user: dict = Depends(get_current_user)):
    uid = _uid(user)
    seq = await service.get_owned(_seqs, seq_id, uid)
    contacts = [c.model_dump() for c in body.contacts]
    lead_ids = list(body.lead_ids)
    if body.list_id:
        from app.db import lead_lists as db_lists

        lst = await db_lists.get_lead_list_by_id(body.list_id, uid)
        if not lst:
            raise LookupError("list not found")
        lead_ids += lst.get("lead_ids", [])
    if lead_ids:
        contacts += await contacts_from_leads(uid, lead_ids)
    if not contacts:
        raise service.OutreachError("no contacts to enroll")
    return await service.enroll(uid, seq, contacts)


# ---------------------------------------------------------------- public
def _page(title: str, message: str, form_token: str | None = None) -> HTMLResponse:
    form = ('<form method="post"><button type="submit" style="padding:10px 22px;border-radius:8px;border:0;'
            'background:#4F46E5;color:#fff;font-weight:600;cursor:pointer">Confirm unsubscribe</button></form>'
            if form_token else "")
    return HTMLResponse(
        f"<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'><title>{html.escape(title)}</title>"
        f"<body style='font-family:system-ui,sans-serif;max-width:440px;margin:15vh auto;padding:0 24px;text-align:center'>"
        f"<h2>{html.escape(title)}</h2><p style='color:#555'>{html.escape(message)}</p>{form}</body>"
    )


async def do_unsubscribe(data: dict) -> None:
    owner, email = data["o"], data["m"]
    await deps.add_suppression(owner, email, "unsubscribe", "one_click")
    enr = await _enr.get(_id=data["e"])
    await service.stop_enrollments_for(owner, email, "unsubscribed")
    if enr:
        last = int(enr.get("step_index") or 1) - 1
        await _msgs.insert({"enrollment_id": enr["_id"], "direction": "unsubscribe", "message_id": None,
                            "step": max(0, last), "created_at": datetime.utcnow(), "user_id": owner})
    await service._emit(owner, "outreach.unsubscribe", {"email": email})


@public_router.get("/unsubscribe/{token}")
async def unsubscribe_page(token: str):
    if not logic.verify_token("unsub", token):
        return _page("Link not valid", "This unsubscribe link is invalid or has been altered.")
    # GET only confirms (mail scanners prefetch links); the POST performs the action.
    return _page("Unsubscribe", "Click to stop receiving emails from this sender.", form_token=token)


@public_router.post("/unsubscribe/{token}")
async def unsubscribe_action(token: str, list_unsubscribe: Optional[str] = Form(None, alias="List-Unsubscribe")):
    data = logic.verify_token("unsub", token)
    if not data:
        return _page("Link not valid", "This unsubscribe link is invalid or has been altered.")
    await do_unsubscribe(data)
    return _page("You are unsubscribed", "You will not receive further emails from this sender.")


_GIF = bytes.fromhex("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b")


@public_router.get("/o/{token}.gif")
async def open_pixel(token: str):
    data = logic.verify_token("open", token)
    if data:
        enr = await _enr.get(_id=data["e"])
        if enr:
            await _msgs.insert({"enrollment_id": enr["_id"], "direction": "open", "message_id": None, "step": data["s"],
                                "created_at": datetime.utcnow(), "user_id": enr["user_id"]})
    return Response(_GIF, media_type="image/gif", headers={"Cache-Control": "no-store"})
