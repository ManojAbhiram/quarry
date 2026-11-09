"""Outreach domain logic: mailboxes, sequences, enrollment, the send loop, bounce-rate guard and stats."""
from __future__ import annotations

import html
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid

from app.core.logger import logger
from app.core.security_crypto import decrypt_secret, encrypt_secret
from app.db.models import TABLES
from app.outreach import deps, logic
from app.outreach.ports import MailboxCreds, SendError, ports
from app.p3.config import p3_settings

_boxes = TABLES["outreach_mailboxes"]
_seqs = TABLES["outreach_sequences"]
_enr = TABLES["outreach_enrollments"]
_msgs = TABLES["outreach_messages"]

MAX_STEPS = 8
MAX_ATTEMPTS = 3
ACTIVE = "active"
TERMINAL = {"replied", "bounced", "unsubscribed", "completed", "suppressed", "failed"}


class OutreachError(ValueError):
    pass


# ------------------------------------------------------------------ mailboxes
SECRET_FIELDS = ("smtp_password", "imap_password")


def mailbox_public(box: dict) -> dict:
    out = {k: v for k, v in box.items() if not k.endswith("_enc")}
    out["has_smtp_password"] = bool(box.get("smtp_password_enc"))
    out["has_imap_password"] = bool(box.get("imap_password_enc"))
    return out


def mailbox_creds(box: dict) -> MailboxCreds:
    return MailboxCreds(
        smtp_host=box["smtp_host"], smtp_port=int(box.get("smtp_port") or 587),
        smtp_username=box.get("smtp_username") or box["email"],
        smtp_password=decrypt_secret(box.get("smtp_password_enc", "")),
        imap_host=box.get("imap_host") or "", imap_port=int(box.get("imap_port") or 993),
        imap_username=box.get("imap_username") or box.get("smtp_username") or box["email"],
        imap_password=decrypt_secret(box.get("imap_password_enc", "")),
    )


_BOX_FIELDS = ("email", "from_name", "smtp_host", "smtp_port", "smtp_username", "imap_host", "imap_port",
               "imap_username", "daily_cap", "warmup", "timezone")


async def save_mailbox(user_id: str, data: dict, box_id: str | None = None) -> dict:
    fields = {k: data[k] for k in _BOX_FIELDS if data.get(k) is not None}
    for secret in SECRET_FIELDS:
        if data.get(secret):  # blank means "keep the stored one"
            fields[f"{secret}_enc"] = encrypt_secret(data[secret])
    if box_id:
        existing = await _boxes.get(_id=box_id, user_id=user_id)
        if not existing:
            raise LookupError("mailbox not found")
        if fields.get("warmup") and not existing.get("warmup"):
            fields["warmup_started_at"] = datetime.utcnow()
        updated = await _boxes.update(box_id, fields)
        return mailbox_public(updated)
    if not fields.get("email") or not fields.get("smtp_host"):
        raise OutreachError("email and smtp_host are required")
    fields.setdefault("smtp_port", 587)
    fields.setdefault("daily_cap", 40)
    fields.setdefault("warmup", True)
    fields.setdefault("timezone", "UTC")
    doc = {**fields, "user_id": user_id, "paused": False, "imap_last_uid": 0, "created_at": datetime.utcnow(),
           "warmup_started_at": datetime.utcnow() if fields["warmup"] else None}
    doc["_id"] = await _boxes.insert(doc)
    return mailbox_public(doc)


def connection_warning(result: dict) -> str | None:
    """A one-line warning for a failed connection test, or None when it passed."""
    if result["ok"]:
        return None
    parts = [f"{name.upper()}: {result[name]['error']}" for name in ("smtp", "imap") if result[name].get("ok") is False]
    return "Saved, but the connection test failed. " + "; ".join(parts)


