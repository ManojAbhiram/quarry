"""Inbound mail: reply threading, DSN bounce parsing and auto-reply filtering, driven by IMAP polling."""
from __future__ import annotations

import email
import re
from datetime import datetime
from email import policy
from email.message import Message

from app.core.logger import logger
from app.db.models import TABLES
from app.outreach import deps, service
from app.outreach.ports import ports

_boxes = TABLES["outreach_mailboxes"]
_enr = TABLES["outreach_enrollments"]
_msgs = TABLES["outreach_messages"]

_MSGID = re.compile(r"<[^<>\s]+>")
_AUTO_SUBJECT = re.compile(r"^\s*(auto(matic)?[ -]?reply|automatische antwort|out of office|autoreply|auto:)", re.I)
_STATUS = re.compile(r"^Status:\s*([245])\.\d+\.\d+", re.I | re.M)
_FINAL_RCPT = re.compile(r"^(?:Final|Original)-Recipient:\s*(?:rfc822;)?\s*(\S+)", re.I | re.M)


def message_ids(value: str | None) -> list[str]:
    return _MSGID.findall(value or "")


def is_auto_reply(msg: Message) -> bool:
    if (msg.get("Auto-Submitted") or "no").strip().lower() != "no":
        return True
    if msg.get("X-Autoreply") or msg.get("X-Autorespond") or msg.get("X-Auto-Response-Suppress"):
        return True
    if (msg.get("Precedence") or "").strip().lower() in ("bulk", "auto_reply", "junk", "list"):
        return True
    return bool(_AUTO_SUBJECT.match(str(msg.get("Subject") or "")))


def parse_dsn(msg: Message) -> dict | None:
    """Return {hard, original_ids, recipient} for a delivery-status notification, else None."""
    sender = str(msg.get("From") or "").lower()
    report = msg.get_content_type() == "multipart/report" and "delivery-status" in str(msg.get_param("report-type") or "")
    if not (report or "mailer-daemon" in sender or "postmaster" in sender):
        return None
    status_text, original_ids, recipient = "", [], None
    for part in msg.walk():
        ctype = part.get_content_type()
        if ctype == "message/delivery-status":
            status_text += "\n".join(str(p) for p in part.get_payload())
        elif ctype in ("message/rfc822", "text/rfc822-headers"):
            payload = part.get_payload()
            inner = payload[0] if isinstance(payload, list) and payload else None
            raw = str(inner) if inner is not None else str(payload)
            original_ids += message_ids("\n".join(ln for ln in raw.splitlines() if ln.lower().startswith("message-id")))
    if not status_text:  # non-standard bounce: look in the body for an SMTP status
        body = msg.get_body(preferencelist=("plain",))
        status_text = body.get_content() if body else ""
    m = _STATUS.search(status_text)
    if not m and not report:
        if not re.search(r"\b5\d\d[ -]5?\.?\d?", status_text):
            return None
    r = _FINAL_RCPT.search(status_text)
    recipient = r.group(1).lower() if r else None
    original_ids += message_ids(msg.get("In-Reply-To")) + message_ids(msg.get("References"))
    hard = bool(m and m.group(1) == "5") or (m is None and bool(re.search(r"\b5\d\d\b", status_text)))
    return {"hard": hard, "original_ids": original_ids, "recipient": recipient}


async def _find_out(mids: list[str]) -> dict | None:
    for mid in mids:
        hit = await _msgs.get(message_id=mid, direction="out")
        if hit:
            return hit
    return None


async def process_message(box: dict, raw: bytes, now: datetime) -> str:
    """Handle one inbound message. Returns one of: reply, hard_bounce, soft_bounce, auto_reply, ignored."""
    msg = email.message_from_bytes(raw, policy=policy.default)
    dsn = parse_dsn(msg)
    if dsn:
        out = await _find_out(dsn["original_ids"])
        if not out:
            return "ignored"
        enr = await _enr.get(_id=out["enrollment_id"])
        await _msgs.insert({"enrollment_id": out["enrollment_id"], "mailbox_id": box["_id"], "direction": "bounce",
                            "message_id": None, "hard": dsn["hard"], "step": out.get("step", 0), "created_at": now,
                            "user_id": out.get("user_id")})
        if dsn["hard"] and enr:
            await _enr.update(enr["_id"], {"status": "bounced", "stopped_at": now})
            await deps.add_suppression(enr["user_id"], enr["email"], "hard_bounce", "dsn")
            await service.check_auto_pause(box["_id"])
            await service._emit(enr["user_id"], "outreach.bounce", {"email": enr["email"], "sequence_id": enr["sequence_id"]})
        return "hard_bounce" if dsn["hard"] else "soft_bounce"
    refs = message_ids(msg.get("In-Reply-To")) + message_ids(msg.get("References"))
    out = await _find_out(refs)
    if not out:
        return "ignored"
    if is_auto_reply(msg):
        return "auto_reply"
    mid = (message_ids(msg.get("Message-ID")) or [None])[0]
    if mid and await _msgs.get(message_id=mid, direction="reply"):
        return "ignored"  # already processed (re-poll)
    enr = await _enr.get(_id=out["enrollment_id"])
    await _msgs.insert({"enrollment_id": out["enrollment_id"], "mailbox_id": box["_id"], "direction": "reply",
                        "message_id": mid, "step": out.get("step", 0), "created_at": now, "user_id": out.get("user_id"),
                        "snippet": _snippet(msg)})
    if enr and enr["status"] == service.ACTIVE:
        await _enr.update(enr["_id"], {"status": "replied", "stopped_at": now})
    if enr:
        await service._emit(enr["user_id"], "outreach.reply", {"email": enr["email"], "sequence_id": enr["sequence_id"]})
    return "reply"


def _snippet(msg: Message) -> str:
    body = msg.get_body(preferencelist=("plain", "html"))
    try:
        text = body.get_content() if body else ""
    except (LookupError, UnicodeDecodeError):
        text = ""
    return " ".join(text.split())[:240]


async def poll_mailbox(box: dict, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    counts: dict[str, int] = {}
    if not box.get("imap_host"):
        return counts
    last = int(box.get("imap_last_uid") or 0)
    try:
        fetched = await ports.imap.fetch_new(service.mailbox_creds(box), last)
    except Exception as exc:  # noqa: BLE001 - network/auth errors are recorded, never raised into the scheduler
        logger.warning("IMAP poll failed for mailbox %s: %s", box["_id"], exc)
        await _boxes.update(box["_id"], {"imap_error": str(exc)[:200], "imap_checked_at": now})
        return counts
    for uid, raw in fetched:
        kind = await process_message(box, raw, now)
        counts[kind] = counts.get(kind, 0) + 1
        last = max(last, uid)
    await _boxes.update(box["_id"], {"imap_last_uid": last, "imap_checked_at": now, "imap_error": None})
    return counts


async def poll_all(now: datetime | None = None) -> dict:
    total: dict[str, int] = {}
    for box in await _boxes.find():
        for k, v in (await poll_mailbox(box, now)).items():
            total[k] = total.get(k, 0) + v
    return total
