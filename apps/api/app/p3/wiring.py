"""Single integration surface for Phase 3: router registration, job handlers and the fallback scheduler.

main.py calls `include_routers(app, prefix)` and `start_background()` / `stop_background()` from the lifespan.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime

from fastapi import FastAPI

from app.core.logger import logger
from app.outreach import deps, inbound, service
from app.p3.config import p3_settings

JOB_KINDS = {
    "outreach.send_due": "send due outreach steps (run every minute)",
    "outreach.poll_replies": "poll IMAP for replies/bounces (every 5 minutes)",
    "webhooks.deliver": "deliver pending/retrying webhooks (every minute, and enqueued on emit)",
    "signals.scan": "scan hiring/funding/tech signals (every 6 hours)",
    "searches.run": "run saved searches and send alerts (every 6 hours, after signals.scan)",
}


async def _send_due(_payload=None):
    return await service.run_due()


async def _poll(_payload=None):
    return await inbound.poll_all()


async def _deliver(_payload=None):
    from app.integrations.webhooks import deliver_pending

    return await deliver_pending()


async def _signals(_payload=None):
    from app.watch.signals import scan_all_users

    return await scan_all_users()


async def _searches(_payload=None):
    from app.watch.searches import run_all

    return await run_all()


HANDLERS = {
    "outreach.send_due": _send_due,
    "outreach.poll_replies": _poll,
    "webhooks.deliver": _deliver,
    "signals.scan": _signals,
    "searches.run": _searches,
}


def register_handlers() -> None:
    for kind, fn in HANDLERS.items():
        deps.register_handler(kind, fn)


def include_routers(app: FastAPI, prefix: str) -> None:
    from app.integrations.api import public_v1
    from app.integrations.api import router as integrations_router
    from app.outreach.api import public_router, router as outreach_router
    from app.waterfall.api import router as enrichment_router
    from app.watch.api import router as watch_router

    for r in (outreach_router, public_router, integrations_router, public_v1, watch_router, enrichment_router):
        app.include_router(r, prefix=prefix)


# --------------------------------------------------------------- fallback scheduler (only when Phase 1 jobs are absent)
_task: asyncio.Task | None = None


async def _loop() -> None:
    last = {"poll": 0.0, "slow": 0.0}
    interval = max(5, p3_settings.scheduler_interval_seconds)
    while True:
        try:
            now = time.monotonic()
            await _send_due()
            await _deliver()
            if now - last["poll"] >= 300:
                last["poll"] = now
                await _poll()
            if now - last["slow"] >= 6 * 3600:
                last["slow"] = now
                await _signals()
                await _searches()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Phase 3 scheduler tick failed")
        await asyncio.sleep(interval)


def start_background() -> None:
    """Register job handlers; start the in-process loop only when Phase 1's durable job queue is not present."""
    global _task
    register_handlers()
    if deps.HAVE_JOBS or not p3_settings.scheduler_enabled:
        return
    _task = asyncio.create_task(_loop(), name="p3-scheduler")
    logger.info("Phase 3 fallback scheduler started at %s", datetime.utcnow().isoformat())


async def stop_background() -> None:
    global _task
    if _task:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
