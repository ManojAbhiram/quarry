"""Signed opt-out links. The token proves the link was issued by this workspace for that owner and address.

Phase 3 outreach puts `optout_url(owner_id, email)` in every message footer. Following it needs no login.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app import suppression
from app.core.config import settings

_PURPOSE = "optout"
TOKEN_DAYS = 365 * 2


def make_token(owner_id: str, email: str) -> str:
    _, value = suppression.normalize(email)
    claims = {
        "purpose": _PURPOSE, "owner": str(owner_id), "email": value,
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS),
    }
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def read_token(token: str) -> tuple[str, str] | None:
    """(owner_id, email) for a valid opt-out token, else None. Login tokens do not validate here (no purpose claim)."""
    try:
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        return None
    if claims.get("purpose") != _PURPOSE or not claims.get("owner") or not claims.get("email"):
        return None
    return str(claims["owner"]), str(claims["email"])


def optout_url(owner_id: str, email: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/opt-out?token={make_token(owner_id, email)}"
