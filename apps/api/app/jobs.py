"""Durable background job queue backed by the `jobs` table.

Public interface (other modules rely on these exact signatures):

    job_id = await enqueue(kind, payload, owner_id=None, run_at=None)
    register_handler(kind, fn)          # fn: async def fn(payload: dict) -> dict | None

A handler receives the JSON payload and may return a JSON-serialisable dict (stored as the job result). The id of the
running job is available through the `current_job_id` context variable. Handler outcomes:

* returns normally            -> status `succeeded`
* raises PermanentJobError    -> status `failed` immediately (no retry)
* raises any other exception  -> retried with exponential backoff until `max_attempts`, then `failed`
* asyncio.CancelledError      -> `cancelled` if the user cancelled the job; otherwise (server shutdown) the job is
                                 left `running` so that `recover_running_jobs()` resumes it on the next start.

Statuses: queued, running, succeeded, failed, cancelled.

The worker is a single asyncio task owned by the FastAPI lifespan (`start_worker()` / `stop_worker()`). It polls the
table, so jobs survive restarts; jobs left `running` by a crashed process are re-queued by `recover_running_jobs()`.
"""
import asyncio
import os
from contextvars import ContextVar
from datetime import datetime, timedelta
from typing import Awaitable, Callable, Optional

from sqlalchemy import select

from app.core.logger import logger
from app.db import engine as _engine
from app.db.models import TABLES, Job

QUEUED = "queued"
RUNNING = "running"
SUCCEEDED = "succeeded"
FAILED = "failed"
CANCELLED = "cancelled"
TERMINAL = (SUCCEEDED, FAILED, CANCELLED)
ACTIVE = (QUEUED, RUNNING)

POLL_INTERVAL_SECONDS = float(os.getenv("JOB_POLL_INTERVAL_SECONDS", "1.0"))
WORKER_CONCURRENCY = int(os.getenv("JOB_WORKER_CONCURRENCY", "4"))
DEFAULT_MAX_ATTEMPTS = int(os.getenv("JOB_MAX_ATTEMPTS", "3"))
BACKOFF_BASE_SECONDS = float(os.getenv("JOB_BACKOFF_BASE_SECONDS", "5"))
BACKOFF_MAX_SECONDS = float(os.getenv("JOB_BACKOFF_MAX_SECONDS", "300"))

Handler = Callable[[dict], Awaitable[Optional[dict]]]

_jobs = TABLES["jobs"]
_handlers: dict[str, Handler] = {}
_running_tasks: dict[str, asyncio.Task] = {}
_cancel_requested: set[str] = set()
_worker_task: asyncio.Task | None = None
_stopping = False

current_job_id: ContextVar[str | None] = ContextVar("current_job_id", default=None)


class PermanentJobError(Exception):
    """Raise from a handler to fail the job without further retries."""


def register_handler(kind: str, fn: Handler) -> None:
    """Register the coroutine function that executes jobs of `kind` (re-registering replaces it)."""
    _handlers[kind] = fn


def get_handler(kind: str) -> Handler | None:
    return _handlers.get(kind)


def backoff_seconds(attempt: int) -> float:
    """Delay before retry number `attempt` (1-based): base * 2^(attempt-1), capped."""
    return min(BACKOFF_MAX_SECONDS, BACKOFF_BASE_SECONDS * (2 ** max(0, attempt - 1)))


async def enqueue(
    kind: str,
    payload: dict,
    owner_id: str | None = None,
    run_at: datetime | None = None,
    max_attempts: int | None = None,
) -> str:
    """Persist a new queued job and return its id. `run_at` is a naive UTC datetime (default: now)."""
    now = datetime.utcnow()
    job_id = await _jobs.insert({
        "kind": kind,
        "owner_id": str(owner_id) if owner_id is not None else None,
        "status": QUEUED,
        "run_at": run_at or now,
        "created_at": now,
        "payload": payload or {},
        "attempts": 0,
        "max_attempts": max_attempts or DEFAULT_MAX_ATTEMPTS,
        "result": None,
        "error": None,
    })
    logger.info("Enqueued job %s kind=%s owner=%s", job_id, kind, owner_id)
    return job_id


