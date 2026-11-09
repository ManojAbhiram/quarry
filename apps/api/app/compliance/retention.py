"""Retention: delete rejected and expired leads (and the people in them) after 30 days.

A lead is purged when
  - it was rejected (`rejected_at`) at least RETENTION_DAYS ago, or
  - its `expires_at` has passed, or
  - it is an un-enriched search result (never promoted to a lead) older than RETENTION_DAYS and in no list.

Run it for everyone from the command line (cron or a scheduler):

    python -m app.compliance.retention [--days 30] [--dry-run]

or for one user through POST /api/compliance/retention/run.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timedelta

from sqlalchemy import select

from app.compliance import audit
from app.core.logger import logger
from app.db import engine as _engine
from app.db.erasure import _delete_leads
from app.db.models import TABLES, Lead, LeadListItem

RETENTION_DAYS = 30
_leads = TABLES["leads"]


def _as_dt(v) -> datetime | None:
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return d.replace(tzinfo=None) if d.tzinfo else d
        except ValueError:
            return None
    return None


def _due(lead: dict, cutoff: datetime, now: datetime, in_list: set[str]) -> str | None:
    rejected = _as_dt(lead.get("rejected_at"))
    if rejected and rejected <= cutoff:
        return "rejected"
    expires = _as_dt(lead.get("expires_at"))
    if expires and expires <= now:
        return "expired"
    created = _as_dt(lead.get("created_at"))
    if lead.get("enrichment_status") != "enriched" and created and created <= cutoff and lead["_id"] not in in_list:
        return "unpromoted"
    return None


async def purge_stale_leads(owner_id: str | None = None, days: int = RETENTION_DAYS, now: datetime | None = None,
                            dry_run: bool = False) -> dict:
    """Delete due leads. Returns {"leads_deleted": n, "by_reason": {...}, "dry_run": bool}."""
    now = now or datetime.utcnow()
    cutoff = now - timedelta(days=days)
    where = [Lead.user_id == str(owner_id)] if owner_id else []
    leads = await _leads.find(*where)

    async with _engine.read_session() as s, s.begin():
        in_list = set((await s.execute(select(LeadListItem.lead_id))).scalars())

    due: dict[str, list[str]] = {}  # owner -> lead ids
    by_reason: dict[str, int] = {}
    for lead in leads:
        reason = _due(lead, cutoff, now, in_list)
        if reason:
            due.setdefault(str(lead.get("user_id")), []).append(lead["_id"])
            by_reason[reason] = by_reason.get(reason, 0) + 1

    total = sum(len(v) for v in due.values())
    if not dry_run:
        for owner, ids in due.items():
            async with _engine.session() as s, s.begin():
                await _delete_leads(s, ids)
            await audit.record(owner, "retention_purge", None, leads_deleted=len(ids), days=days)
    logger.info("Retention purge: %d lead(s) %s", total, "would be deleted" if dry_run else "deleted")
    return {"leads_deleted": total, "by_reason": by_reason, "dry_run": dry_run}


async def reject_lead(owner_id: str, lead_id: str, now: datetime | None = None) -> bool:
    """Mark a lead rejected; it is deleted RETENTION_DAYS later. Returns False if the lead is not the owner's."""
    lead = await _leads.get(_id=str(lead_id), user_id=str(owner_id))
    if not lead:
        return False
    await _leads.update(lead["_id"], {"rejected_at": now or datetime.utcnow()})
    return True


async def restore_lead(owner_id: str, lead_id: str) -> bool:
    lead = await _leads.get(_id=str(lead_id), user_id=str(owner_id))
    if not lead:
        return False
    await _leads.update(lead["_id"], {"rejected_at": None})
    return True


async def _main(days: int, dry_run: bool) -> None:
    await _engine.connect_db()
    try:
        print(await purge_stale_leads(days=days, dry_run=dry_run))
    finally:
        await _engine.close_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Delete rejected and expired leads past the retention window.")
    parser.add_argument("--days", type=int, default=RETENTION_DAYS)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(_main(args.days, args.dry_run))