async def test_connection(user_id: str, data: dict, box_id: str | None = None) -> dict:
    """Try SMTP and IMAP logins through the swappable ports. Never raises for a failed login: per-protocol results.

    With `box_id`, blank fields and passwords fall back to the stored mailbox, so the edit dialog can retest.
    """
    stored = await _boxes.get(_id=box_id, user_id=user_id) if box_id else None
    if box_id and not stored:
        raise LookupError("mailbox not found")
    merged = dict(stored or {})
    merged.update({k: data[k] for k in _BOX_FIELDS if data.get(k) not in (None, "")})
    for secret in SECRET_FIELDS:
        if data.get(secret):
            merged[f"{secret}_enc"] = encrypt_secret(data[secret])
    if not merged.get("smtp_host"):
        raise OutreachError("smtp_host is required to test the connection")
    merged.setdefault("email", data.get("email") or data.get("smtp_username") or "")
    creds = mailbox_creds(merged)

    async def attempt(fn, label: str) -> dict:
        try:
            await fn(creds)
            return {"ok": True, "error": None}
        except SendError as exc:
            return {"ok": False, "error": str(exc) or f"{label} login failed"}
        except Exception as exc:  # noqa: BLE001  adapters must not take the endpoint down
            logger.warning("mailbox %s test failed: %s", label, exc)
            return {"ok": False, "error": f"{label} check failed: {exc}"}

    smtp = await attempt(ports.smtp.verify_login, "SMTP")
    if creds.imap_host:
        imap = await attempt(ports.imap.check_login, "IMAP")
    else:
        imap = {"ok": None, "error": None, "skipped": True}
    return {"ok": smtp["ok"] and imap["ok"] is not False, "smtp": smtp, "imap": imap}


async def get_owned(table, doc_id: str, user_id: str) -> dict:
    doc = await table.get(_id=doc_id, user_id=user_id)
    if not doc:
        raise LookupError("not found")
    return doc


# ------------------------------------------------------------------ sequences
def validate_steps(steps: list[dict]) -> list[dict]:
    if not steps:
        raise OutreachError("a sequence needs at least one step")
    if len(steps) > MAX_STEPS:
        raise OutreachError(f"at most {MAX_STEPS} steps")
    clean = []
    for i, st in enumerate(steps):
        subject, body = (st.get("subject") or "").strip(), (st.get("body") or "").strip()
        if not body:
            raise OutreachError(f"step {i + 1} needs a body")
        if i == 0 and not subject:
            raise OutreachError("step 1 needs a subject")
        bad = logic.unknown_vars(subject) | logic.unknown_vars(body)
        if bad:
            raise OutreachError(f"unknown variable(s): {', '.join(sorted(bad))}")
        delay = 0 if i == 0 else max(1, min(60, int(st.get("delay_days") or 2)))
        clean.append({"subject": subject, "body": body, "delay_days": delay})
    return clean


_SEQ_FIELDS = ("name", "mailbox_id", "timezone", "window_start", "window_end", "days", "track_opens")


async def save_sequence(user_id: str, data: dict, seq_id: str | None = None) -> dict:
    fields = {k: data[k] for k in _SEQ_FIELDS if data.get(k) is not None}
    if data.get("steps") is not None:
        fields["steps"] = validate_steps(data["steps"])
    if fields.get("mailbox_id"):
        await get_owned(_boxes, fields["mailbox_id"], user_id)
    fields["updated_at"] = datetime.utcnow()
    if seq_id:
        await get_owned(_seqs, seq_id, user_id)
        return await _seqs.update(seq_id, fields)
    if not fields.get("name") or "steps" not in fields:
        raise OutreachError("name and steps are required")
    doc = {"timezone": "UTC", "window_start": "09:00", "window_end": "17:00", "days": [0, 1, 2, 3, 4],
           "track_opens": False, **fields, "user_id": user_id, "status": "draft", "created_at": datetime.utcnow()}
    doc["_id"] = await _seqs.insert(doc)
    return doc


def preview_sequence(seq: dict, contact: dict, sender_name: str = "") -> list[dict]:
    values = logic.build_vars(contact, sender_name)
    out = []
    for i, st in enumerate(seq["steps"]):
        subject = st["subject"] or f"Re: {seq['steps'][0]['subject']}"
        out.append({
            "step": i + 1, "delay_days": st["delay_days"],
            "subject": logic.render(subject, values), "body": logic.render(st["body"], values),
            "missing": logic.missing_values(st["subject"] + "\n" + st["body"], values),
        })
    return out


