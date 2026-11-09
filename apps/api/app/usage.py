"""Cost estimates, usage metering and per-user quotas.

Metering: pipeline entry points wrap a run in `tracked(...)`. The Serper client and the LLM helpers call `count(...)`,
which adds to the active run's counters. When the run ends the counters (and an estimated cost) are stored on a
`usage_events` row. Unit prices are estimates, set by env vars; they exist to show order of magnitude, not to bill.

Quota: a user may start RUN_QUOTA runs and spend COST_QUOTA_USD (estimated) per calendar month. `check_quota` raises
429 when either is used up. Both can be overridden per user (`quota_runs_monthly`, `quota_cost_monthly_usd` on the user).
"""
from __future__ import annotations

import math
import os
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Mapping

from fastapi import HTTPException

from app.core.logger import logger
from app.db.models import TABLES
from app.db.models_trust import UsageEvent

SERPER_USD_PER_CALL = float(os.getenv("SERPER_USD_PER_CALL", "0.001"))
LLM_USD_PER_CALL = float(os.getenv("LLM_USD_PER_CALL", "0.002"))
RUN_QUOTA = int(os.getenv("QUOTA_RUNS_PER_MONTH", "30"))
COST_QUOTA_USD = float(os.getenv("QUOTA_COST_USD_PER_MONTH", "20"))

_events = TABLES["usage_events"]


def cost_of(serper_calls: int, llm_calls: int) -> float:
    return round(serper_calls * SERPER_USD_PER_CALL + llm_calls * LLM_USD_PER_CALL, 4)


# ── estimate ────────────────────────────────────────────────────────────────

def icp_size(icp_dimensions: Mapping[str, Any] | None) -> int:
    """How many distinct ICP criteria were given: non-empty lines across all dimensions."""
    total = 0
    for dim in (icp_dimensions or {}).values():
        text = dim.get("value") if isinstance(dim, Mapping) else dim
        total += sum(1 for line in str(text or "").splitlines() if line.strip(" \t-*•"))
    return total


