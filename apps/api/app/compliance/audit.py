"""Append-only audit log for compliance actions. It never stores the raw email of an erased person."""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime

from app.core.config import settings
from app.db.models import TABLES
from app.db.models_trust import AuditLog

_table = TABLES["audit_log"]


def subject_hash(email: str) -> str:
    """Keyed hash so the log can prove 'this address was erased' without being a list of addresses."""
    return hmac.new(settings.SECRET_KEY.encode(), email.strip().lower().encode(), hashlib.sha256).hexdigest()


def mask_email(email: str) -> str:
    local, _, domain = (email or "").partition("@")
    return (local[:1] + "***@" + domain) if domain else "***"


async def record(owner_id: str, action: str, actor_id: str | None = None, **details) -> dict:
    doc = {
        "owner_id": str(owner_id), "action": action, "actor_id": str(actor_id or owner_id),
        "details": details, "created_at": datetime.utcnow(),
    }
    doc["_id"] = await _table.insert(doc)
    return doc


async def list_entries(owner_id: str, limit: int = 200) -> list[dict]:
    rows = await _table.find(AuditLog.owner_id == str(owner_id), order_by=AuditLog.created_at.desc(), limit=limit)
    return rows