async def enroll(user_id: str, seq: dict, contacts: list[dict], now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    existing = {e["email"] for e in await _enr.find(_enr.model.sequence_id == seq["_id"])}
    added, skipped = 0, []
    for c in contacts:
        email = (c.get("email") or "").strip().lower()
        if "@" not in email:
            skipped.append({"email": email, "reason": "no_email"})
        elif email in existing:
            skipped.append({"email": email, "reason": "duplicate"})
        elif await deps.is_suppressed(user_id, email):
            skipped.append({"email": email, "reason": "suppressed"})
        else:
            first = logic.next_window_slot(now, c.get("timezone") or seq.get("timezone"), seq["window_start"],
                                           seq["window_end"], seq["days"])
            await _enr.insert({
                "sequence_id": seq["_id"], "user_id": user_id, "status": ACTIVE, "email": email,
                "next_send_at": first, "step_index": 0, "attempts": 0, "created_at": now,
                "contact": {k: c.get(k) for k in ("name", "first_name", "last_name", "title", "company", "lead_id",
                                                   "timezone")},
            })
            existing.add(email)
            added += 1
    return {"enrolled": added, "skipped": skipped}


# ------------------------------------------------------------------ bounce guard
async def bounce_stats(mailbox_id: str) -> tuple[int, int]:
    sent = len(await _msgs.find(_msgs.model.mailbox_id == mailbox_id, _msgs.model.direction == "out"))
    hard = len([m for m in await _msgs.find(_msgs.model.mailbox_id == mailbox_id, _msgs.model.direction == "bounce")
                if m.get("hard")])
    return sent, hard


async def check_auto_pause(mailbox_id: str) -> bool:
    """Pause the mailbox when its hard-bounce rate passes the threshold (needs a minimum sample). True if paused."""
    sent, hard = await bounce_stats(mailbox_id)
    if sent >= p3_settings.bounce_pause_min_sent and hard / sent > p3_settings.bounce_pause_threshold:
        await _boxes.update(mailbox_id, {"paused": True, "pause_reason": f"hard bounce rate {hard / sent:.1%}"})
        logger.warning("Mailbox %s auto-paused: %d hard bounces of %d sent", mailbox_id, hard, sent)
        return True
    return False


# ------------------------------------------------------------------ sending
def unsubscribe_url(owner_id: str, enrollment_id: str, email: str) -> str:
    token = logic.sign_token("unsub", {"o": owner_id, "e": enrollment_id, "m": email})
    return f"{p3_settings.public_api_url}/api/public/unsubscribe/{token}"


def compliance_footer(unsub: str) -> tuple[str, str]:
    """(plain text, html) footer on every outreach email: the signed unsubscribe link and the sender's postal address.

    One mechanism only: the Phase 3 signed one-click link (stops the sequence and adds a suppression). The Phase 2
    `compliance.optout.optout_url` points at the web opt-out page used by the compliance tools, not by sequences.
    """
    address = p3_settings.postal_address
    text = f"\n\n--\nDon't want these emails? Unsubscribe: {unsub}\n{address}"
    markup = (f"<p style='color:#6b7280;font-size:12px'><a href='{html.escape(unsub)}'>Unsubscribe</a><br>"
              f"{html.escape(address)}</p>")
    return text, markup


def build_message(box: dict, seq: dict, enr: dict, step_index: int, prev_message_id: str | None, base_subject: str) -> EmailMessage:
    values = logic.build_vars({**(enr.get("contact") or {}), "email": enr["email"]}, box.get("from_name") or "")
    step = seq["steps"][step_index]
    subject = logic.render(step["subject"] or f"Re: {base_subject}", values)
    body = logic.render(step["body"], values)
    unsub = unsubscribe_url(enr["user_id"], enr["_id"], enr["email"])
    msg = EmailMessage()
    msg["From"] = formataddr((box.get("from_name") or "", box["email"]))
    msg["To"] = enr["email"]
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=box["email"].split("@")[-1])
    msg["Date"] = formatdate(localtime=False)
    if prev_message_id:
        msg["In-Reply-To"] = prev_message_id
        msg["References"] = prev_message_id
    msg["List-Unsubscribe"] = f"<{unsub}>, <mailto:{box['email']}?subject=unsubscribe>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    footer_text, footer_html = compliance_footer(unsub)
    msg.set_content(f"{body}{footer_text}")
    pixel = ""
    if seq.get("track_opens"):
        tok = logic.sign_token("open", {"e": enr["_id"], "s": step_index})
        pixel = f'<img src="{p3_settings.public_api_url}/api/public/o/{tok}.gif" width="1" height="1" alt="">'
    msg.add_alternative(
        f"<div style='white-space:pre-wrap'>{html.escape(body)}</div>{footer_html}{pixel}",
        subtype="html",
    )
    return msg


