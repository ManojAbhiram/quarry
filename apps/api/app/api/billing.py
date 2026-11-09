"""Billing API: plans, workspace usage, invoices, checkout and provider webhooks."""
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.billing import service, store
from app.billing.plans import PLANS, TOPUP_PACKS, TOPUP_TARGETS, plan_to_dict
from app.billing.providers.base import InvalidSignature, ProviderNotConfigured
from app.billing.providers.registry import available_providers, default_provider_name, get_provider, topup_providers
from app.core.logger import logger
from app.teams.deps import Workspace, get_workspace, workspace_role

router = APIRouter(prefix="/billing", tags=["billing"])


def _iso(v):
    return v.isoformat() if isinstance(v, datetime) else v


class CheckoutBody(BaseModel):
    plan: Literal["pro", "team"]
    provider: Optional[Literal["stripe", "razorpay"]] = None


KIND_LABELS = {"grant": "Monthly plan credits", "request_created": "Lead request", "topup": "Top-up"}


async def _enrichment_balance(user: dict) -> int:
    from app.waterfall import service as waterfall  # lazy: keeps billing importable without the waterfall module

    return await waterfall.balance(str(user["_id"]))


class TopupBody(BaseModel):
    credits: int
    target: Literal["requests", "enrichment"] = "requests"
    provider: Optional[str] = None


@router.get("/topup")
async def topup_options(ws: Workspace = Depends(get_workspace)):
    return {"packs": list(TOPUP_PACKS), "targets": list(TOPUP_TARGETS), "providers": topup_providers(),
            "can_manage": not ws.org_id or ws.role in ("owner", "admin")}


@router.post("/topup")
async def topup(body: TopupBody, ws: Workspace = Depends(workspace_role("admin"))):
    """Buy credits through the payment provider. Owners and admins only. The mock provider credits immediately; real
    providers return a hosted checkout URL and the credits arrive with the paid webhook."""
    name = body.provider or (topup_providers() or [""])[0]
    if name not in topup_providers():
        raise HTTPException(status_code=503, detail="Credit top-ups are not available on this server")
    try:
        return await service.start_topup(
            provider_name=name, scope_id=ws.scope_id, user_id=str(ws.user["_id"]), credits=body.credits,
            target=body.target, email=ws.user.get("email") or "",
        )
    except service.TopupError as e:
        raise HTTPException(status_code=422, detail=str(e)) from None
    except ProviderNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    except Exception as e:
        logger.error("Top-up failed for %s: %s", ws.scope_id, e)
        raise HTTPException(status_code=502, detail="The payment provider could not start the top-up") from None


@router.get("/plans")
async def plans():
    return {"plans": [plan_to_dict(p) for p in PLANS.values()], "providers": available_providers()}


@router.get("/summary")
async def summary(ws: Workspace = Depends(get_workspace)):
    scope = ws.scope_id
    plan = await store.get_plan_for_scope(scope)
    await store.ensure_period_grant(scope, plan)
    sub = await store.get_subscription(scope)
    usage = await store.usage_this_period(scope)
    ledger = await store.ledger_entries(scope, limit=10)
    return {
        "scope": "organization" if ws.org_id else "personal",
        "plan": plan_to_dict(plan),
        "subscription": {
            "status": sub.get("status"), "provider": sub.get("provider"),
            "current_period_end": _iso(sub.get("current_period_end")),
        } if sub else None,
        "usage": {**usage, "requests_limit": plan.requests_per_month},
        # Two separate balances, labelled so they are never confused: request credits are spent creating lead
        # requests (plan grant + top-ups); email lookup credits are spent finding emails through paid providers.
        "credits": {"label": "Request credits", "balance": await store.credit_balance(scope),
                    "monthly_grant": plan.credits_per_month,
                    "recent": [{"kind": e["kind"], "label": KIND_LABELS.get(e["kind"], e["kind"]), "amount": e["amount"],
                                "note": e.get("note", ""), "created_at": _iso(e.get("created_at"))} for e in ledger]},
        "enrichment_credits": {"label": "Email lookup credits", "balance": await _enrichment_balance(ws.user)},
        "can_manage": not ws.org_id or ws.role in ("owner", "admin"),
    }


@router.get("/invoices")
async def invoices(ws: Workspace = Depends(get_workspace)):
    rows = await store.list_invoices(ws.scope_id)
    return {"invoices": [{"id": r["invoice_key"], "amount": r.get("amount", 0), "currency": r.get("currency", "usd"),
                          "status": r.get("status"), "url": r.get("url"), "provider": r.get("provider"),
                          "created_at": _iso(r.get("created_at"))} for r in rows]}


@router.post("/checkout")
async def checkout(body: CheckoutBody, ws: Workspace = Depends(workspace_role("admin"))):
    name = body.provider or default_provider_name()
    try:
        provider = get_provider(name)
    except KeyError:
        raise HTTPException(status_code=422, detail="Unknown payment provider") from None
    if not provider.is_configured():
        raise HTTPException(status_code=503, detail=f"{name} payments are not configured on this server") from None
    try:
        return await service.start_checkout(
            provider_name=name, scope_id=ws.scope_id, plan=body.plan, email=ws.user.get("email") or ""
        )
    except ProviderNotConfigured as e:
        raise HTTPException(status_code=503, detail=str(e)) from None
    except Exception as e:
        logger.error("Checkout failed for %s: %s", ws.scope_id, e)
        raise HTTPException(status_code=502, detail="The payment provider could not start checkout") from None


@router.post("/webhooks/{provider}")
async def webhook(provider: str, request: Request):
    try:
        get_provider(provider)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown provider") from None
    payload = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        return await service.handle_webhook(provider, payload, headers)
    except InvalidSignature:
        raise HTTPException(status_code=400, detail="Invalid signature") from None
    except ProviderNotConfigured:
        raise HTTPException(status_code=503, detail="Webhook secret not configured") from None
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed payload") from None
