"""Billing persistence: subscriptions, the credit ledger, usage and invoices.

A billing "scope" is the id that owns a plan: an organization id, or `user:<id>` for a personal workspace.
"""
from datetime import datetime
from typing import Optional

from sqlalchemy.exc import IntegrityError

from app.billing.plans import REQUEST_CREDIT_COST, Plan, get_plan
from app.db.growth_models import CreditEntry, Invoice
from app.db.models import TABLES


def personal_scope(user_id) -> str:
    return f"user:{user_id}"


def period_key(now: Optional[datetime] = None) -> str:
    return (now or datetime.utcnow()).strftime("%Y-%m")


def period_start(now: Optional[datetime] = None) -> datetime:
    n = now or datetime.utcnow()
    return datetime(n.year, n.month, 1)


ACTIVE_STATUSES = {"active", "trialing", "past_due"}


async def get_subscription(scope_id: str) -> Optional[dict]:
    return await TABLES["subscriptions"].get(scope_id=scope_id)


async def get_plan_for_scope(scope_id: str) -> Plan:
    sub = await get_subscription(scope_id)
    if sub and sub.get("status") in ACTIVE_STATUSES:
        return get_plan(sub.get("plan"))
    return get_plan(None)


async def upsert_subscription(scope_id: str, fields: dict) -> str:
    return await TABLES["subscriptions"].upsert({"scope_id": scope_id}, {**fields, "updated_at": datetime.utcnow()})


# -- credit ledger ---------------------------------------------------------------------------------------------

async def _add_entry(scope_id: str, kind: str, amount: int, ref: Optional[str] = None, note: str = "") -> bool:
    """Append a ledger row. Returns False (and writes nothing) when `ref` was already recorded."""
    doc = {"scope_id": scope_id, "kind": kind, "amount": amount, "note": note, "created_at": datetime.utcnow()}
    if ref:
        doc["ref"] = ref
    try:
        await TABLES["credit_ledger"].insert(doc)
    except IntegrityError:
        return False
    return True


async def credit_balance(scope_id: str) -> int:
    rows = await TABLES["credit_ledger"].find(CreditEntry.scope_id == scope_id)
    return sum(int(r.get("amount", 0)) for r in rows)


async def ensure_period_grant(scope_id: str, plan: Plan) -> bool:
    """Grant the plan's monthly credits once per (scope, month, plan). Idempotent."""
    ref = f"grant:{scope_id}:{period_key()}:{plan.id}"
    return await _add_entry(scope_id, "grant", plan.credits_per_month, ref=ref, note=f"{plan.name} monthly credits")


async def debit_credits(scope_id: str, amount: int, kind: str, ref: Optional[str] = None, note: str = "") -> bool:
    return await _add_entry(scope_id, kind, -abs(amount), ref=ref, note=note)


async def usage_this_period(scope_id: str) -> dict:
    start = period_start()
    rows = await TABLES["credit_ledger"].find(CreditEntry.scope_id == scope_id, CreditEntry.created_at >= start)
    requests_created = sum(1 for r in rows if r.get("kind") == "request_created")
    spent = sum(-int(r["amount"]) for r in rows if int(r.get("amount", 0)) < 0)
    return {"period": period_key(), "requests_created": requests_created, "credits_spent": spent}


async def ledger_entries(scope_id: str, limit: int = 50) -> list[dict]:
    return await TABLES["credit_ledger"].find(
        CreditEntry.scope_id == scope_id, order_by=CreditEntry.created_at.desc(), limit=limit
    )


class QuotaExceeded(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def consume_request_quota(scope_id: str) -> dict:
    """Check plan limits and debit the ledger for one new lead request. Raises QuotaExceeded when over a limit."""
    plan = await get_plan_for_scope(scope_id)
    await ensure_period_grant(scope_id, plan)
    usage = await usage_this_period(scope_id)
    if usage["requests_created"] >= plan.requests_per_month:
        raise QuotaExceeded(
            "request_limit",
            f"The {plan.name} plan allows {plan.requests_per_month} lead requests per month. Upgrade to create more.",
        )
    if await credit_balance(scope_id) < REQUEST_CREDIT_COST:
        raise QuotaExceeded("insufficient_credits", "Not enough credits left this month. Upgrade your plan for more.")
    await debit_credits(scope_id, REQUEST_CREDIT_COST, "request_created", note="Lead request created")
    return {"plan": plan.id, "requests_created": usage["requests_created"] + 1}


# -- invoices ---------------------------------------------------------------------------------------------------

async def record_invoice(scope_id: str, provider: str, invoice_id: str, fields: dict) -> bool:
    """Idempotent on (provider, invoice_id): re-delivery updates nothing and returns False."""
    key = f"{provider}:{invoice_id}"
    try:
        await TABLES["invoices"].insert(
            {"scope_id": scope_id, "invoice_key": key, "provider": provider, "created_at": datetime.utcnow(), **fields}
        )
    except IntegrityError:
        return False
    return True


async def list_invoices(scope_id: str) -> list[dict]:
    rows = await TABLES["invoices"].find(Invoice.scope_id == scope_id)
    return sorted(rows, key=lambda r: r.get("created_at") or datetime.min, reverse=True)


async def claim_event(provider: str, event_id: str) -> bool:
    """True the first time an event id is seen, False on every redelivery."""
    try:
        await TABLES["billing_events"].insert(
            {"event_key": f"{provider}:{event_id}", "received_at": datetime.utcnow()}
        )
    except IntegrityError:
        return False
    return True


async def release_event(provider: str, event_id: str) -> None:
    """Forget a claim so the provider's retry is processed again (used when handling failed)."""
    ev = await TABLES["billing_events"].get(event_key=f"{provider}:{event_id}")
    if ev:
        await TABLES["billing_events"].delete(ev["_id"])

