"""The ONLY place Phase 3 touches Phase 1 (app.jobs) and Phase 2 (app.suppression).

Each import is tried first; if the module is absent a tiny local fallback is used. After Phases 1 and 2 are merged the
integrator can delete the `except ImportError` branches (marked FALLBACK) and nothing else needs to change.
All wrappers are async and tolerate sync or async implementations.
"""
from __future__ import annotations

import inspect
from datetime import datetime
from typing import Any, Callable

from app.db.models import TABLES


async def _maybe(value):
    return await value if inspect.isawaitable(value) else value


# ---------------------------------------------------------------- jobs (Phase 1)
try:  # pragma: no cover - exercised only once Phase 1 is merged
    from app.jobs import enqueue as _enqueue
    from app.jobs import register_handler as _register_handler

    HAVE_JOBS = True
except ImportError:  # FALLBACK: in-process registry, no durability. Delete after Phase 1 merge.
    HAVE_JOBS = False
    HANDLERS: dict[str, Callable[..., Any]] = {}
    _QUEUE: list[tuple[str, dict, str | None, datetime | None]] = []

    def _register_handler(kind, fn):
        HANDLERS[kind] = fn

    async def _enqueue(kind, payload, owner_id=None, run_at=None):
        _QUEUE.append((kind, payload, owner_id, run_at))
        return f"local-{len(_QUEUE)}"

    async def run_local_queue(now: datetime | None = None) -> int:
        """Run queued fallback jobs that are due. Used by the fallback scheduler and by tests."""
        now = now or datetime.utcnow()
        due = [j for j in _QUEUE if j[3] is None or j[3] <= now]
        for j in due:
            _QUEUE.remove(j)
            fn = HANDLERS.get(j[0])
            if fn:
                await _maybe(fn(j[1]))
        return len(due)


async def enqueue(kind: str, payload: dict, owner_id: str | None = None, run_at: datetime | None = None) -> str:
    return await _maybe(_enqueue(kind, payload, owner_id=owner_id, run_at=run_at))


def register_handler(kind: str, fn: Callable[..., Any]) -> None:
    _register_handler(kind, fn)


# ---------------------------------------------------------------- suppression (Phase 2)
try:  # pragma: no cover
    from app.suppression import add_suppression as _add_suppression
    from app.suppression import is_suppressed as _is_suppressed

    HAVE_SUPPRESSION = True
except ImportError:  # FALLBACK: tiny per-owner list. Delete after Phase 2 merge.
    HAVE_SUPPRESSION = False

    async def _is_suppressed(owner_id, email):
        sup = TABLES["fallback_suppressions"]
        email = email.strip().lower()
        for row in await sup.find(sup.model.owner_id == owner_id):
            if row["value"] in (email, email.split("@")[-1]):
                return True
        return False

    async def _add_suppression(owner_id, email_or_domain, reason, source):
        sup = TABLES["fallback_suppressions"]
        value = email_or_domain.strip().lower()
        await sup.upsert({"owner_id": owner_id, "value": value}, {"reason": reason, "source": source})


async def is_suppressed(owner_id: str, email: str) -> bool:
    return bool(await _maybe(_is_suppressed(owner_id, email)))


async def add_suppression(owner_id: str, email_or_domain: str, reason: str, source: str) -> None:
    await _maybe(_add_suppression(owner_id, email_or_domain, reason, source))
