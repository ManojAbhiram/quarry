"""Pure outreach helpers: personalization, send windows, warmup ramp, signed tokens. No I/O."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import re
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.config import settings

# ------------------------------------------------------------------ personalization
KNOWN_VARS = {"first_name", "last_name", "name", "title", "company", "email", "domain", "sender_name"}
_VAR = re.compile(r"\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?))?\s*\}\}")


def template_vars(text: str) -> set[str]:
    return {m.group(1) for m in _VAR.finditer(text or "")}


def unknown_vars(text: str) -> set[str]:
    return template_vars(text) - KNOWN_VARS


def build_vars(contact: dict, sender_name: str = "") -> dict[str, str]:
    name = (contact.get("name") or "").strip()
    first, _, last = name.partition(" ")
    email = (contact.get("email") or "").strip()
    return {
        "first_name": contact.get("first_name") or first,
        "last_name": contact.get("last_name") or last,
        "name": name,
        "title": contact.get("title") or "",
        "company": contact.get("company") or "",
        "email": email,
        "domain": email.split("@")[-1] if "@" in email else "",
        "sender_name": sender_name,
    }


def render(text: str, values: dict[str, str]) -> str:
    """`{{first_name|there}}` falls back to "there" when the value is empty. Unknown/empty without fallback -> ''."""

    def sub(m: re.Match) -> str:
        val = (values.get(m.group(1)) or "").strip()
        return val if val else (m.group(2) or "").strip()

    return _VAR.sub(sub, text or "")


def missing_values(text: str, values: dict[str, str]) -> list[str]:
    """Variables used with no fallback whose value is empty (the preview warns about these)."""
    out = []
    for m in _VAR.finditer(text or ""):
        if m.group(1) in KNOWN_VARS and not (values.get(m.group(1)) or "").strip() and m.group(2) is None:
            out.append(m.group(1))
    return sorted(set(out))


# ------------------------------------------------------------------ time
def get_tz(name: str | None) -> ZoneInfo | timezone:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return timezone.utc


def _parse_hm(value: str, default: time) -> time:
    try:
        h, m = value.split(":")
        return time(int(h), int(m))
    except (ValueError, AttributeError):
        return default


def next_window_slot(now_utc: datetime, tz_name: str | None, start: str = "09:00", end: str = "17:00",
                     days: list[int] | None = None) -> datetime:
    """Earliest naive-UTC time >= now_utc that falls inside the window (local tz, allowed weekdays 0=Mon)."""
    days = days if days else [0, 1, 2, 3, 4]
    tz = get_tz(tz_name)
    t_start, t_end = _parse_hm(start, time(9)), _parse_hm(end, time(17))
    local = now_utc.replace(tzinfo=timezone.utc).astimezone(tz)
    for offset in range(0, 9):
        day = (local + timedelta(days=offset)).date()
        if day.weekday() not in days:
            continue
        open_dt = datetime.combine(day, t_start, tzinfo=tz)
        close_dt = datetime.combine(day, t_end, tzinfo=tz)
        candidate = max(local, open_dt)
        if candidate < close_dt:
            return candidate.astimezone(timezone.utc).replace(tzinfo=None)
    return now_utc + timedelta(days=1)


def in_window(now_utc: datetime, tz_name: str | None, start: str, end: str, days: list[int] | None) -> bool:
    return next_window_slot(now_utc, tz_name, start, end, days) == now_utc


def start_of_local_day(now_utc: datetime, tz_name: str | None) -> datetime:
    tz = get_tz(tz_name)
    local = now_utc.replace(tzinfo=timezone.utc).astimezone(tz)
    midnight = datetime.combine(local.date(), time(0), tzinfo=tz)
    return midnight.astimezone(timezone.utc).replace(tzinfo=None)


# ------------------------------------------------------------------ warmup
def daily_limit(cap: int, warmup: bool, warmup_started: datetime | None, now: datetime,
                start: int = 5, growth: float = 1.3) -> int:
    """Sends allowed per day: the flat cap, or a geometric ramp from `start` toward the cap during warmup."""
    if not warmup or warmup_started is None:
        return cap
    days = max(0, (now.date() - warmup_started.date()).days)
    return max(1, min(cap, math.ceil(start * growth ** days)))


# ------------------------------------------------------------------ signed tokens
def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def sign_token(purpose: str, payload: dict) -> str:
    body = _b64(json.dumps({"p": purpose, **payload}, separators=(",", ":")).encode())
    sig = hmac.new(settings.SECRET_KEY.encode(), f"{purpose}.{body}".encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(sig)[:32]}"


def verify_token(purpose: str, token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
        expected = _b64(hmac.new(settings.SECRET_KEY.encode(), f"{purpose}.{body}".encode(), hashlib.sha256).digest())[:32]
        if not hmac.compare_digest(sig, expected):
            return None
        data = json.loads(_unb64(body))
        return data if data.get("p") == purpose else None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