async def _emit(owner_id: str, event: str, payload: dict) -> None:
    try:
        from app.integrations.webhooks import emit

        await emit(owner_id, event, payload)
    except Exception:  # noqa: BLE001 - webhooks must never break sending
        logger.exception("webhook emit failed for %s", event)


async def run_due(now: datetime | None = None, limit: int = 200) -> dict:
    """Send every enrollment whose time has come, honouring windows, caps, suppression and pauses."""
    now = now or datetime.utcnow()
    due = await _enr.find(_enr.model.status == ACTIVE, _enr.model.next_send_at <= now,
                          order_by=_enr.model.next_send_at, limit=limit)
    stats = {"sent": 0, "deferred": 0, "skipped": 0, "failed": 0}
    seqs: dict[str, dict | None] = {}
    boxes: dict[str, dict | None] = {}
    sent_today: dict[str, int] = {}
    for enr in due:
        sid = enr["sequence_id"]
        if sid not in seqs:
            seqs[sid] = await _seqs.get(_id=sid)
        seq = seqs[sid]
        if not seq or seq.get("status") != ACTIVE:
            continue  # paused/draft sequences simply wait
        bid = seq.get("mailbox_id")
        if bid not in boxes:
            boxes[bid] = await _boxes.get(_id=bid) if bid else None
        box = boxes[bid]
        if not box or box.get("paused"):
            continue
        if await deps.is_suppressed(enr["user_id"], enr["email"]):
            await _enr.update(enr["_id"], {"status": "suppressed"})
            stats["skipped"] += 1
            continue
        tz = (enr.get("contact") or {}).get("timezone") or seq.get("timezone")
        slot = logic.next_window_slot(now, tz, seq["window_start"], seq["window_end"], seq["days"])
        if slot > now:
            await _enr.update(enr["_id"], {"next_send_at": slot})
            stats["deferred"] += 1
            continue
        if bid not in sent_today:
            since = logic.start_of_local_day(now, box.get("timezone"))
            sent_today[bid] = len(await _msgs.find(_msgs.model.mailbox_id == bid, _msgs.model.direction == "out",
                                                   _msgs.model.created_at >= since))
        limit_today = logic.daily_limit(int(box.get("daily_cap") or 40), bool(box.get("warmup")),
                                        box.get("warmup_started_at"), now)
        if sent_today[bid] >= limit_today:
            tomorrow = logic.start_of_local_day(now, box.get("timezone")) + timedelta(days=1, minutes=1)
            await _enr.update(enr["_id"], {"next_send_at": logic.next_window_slot(
                tomorrow, tz, seq["window_start"], seq["window_end"], seq["days"])})
            stats["deferred"] += 1
            continue
        if await check_auto_pause(bid):
            boxes[bid] = await _boxes.get(_id=bid)
            continue
        result = await _send_step(box, seq, enr, now)
        stats[result] += 1
        if result == "sent":
            sent_today[bid] += 1
    return stats


