"""Erase one person's data from everything an owner has collected, looked up by email address.

Decision-maker records for that address are deleted. A lead whose company contact email is that address keeps the
company but loses the email, its verification status, its provenance and the contact name/title in its enrichment.
The address is added to the suppression ledger (unless told not to) so it is not collected or contacted again, and
the action is written to the audit log without the raw address.
"""
from __future__ import annotations

from sqlalchemy import delete, select

from app import suppression
from app.compliance import audit
from app.db import engine as _engine
from app.db.models import DecisionMaker, Lead, LeadEnrichment

_LEAD_EMAIL_FIELDS = {
    "email": None, "email_status": None, "email_checked_at": None, "email_status_reason": None,
    "email_catch_all": None, "email_verified": None, "email_confidence": None,
    "email_verify_method": None, "email_verify_reason": None,
}


async def erase_person_by_email(owner_id: str, email: str, actor_id: str | None = None, add_to_suppression: bool = True) -> dict:
    kind, value = suppression.normalize(email)
    if kind != "email":
        raise ValueError("Enter the person's full email address.")
    owner_id = str(owner_id)

    async with _engine.session() as s, s.begin():
        lead_rows = (await s.execute(select(Lead).where(Lead.user_id == owner_id))).scalars().all()
        lead_ids = [r.id for r in lead_rows]
        dm_ids: list[str] = []
        if lead_ids:
            dms = (await s.execute(select(DecisionMaker).where(DecisionMaker.lead_id.in_(lead_ids)))).scalars().all()
            dm_ids = [d.id for d in dms if str((d.data or {}).get("email") or "").strip().lower() == value]
        if dm_ids:
            await s.execute(delete(DecisionMaker).where(DecisionMaker.id.in_(dm_ids)))

        leads_cleared = 0
        cleared_lead_ids: list[str] = []
        for row in lead_rows:
            data = dict(row.data or {})
            if str(data.get("email") or "").strip().lower() != value:
                continue
            data.update(_LEAD_EMAIL_FIELDS)
            prov = dict(data.get("provenance") or {})
            for f in ("email", "contact_email"):
                prov.pop(f, None)
            data["provenance"] = prov
            row.data = data
            cleared_lead_ids.append(row.id)
            leads_cleared += 1

        enrichments_cleared = 0
        if cleared_lead_ids:
            for enr in (await s.execute(select(LeadEnrichment).where(LeadEnrichment.lead_id.in_(cleared_lead_ids)))).scalars():
                enr.data = {**(enr.data or {}), "contact_name": None, "contact_title": None}
                enrichments_cleared += 1

    counts = {"decision_makers_deleted": len(dm_ids), "leads_email_cleared": leads_cleared, "enrichments_cleared": enrichments_cleared}
    if add_to_suppression:
        await suppression.add_suppression(owner_id, value, "Erasure request", "erasure")
    entry = await audit.record(
        owner_id, "erase_person", actor_id,
        subject_hash=audit.subject_hash(value), subject_masked=audit.mask_email(value),
        suppressed=add_to_suppression, **counts,
    )
    return {**counts, "suppressed": add_to_suppression, "audit_id": entry["_id"]}