def estimate_run(num_leads: int, icp_dimensions: Mapping[str, Any] | None = None) -> dict:
    """A launch estimate from the number of leads wanted and the size of the ICP.

    Assumptions (shown to the user): a richer ICP means more search queries; about 3 candidate pages are scraped per
    lead wanted (many are filtered out); each enriched lead costs about 9 searches (firmographics, funding and job
    signals, decision-maker lookup, posts) and 5 LLM calls. `low`/`high` bracket the typical figure.
    """
    n = max(1, int(10 if num_leads is None else num_leads))
    size = icp_size(icp_dimensions)
    queries = min(20, max(6, 6 + size // 2))
    candidates = n * 3
    search = queries + n * 9
    llm = 2 + math.ceil(candidates / 20) + candidates + n * 5
    typical = cost_of(search, llm)
    return {
        "num_leads": n,
        "icp_size": size,
        "search_calls": search,
        "llm_calls": llm,
        "cost_usd": {"low": round(typical * 0.6, 3), "typical": round(typical, 3), "high": round(typical * 1.5, 3)},
        "assumptions": [
            f"{queries} search queries, from {size} ICP criteria",
            f"about {candidates} candidate pages scraped for {n} leads wanted",
            "about 9 searches and 5 language-model calls per enriched lead",
            f"prices: ${SERPER_USD_PER_CALL:g} per search, ${LLM_USD_PER_CALL:g} per model call (estimates)",
        ],
    }


def estimate_direct(num_companies: int) -> dict:
    """Direct-companies flow: no discovery, just decision-maker lookups (about 4 searches and 2 model calls each)."""
    n = max(1, int(num_companies or 1))
    search, llm = n * 4, n * 2
    typical = cost_of(search, llm)
    return {
        "num_leads": n, "icp_size": 0, "search_calls": search, "llm_calls": llm,
        "cost_usd": {"low": round(typical * 0.6, 3), "typical": round(typical, 3), "high": round(typical * 1.5, 3)},
        "assumptions": [f"{n} companies, about 4 searches and 2 model calls each"],
    }


# ── metering ────────────────────────────────────────────────────────────────

@dataclass
class _Tracker:
    user_id: str
    request_id: str | None
    counts: dict[str, int] = field(default_factory=lambda: {"serper": 0, "llm": 0})


_tracker: ContextVar[_Tracker | None] = ContextVar("usage_tracker", default=None)


def count(kind: str, n: int = 1) -> None:
    """Add to the active run's counters (kind: 'serper' | 'llm'). No-op outside a tracked run."""
    t = _tracker.get()
    if t is not None:
        t.counts[kind] = t.counts.get(kind, 0) + n


async def begin_run(user_id: str, request_id: str, estimate: dict | None = None) -> None:
    """Record a launch up front, at its estimated cost, so quota counts runs that are still in flight."""
    est = estimate or {}
    await _events.upsert(
        {"user_id": str(user_id), "kind": "run", "request_id": request_id},
        {
            "serper_calls": est.get("search_calls", 0), "llm_calls": est.get("llm_calls", 0),
            "cost_usd": (est.get("cost_usd") or {}).get("typical", 0.0), "estimated": True, "created_at": datetime.utcnow(),
        },
    )


async def _finish(user_id: str, request_id: str | None, counts: dict[str, int]) -> None:
    serper, llm = counts.get("serper", 0), counts.get("llm", 0)
    if not (serper or llm):
        return
    doc = {"serper_calls": serper, "llm_calls": llm, "cost_usd": cost_of(serper, llm), "estimated": False, "finished_at": datetime.utcnow()}
    if request_id:
        existing = await _events.get(user_id=str(user_id), kind="run", request_id=request_id)
        if existing:
            await _events.update(existing["_id"], doc)
        else:
            await _events.insert({"user_id": str(user_id), "kind": "run", "request_id": request_id, "created_at": datetime.utcnow(), **doc})
    else:
        await _events.insert({"user_id": str(user_id), "kind": "other", "created_at": datetime.utcnow(), **doc})


@asynccontextmanager
async def tracked(user_id: str, request_id: str | None = None):
    """Count calls made inside the block against `user_id`. Nested use joins the outer run."""
    if _tracker.get() is not None:
        yield
        return
    t = _Tracker(str(user_id), request_id)
    token = _tracker.set(t)
    try:
        yield
    finally:
        _tracker.reset(token)
        try:
            await _finish(t.user_id, t.request_id, t.counts)
        except Exception as exc:  # metering must never fail a run
            logger.warning("Could not record usage for request %s: %s", request_id, exc)


async def record_sample(user_id: str, serper_calls: int, llm_calls: int) -> None:
    await _events.insert({
        "user_id": str(user_id), "kind": "sample", "serper_calls": serper_calls, "llm_calls": llm_calls,
        "cost_usd": cost_of(serper_calls, llm_calls), "estimated": False, "created_at": datetime.utcnow(),
    })


# ── summary and quota ───────────────────────────────────────────────────────

def _month_start(now: datetime | None = None) -> datetime:
    now = now or datetime.utcnow()
    return datetime(now.year, now.month, 1)


def _next_month(start: datetime) -> datetime:
    return datetime(start.year + (start.month == 12), start.month % 12 + 1, 1)


async def get_summary(user_id: str, user: dict | None = None, now: datetime | None = None) -> dict:
    start = _month_start(now)
    rows = await _events.find(UsageEvent.user_id == str(user_id), UsageEvent.created_at >= start)
    runs = [r for r in rows if r.get("kind") == "run"]
    cost = round(sum(float(r.get("cost_usd") or 0) for r in rows), 4)
    user = user or {}
    run_quota = int(user.get("quota_runs_monthly") or RUN_QUOTA)
    cost_quota = float(user.get("quota_cost_monthly_usd") or COST_QUOTA_USD)
    recent = sorted(rows, key=lambda r: r.get("created_at") or datetime.min, reverse=True)[:10]
    return {
        "period_start": start.isoformat(), "period_end": _next_month(start).isoformat(),
        "runs": len(runs), "samples": sum(1 for r in rows if r.get("kind") == "sample"),
        "search_calls": sum(int(r.get("serper_calls") or 0) for r in rows),
        "llm_calls": sum(int(r.get("llm_calls") or 0) for r in rows),
        "cost_usd": cost,
        "quota": {"runs": run_quota, "cost_usd": cost_quota,
                  "runs_left": max(0, run_quota - len(runs)), "cost_left_usd": round(max(0.0, cost_quota - cost), 4)},
        "recent": [
            {"kind": r.get("kind"), "request_id": r.get("request_id"), "search_calls": r.get("serper_calls") or 0,
             "llm_calls": r.get("llm_calls") or 0, "cost_usd": r.get("cost_usd") or 0, "estimated": bool(r.get("estimated")),
             "created_at": r["created_at"].isoformat() if r.get("created_at") else None}
            for r in recent
        ],
        "unit_prices": {"search_call_usd": SERPER_USD_PER_CALL, "llm_call_usd": LLM_USD_PER_CALL},
    }


async def check_quota(user_id: str, user: dict | None = None, estimate: dict | None = None) -> None:
    """Raise 429 if starting another run would exceed the user's monthly runs or estimated spend."""
    s = await get_summary(user_id, user)
    q = s["quota"]
    if q["runs_left"] <= 0:
        raise HTTPException(status_code=429, detail=f"Monthly run limit reached ({q['runs']} of {q['runs']}). It resets on the 1st.")
    typical = ((estimate or {}).get("cost_usd") or {}).get("typical", 0)
    if s["cost_usd"] >= q["cost_usd"] or s["cost_usd"] + typical > q["cost_usd"]:
        raise HTTPException(
            status_code=429,
            detail=f"This run (about ${typical:.2f}) would exceed your monthly budget of ${q['cost_usd']:.2f} (${s['cost_usd']:.2f} used).",
        )