async def get_job(job_id: str, owner_id: str | None = None) -> dict | None:
    """Fetch a job; when `owner_id` is given, only a job owned by that user is returned."""
    job = await _jobs.get(_id=str(job_id))
    if job is None:
        return None
    if owner_id is not None and job.get("owner_id") != str(owner_id):
        return None
    return job


async def list_jobs(
    owner_id: str, status: str | None = None, kind: str | None = None, limit: int = 50
) -> list[dict]:
    where = [Job.owner_id == str(owner_id)]
    if status:
        where.append(Job.status == status)
    if kind:
        where.append(Job.kind == kind)
    return await _jobs.find(*where, order_by=Job.created_at.desc(), limit=max(1, min(limit, 200)))


async def active_jobs(kind: str | None = None) -> list[dict]:
    where = [Job.status.in_(ACTIVE)]
    if kind:
        where.append(Job.kind == kind)
    return await _jobs.find(*where)


async def cancel_job(job_id: str, owner_id: str | None = None) -> dict | None:
    """Cancel a queued or running job. Returns the updated job, the unchanged job if already finished, or None."""
    job = await get_job(job_id, owner_id)
    if job is None:
        return None
    if job["status"] in TERMINAL:
        return job
    now = datetime.utcnow()
    if job["status"] == QUEUED:
        updated = await _jobs.modify(
            job["_id"], lambda d: {"status": CANCELLED, "finished_at": now} if d["status"] == QUEUED else {}
        )
        if updated and updated["status"] == CANCELLED:
            return updated
        job = updated or job  # it was claimed in the meantime: fall through to the running path
    _cancel_requested.add(job["_id"])
    task = _running_tasks.get(job["_id"])
    if task is not None:
        task.cancel()
        return job
    # Marked running but nothing here executes it (e.g. a stale row): just finish it.
    _cancel_requested.discard(job["_id"])
    return await _jobs.update(job["_id"], {"status": CANCELLED, "finished_at": now})


async def recover_running_jobs() -> int:
    """Startup: jobs still `running` belong to a process that died. Re-queue them, or fail them if out of attempts."""
    stale = await _jobs.find(Job.status == RUNNING)
    now = datetime.utcnow()
    for job in stale:
        attempts = int(job.get("attempts") or 0)
        if attempts >= int(job.get("max_attempts") or DEFAULT_MAX_ATTEMPTS):
            await _jobs.update(job["_id"], {
                "status": FAILED, "finished_at": now, "error": "Interrupted by a restart; no attempts left.",
            })
        else:
            await _jobs.update(job["_id"], {"status": QUEUED, "run_at": now, "error": "Resumed after a restart."})
    if stale:
        logger.warning("Recovered %d job(s) left running by a previous process", len(stale))
    return len(stale)


async def _claim_next() -> dict | None:
    """Atomically move the oldest due queued job to running (incrementing attempts) and return it."""
    now = datetime.utcnow()
    async with _engine.session() as s, s.begin():
        row = (
            await s.execute(
                select(Job).where(Job.status == QUEUED, Job.run_at <= now).order_by(Job.run_at).limit(1)
            )
        ).scalars().first()
        if row is None:
            return None
        row.status = RUNNING
        row.data = {**(row.data or {}), "attempts": int((row.data or {}).get("attempts") or 0) + 1, "started_at": now}
        return _jobs._to_doc(row)


async def _finish(job_id: str, fields: dict) -> None:
    # Never overwrite a cancellation that landed while the handler was finishing.
    await _jobs.modify(job_id, lambda d: {} if d["status"] == CANCELLED else fields)


