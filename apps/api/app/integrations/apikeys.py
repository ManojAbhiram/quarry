"""Public API keys: only a SHA-256 hash is stored; the plaintext is shown once. Scoped and revocable."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime

from fastapi import Depends, Header, HTTPException

from app.db.models import TABLES

_keys = TABLES["api_keys"]

SCOPES = ("read:requests", "read:leads", "read:lists")
PREFIX = "qk_"


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def public(doc: dict) -> dict:
    return {k: (v.isoformat() + "Z" if isinstance(v, datetime) else v) for k, v in doc.items() if k != "key_hash"}


async def create_key(user_id: str, name: str, scopes: list[str]) -> tuple[dict, str]:
    bad = [s for s in scopes if s not in SCOPES]
    if bad or not scopes:
        raise ValueError(f"scopes must be a non-empty subset of {', '.join(SCOPES)}")
    key = PREFIX + secrets.token_urlsafe(32)
    doc = {"user_id": user_id, "name": name.strip() or "API key", "scopes": sorted(set(scopes)),
           "key_hash": hash_key(key), "prefix": key[:10], "created_at": datetime.utcnow(), "revoked_at": None,
           "last_used_at": None}
    doc["_id"] = await _keys.insert(doc)
    return public(doc), key


async def revoke_key(user_id: str, key_id: str) -> bool:
    doc = await _keys.get(_id=key_id, user_id=user_id)
    if not doc:
        return False
    await _keys.update(key_id, {"revoked_at": datetime.utcnow()})
    return True


async def authenticate(key: str) -> dict | None:
    if not key.startswith(PREFIX):
        return None
    doc = await _keys.get(key_hash=hash_key(key))
    if not doc or doc.get("revoked_at"):
        return None
    await _keys.update(doc["_id"], {"last_used_at": datetime.utcnow()})
    return doc


def require_scope(scope: str):
    async def dep(authorization: str | None = Header(None), x_api_key: str | None = Header(None)) -> dict:
        key = x_api_key or (authorization[7:] if authorization and authorization.lower().startswith("bearer ") else "")
        doc = await authenticate(key.strip()) if key else None
        if not doc:
            raise HTTPException(401, "Invalid or revoked API key", headers={"WWW-Authenticate": "Bearer"})
        if scope not in doc.get("scopes", []):
            raise HTTPException(403, f"API key lacks the '{scope}' scope")
        return doc

    return Depends(dep)