async def _send_step(box: dict, seq: dict, enr: dict, now: datetime) -> str:
    idx = int(enr.get("step_index") or 0)
    base_subject = logic.render(seq["steps"][0]["subject"],
                                logic.build_vars({**(enr.get("contact") or {}), "email": enr["email"]}))
    msg = build_message(box, seq, enr, idx, enr.get("last_message_id"), base_subject)
    try:
        await ports.smtp.send(mailbox_creds(box), msg)
    except SendError as exc:
        attempts = int(enr.get("attempts") or 0) + 1
        if exc.permanent or attempts >= MAX_ATTEMPTS:
            await _enr.update(enr["_id"], {"status": "failed", "attempts": attempts, "last_error": str(exc)[:300]})
            if exc.permanent:
                await _msgs.insert({"enrollment_id": enr["_id"], "mailbox_id": box["_id"], "direction": "bounce",
                                    "message_id": None, "hard": True, "step": idx, "reason": "smtp_rejected",
                                    "created_at": now, "user_id": enr["user_id"]})
                await deps.add_suppression(enr["user_id"], enr["email"], "hard_bounce", "smtp_reject")
                await check_auto_pause(box["_id"])
            return "failed"
        await _enr.update(enr["_id"], {"attempts": attempts, "last_error": str(exc)[:300],
                                       "next_send_at": now + timedelta(minutes=15 * attempts)})
        return "failed"
    mid = msg["Message-ID"]
    await _msgs.insert({"enrollment_id": enr["_id"], "mailbox_id": box["_id"], "message_id": mid, "direction": "out",
                        "step": idx, "subject": msg["Subject"], "created_at": now, "user_id": enr["user_id"]})
    nxt = idx + 1
    fields: dict = {"step_index": nxt, "last_message_id": mid, "attempts": 0, "last_sent_at": now}
    if nxt >= len(seq["steps"]):
        fields["status"] = "completed"
    else:
        fields["next_send_at"] = now + timedelta(days=seq["steps"][nxt]["delay_days"])
    await _enr.update(enr["_id"], fields)
    return "sent"


# ------------------------------------------------------------------ control + stats
async def set_sequence_status(user_id: str, seq_id: str, status: str) -> dict:
    seq = await get_owned(_seqs, seq_id, user_id)
    if status == ACTIVE:
        if not seq.get("mailbox_id"):
            raise OutreachError("choose a mailbox before starting")
        box = await _boxes.get(_id=seq["mailbox_id"])
        if not box or box.get("paused"):
            raise OutreachError("the mailbox is paused or missing")
    return await _seqs.update(seq_id, {"status": status})


async def stop_enrollments_for(user_id: str, email: str, status: str) -> int:
    n = 0
    for e in await _enr.find(_enr.model.user_id == user_id, _enr.model.email == email.lower()):
        if e["status"] == ACTIVE:
            await _enr.update(e["_id"], {"status": status, "stopped_at": datetime.utcnow()})
            n += 1
    return n


async def sequence_stats(seq: dict) -> dict:
    enrollments = await _enr.find(_enr.model.sequence_id == seq["_id"])
    by_id = {e["_id"] for e in enrollments}
    msgs = await _msgs.find(_msgs.model.enrollment_id.in_(list(by_id))) if by_id else []
    steps = [{"step": i + 1, "sent": 0, "replies": 0, "bounces": 0, "unsubscribes": 0, "opens": 0}
             for i in range(len(seq["steps"]))]
    contacted = set()
    for m in msgs:
        i = int(m.get("step") or 0)
        if i >= len(steps):
            continue
        d = m["direction"]
        if d == "out":
            steps[i]["sent"] += 1
            contacted.add(m["enrollment_id"])
        elif d == "reply":
            steps[i]["replies"] += 1
        elif d == "bounce":
            steps[i]["bounces"] += 1
        elif d == "unsubscribe":
            steps[i]["unsubscribes"] += 1
        elif d == "open":
            steps[i]["opens"] += 1
    for s in steps:
        s["reply_rate"] = round(s["replies"] / s["sent"], 4) if s["sent"] else 0.0
    replied = sum(s["replies"] for s in steps)
    status_counts: dict[str, int] = {}
    for e in enrollments:
        status_counts[e["status"]] = status_counts.get(e["status"], 0) + 1
    return {
        "enrolled": len(enrollments), "contacted": len(contacted), "replies": replied,
        "reply_rate": round(replied / len(contacted), 4) if contacted else 0.0,
        "bounces": sum(s["bounces"] for s in steps), "unsubscribes": sum(s["unsubscribes"] for s in steps),
        "opens": sum(s["opens"] for s in steps) if seq.get("track_opens") else None,
        "statuses": status_counts, "steps": steps,
    }