async def _execute(job: dict) -> None:
    job_id = job["_id"]
    kind = job["kind"]
    handler = _handlers.get(kind)
    now_fn = datetime.utcnow
    if handler is None:
        await _finish(job_id, {"status": FAILED, "finished_at": now_fn(), "error": f"No handler for kind '{kind}'"})
        logger.error("Job %s has no handler for kind '%s'", job_id, kind)
        return
    token = current_job_id.set(job_id)
    try:
        result = await handler(job.get("payload") or {})
        await _finish(job_id, {"status": SUCCEEDED, "finished_at": now_fn(), "result": result, "error": None})
        logger.info("Job %s (%s) succeeded", job_id, kind)
    except asyncio.CancelledError:
        if job_id in _cancel_requested:
            _cancel_requested.discard(job_id)
            await _jobs.update(job_id, {"status": CANCELLED, "finished_at": now_fn()})
            logger.info("Job %s (%s) cancelled", job_id, kind)
            return  # swallowed on purpose: the cancellation was aimed at this job, not at the worker
        # Server shutdown: leave it `running` so recover_running_jobs() resumes it.
        logger.warning("Job %s (%s) interrupted by shutdown; it will resume on next start", job_id, kind)
        raise
    except PermanentJobError as exc:
        await _finish(job_id, {"status": FAILED, "finished_at": now_fn(), "error": str(exc)[:1000]})
        logger.error("Job %s (%s) failed permanently: %s", job_id, kind, exc)
    except Exception as exc:
        attempts = int(job.get("attempts") or 1)
        max_attempts = int(job.get("max_attempts") or DEFAULT_MAX_ATTEMPTS)
        message = f"{type(exc).__name__}: {exc}"[:1000]
        if attempts >= max_attempts:
            await _finish(job_id, {"status": FAILED, "finished_at": now_fn(), "error": message})
            logger.error("Job %s (%s) failed after %d attempt(s): %s", job_id, kind, attempts, message)
        else:
            delay = backoff_seconds(attempts)
            await _finish(job_id, {
                "status": QUEUED, "run_at": now_fn() + timedelta(seconds=delay), "error": message,
            })
            logger.warning("Job %s (%s) attempt %d/%d failed (%s); retrying in %.0fs",
                           job_id, kind, attempts, max_attempts, message, delay)
    finally:
        current_job_id.reset(token)


async def run_pending_once() -> int:
    """Claim and run every currently due job to completion (concurrently). Used by tests and the worker loop."""
    tasks: list[asyncio.Task] = []
    while True:
        job = await _claim_next()
        if job is None:
            break
        task = asyncio.create_task(_execute(job))
        _running_tasks[job["_id"]] = task
        task.add_done_callback(lambda _t, jid=job["_id"]: _running_tasks.pop(jid, None))
        tasks.append(task)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    return len(tasks)


async def _worker_loop() -> None:
    sem = asyncio.Semaphore(WORKER_CONCURRENCY)
    logger.info("Job worker started (concurrency=%d, poll=%.1fs)", WORKER_CONCURRENCY, POLL_INTERVAL_SECONDS)

    def _release(task: asyncio.Task, jid: str) -> None:
        _running_tasks.pop(jid, None)
        sem.release()

    while not _stopping:
        try:
            await sem.acquire()
            job = await _claim_next()
            if job is None:
                sem.release()
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue
            task = asyncio.create_task(_execute(job))
            _running_tasks[job["_id"]] = task
            task.add_done_callback(lambda t, jid=job["_id"]: _release(t, jid))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # keep the loop alive across transient DB errors
            sem.release()
            logger.error("Job worker iteration failed: %s", exc, exc_info=True)
            await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def start_worker() -> None:
    """Recover interrupted jobs and start the polling worker. Call after connect_db()."""
    global _worker_task, _stopping
    if _worker_task is not None and not _worker_task.done():
        return
    _stopping = False
    await recover_running_jobs()
    _worker_task = asyncio.create_task(_worker_loop())


async def stop_worker() -> None:
    """Stop polling and cancel in-flight handlers (their jobs stay `running` and resume on next start)."""
    global _worker_task, _stopping
    _stopping = True
    if _worker_task is not None:
        _worker_task.cancel()
        await asyncio.gather(_worker_task, return_exceptions=True)
        _worker_task = None
    running = list(_running_tasks.values())
    for task in running:
        task.cancel()
    if running:
        await asyncio.gather(*running, return_exceptions=True)
    _running_tasks.clear()
    _cancel_requested.clear()
    logger.info("Job worker stopped")
