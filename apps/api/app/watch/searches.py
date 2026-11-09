"""Saved searches over a user's leads, with email + Slack alerts when new matches or signals appear."""
from __future__ import annotations

from datetime import datetime

from app.core.logger import logger
from app.core.security_crypto import decrypt_secret, encrypt_secret
from app.db.models import TABLES
from app.watch import signals
from app.watch.ports import ports, slack_body

_searches = TABLES["saved_searches"]
_leads = TABLES["leads"]
_users = TABLES["users"]

SLACK_PREFIX = "https://hooks.slack.com/"


class SearchError(ValueError):
    pass


def public(doc: dict) -> dict:
    out = {k: (v.isoformat() + "Z" if isinstance(v, datetime) else v) for k, v in doc.items()
           if k not in ("slack_webhook_enc", "seen_ids")}
    out["has_slack"] = bool(doc.get("slack_webhook_enc"))
    out["seen_count"] = len(doc.get("seen_ids") or [])
    return out


async def matching_leads(user_id: str, q: dict) -> list[dict]:
    rows = await _leads.find(_leads.model.user_id == user_id, limit=5000)
    text = (q.get("text") or "").strip().lower()
    min_score = float(q.get("min_score") or 0)
    kinds = q.get("signal_kinds") or []
    sig_domains: set[str] = set()
    if kinds:
        sig_domains = {s["domain"] for s in await signals.recent_signals(user_id, days=int(q.get("signal_days") or 14))
                       if s["kind"] in kinds}
    out = []
    for lead in rows:
        if q.get("request_id") and lead.get("request_id") != q["request_id"]:
            continue
        if (lead.get("match_score") or 0) < min_score:
            continue
        hay = f"{lead.get('title', '')} {lead.get('snippet', '')} {lead.get('url', '')}".lower()
        if text and text not in hay:
            continue
        if kinds and signals.domain_of(lead.get("url") or "") not in sig_domains:
            continue
        out.append(lead)
    return out


async def save_search(user_id: str, data: dict, search_id: str | None = None) -> dict:
    name = (data.get("name") or "").strip()
    slack = data.get("slack_webhook_url")
    if slack and not slack.startswith(SLACK_PREFIX):
        raise SearchError("Slack URL must be an incoming-webhook URL (https://hooks.slack.com/...)")
    fields: dict = {}
    if name:
        fields["name"] = name
    if data.get("query") is not None:
        fields["query"] = data["query"]
    if data.get("email_alerts") is not None:
        fields["email_alerts"] = bool(data["email_alerts"])
    if slack is not None:
        fields["slack_webhook_enc"] = encrypt_secret(slack) if slack else None
    if search_id:
        if not await _searches.get(_id=search_id, user_id=user_id):
            raise LookupError("search not found")
        return public(await _searches.update(search_id, fields))
    if not name:
        raise SearchError("name is required")
    query = fields.setdefault("query", {})
    # Seed with current matches so enabling alerts doesn't announce everything that already exists.
    seen = [m["_id"] for m in await matching_leads(user_id, query)]
    doc = {"email_alerts": True, **fields, "user_id": user_id, "seen_ids": seen, "created_at": datetime.utcnow(),
           "last_run_at": None, "last_error": None}
    doc["_id"] = await _searches.insert(doc)
    return public(doc)


async def run_search(search: dict, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    uid = search["user_id"]
    matches = await matching_leads(uid, search.get("query") or {})
    seen = set(search.get("seen_ids") or [])
    new = [m for m in matches if m["_id"] not in seen]
    result = {"matches": len(matches), "new": len(new), "alerted": []}
    error = None
    if new:
        lines = [f"- {m.get('title') or m.get('url')} ({m.get('url', '')})" for m in new[:10]]
        text = f"{len(new)} new match(es) for saved search '{search['name']}':\n" + "\n".join(lines)
        if len(new) > 10:
            text += f"\n...and {len(new) - 10} more"
        if search.get("email_alerts", True):
            user = await _users.get(_id=uid)
            if user and user.get("email"):
                try:
                    await ports.email.send(user["email"], f"Quarry alert: {len(new)} new for '{search['name']}'", text)
                    result["alerted"].append("email")
                except Exception as exc:  # noqa: BLE001
                    error = f"email: {exc}"
                    logger.warning("alert email failed: %s", exc)
        if search.get("slack_webhook_enc"):
            url = decrypt_secret(search["slack_webhook_enc"])
            try:
                status = await ports.slack.post(url, slack_body(text), {"Content-Type": "application/json"})
                if 200 <= status < 300:
                    result["alerted"].append("slack")
                else:
                    error = f"slack: HTTP {status}"
            except Exception as exc:  # noqa: BLE001
                error = f"slack: {exc}"
        try:
            from app.integrations.webhooks import emit

            await emit(uid, "alert.saved_search", {"search": search["name"], "new": len(new),
                                                   "lead_ids": [m["_id"] for m in new[:50]]})
        except Exception:  # noqa: BLE001
            logger.exception("alert webhook emit failed")
    # Only mark as seen if the alert went out (or there was nothing to send to), so a failed send retries.
    delivered = bool(result["alerted"]) or not (search.get("email_alerts", True) or search.get("slack_webhook_enc"))
    fields = {"last_run_at": now, "last_error": error, "last_new": len(new)}
    if not new or delivered:
        fields["seen_ids"] = sorted(seen | {m["_id"] for m in matches})
    await _searches.update(search["_id"], fields)
    return result


async def run_all(now: datetime | None = None) -> int:
    n = 0
    for s in await _searches.find():
        await run_search(s, now)
        n += 1
    return n
