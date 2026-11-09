"""Plan catalogue. Limits are plain data so they can be tuned (or later loaded from config) in one place."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Plan:
    id: str
    name: str
    price_usd_month: int
    requests_per_month: int  # lead requests that may be created per calendar month
    credits_per_month: int  # credits granted to the workspace each month (ledger grant)
    seats: int  # members (plus pending invites) allowed in an organization on this plan
    crm_connections: int
    features: tuple[str, ...] = ()


PLANS: dict[str, Plan] = {
    "free": Plan("free", "Free", 0, 3, 25, 3, 0, ("3 lead requests / month", "25 credits / month", "Up to 3 seats")),
    "pro": Plan("pro", "Pro", 49, 50, 500, 5, 1, ("50 lead requests / month", "500 credits / month", "1 CRM integration")),
    "team": Plan(
        "team", "Team", 199, 250, 2500, 25, 5,
        ("250 lead requests / month", "2,500 credits / month", "25 seats", "5 CRM integrations"),
    ),
}

DEFAULT_PLAN = "free"
REQUEST_CREDIT_COST = 1  # credits debited when a lead request is created


# Credit top-ups. "requests" credits live in the billing ledger and are spent creating lead requests; "enrichment"
# credits (email lookups through Hunter/Snov/PDL) live in the per-user enrichment ledger.
TOPUP_PACKS: tuple[dict, ...] = (
    {"credits": 100, "price_usd": 10},
    {"credits": 500, "price_usd": 40},
    {"credits": 2000, "price_usd": 140},
)
TOPUP_TARGETS = ("requests", "enrichment")


def topup_price_usd(credits: int) -> int | None:
    return next((p["price_usd"] for p in TOPUP_PACKS if p["credits"] == credits), None)


def get_plan(plan_id: str | None) -> Plan:
    return PLANS.get(plan_id or DEFAULT_PLAN, PLANS[DEFAULT_PLAN])


def plan_to_dict(p: Plan) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "price_usd_month": p.price_usd_month,
        "limits": {
            "requests_per_month": p.requests_per_month,
            "credits_per_month": p.credits_per_month,
            "seats": p.seats,
            "crm_connections": p.crm_connections,
        },
        "features": list(p.features),
    }
