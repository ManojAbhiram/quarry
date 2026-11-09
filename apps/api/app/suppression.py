"""Workspace-wide suppression ledger: addresses and domains that must never be contacted or exported.

Stable interface (Phase 3 outreach imports it):

    await is_suppressed(owner_id, email) -> bool
    await add_suppression(owner_id, email_or_domain, reason, source) -> dict
    await list_suppressions(owner_id) -> list[dict]
    await remove_suppression(owner_id, email_or_domain_or_id) -> bool

An entry is either an exact email address or a domain. A domain entry also covers its subdomains
(`acme.com` suppresses `jane@eng.acme.com`). Matching is case-insensitive.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable
from urllib.parse import urlparse

from app.db.models import TABLES
from app.db.models_trust import Suppression

_table = TABLES["suppressions"]

SOURCES = ("manual", "opt_out", "erasure", "bounce", "import", "complaint")


def normalize(value: str) -> tuple[str, str]:
    """('email' | 'domain', normalized value). Raises ValueError for blank or malformed input."""
    v = (value or "").strip().lower()
    if not v:
        raise ValueError("Enter an email address or a domain.")
    if "@" in v and "//" not in v:
        local, _, domain = v.rpartition("@")
        if not local:  # '@acme.com' means the whole domain
            return "domain", _clean_domain(domain)
        domain = _clean_domain(domain)
        if "." not in domain:
            raise ValueError("That does not look like an email address.")
        return "email", f"{local}@{domain}"
    return "domain", _clean_domain(v)


def _clean_domain(value: str) -> str:
    v = value.strip().lower()
    host = urlparse(v if "//" in v else "//" + v).hostname or ""
    host = host.removeprefix("www.").strip(".")
    if not host or "." not in host or " " in host:
        raise ValueError("That does not look like a domain (for example acme.com).")
    return host


def _domain_chain(domain: str) -> list[str]:
    """acme.co.uk -> ['acme.co.uk', 'co.uk']; sub.acme.com -> ['sub.acme.com', 'acme.com']."""
    parts = domain.split(".")
    return [".".join(parts[i:]) for i in range(len(parts) - 1)]


class SuppressionMatcher:
    """An owner's ledger loaded once, for checking many addresses (exports) without a query each."""

    def __init__(self, values: Iterable[str]):
        self._values = {v.lower() for v in values}

    def matches(self, email_or_url: str | None) -> bool:
        if not email_or_url:
            return False
        try:
            kind, value = normalize(email_or_url)
        except ValueError:
            return False
        if kind == "email" and value in self._values:
            return True
        domain = value.rsplit("@", 1)[-1] if kind == "email" else value
        return any(d in self._values for d in _domain_chain(domain))

    def __len__(self) -> int:
        return len(self._values)


async def load_matcher(owner_id: str) -> SuppressionMatcher:
    rows = await _table.find(Suppression.owner_id == str(owner_id))
    return SuppressionMatcher(r["value"] for r in rows)


async def is_suppressed(owner_id: str, email: str) -> bool:
    """True if `email` (or its domain, or a parent domain) is on the owner's ledger."""
    if not email:
        return False
    return (await load_matcher(owner_id)).matches(email)


async def add_suppression(owner_id: str, email_or_domain: str, reason: str = "", source: str = "manual") -> dict:
    """Add an email or domain. Idempotent: adding an existing entry returns it unchanged."""
    kind, value = normalize(email_or_domain)
    existing = await _table.get(owner_id=str(owner_id), value=value)
    if existing:
        return existing
    doc = {
        "owner_id": str(owner_id), "value": value, "kind": kind,
        "reason": (reason or "").strip()[:300], "source": source if source in SOURCES else "manual",
        "created_at": datetime.utcnow(),
    }
    doc["_id"] = await _table.insert(doc)
    return doc


async def list_suppressions(owner_id: str) -> list[dict]:
    rows = await _table.find(Suppression.owner_id == str(owner_id))
    return sorted(rows, key=lambda r: r.get("created_at") or datetime.min, reverse=True)


async def remove_suppression(owner_id: str, email_or_domain_or_id: str) -> bool:
    """Remove by entry id, or by the email/domain value. Only ever touches the owner's own entries."""
    key = (email_or_domain_or_id or "").strip()
    if not key:
        return False
    row = await _table.get(_id=key, owner_id=str(owner_id))
    if row is None:
        try:
            _, value = normalize(key)
        except ValueError:
            return False
        row = await _table.get(owner_id=str(owner_id), value=value)
    if row is None:
        return False
    return await _table.delete(row["_id"])
