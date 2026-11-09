"""Background job that pushes a lead list to a CRM (see app/jobs.py).

Kind `crm.push` payload: scope_id, provider, list_id, lead_ids, only_failed, user_id. The HTTP endpoint enqueues it and
returns at once; per-lead progress is written to the `crm_sync` rows as the job runs, and the UI polls the job and the
sync status.
"""
from app import jobs
from app.core.logger import logger
from app.crm import service
from app.db.decision_makers import get_decision_makers_for_lead
from app.db.leads import get_leads_by_ids

CRM_PUSH = "crm.push"
CRM_PUSH_MAX_ATTEMPTS = 2


async def find_active_push(scope_id: str, provider: str, list_id: str) -> dict | None:
    """A queued or running push for the same list, so a double click joins it instead of starting a second."""
    for job in await jobs.active_jobs(CRM_PUSH):
        p = job.get("payload") or {}
        if p.get("scope_id") == scope_id and p.get("provider") == provider and p.get("list_id") == list_id:
            return job
    return None


async def enqueue_push(*, conn: dict, scope_id: str, list_id: str, lead_ids: list[str], only_failed: bool, user_id: str) -> dict:
    """Mark the leads as queued (visible to the UI straight away) and enqueue the job. Returns the job id."""
    existing = await find_active_push(scope_id, conn["provider"], list_id)
    if existing:
        return {"job_id": existing["_id"], "joined": True}
    await service.mark_queued(conn["_id"], lead_ids, only_failed=only_failed)
    job_id = await jobs.enqueue(
        CRM_PUSH,
        {"scope_id": scope_id, "provider": conn["provider"], "list_id": list_id, "lead_ids": lead_ids,
         "only_failed": only_failed, "user_id": user_id},
        owner_id=user_id,
        max_attempts=CRM_PUSH_MAX_ATTEMPTS,
    )
    return {"job_id": job_id, "joined": False}


async def handle_crm_push(payload: dict) -> dict:
    conn = await service.get_connection(payload["scope_id"], payload["provider"])
    lead_ids = list(payload.get("lead_ids") or [])
    if not conn:
        await service.fail_unfinished(None, lead_ids, "The CRM connection was removed before the push ran")
        raise jobs.PermanentJobError("The CRM connection no longer exists")
    connector = None
    try:
        leads = await get_leads_by_ids(lead_ids, None)
        dms = {x["_id"]: await get_decision_makers_for_lead(x["_id"]) for x in leads}
        connector = service.make_connector(conn)
        out = await service.push_leads(conn, connector, leads, dms, only_failed=bool(payload.get("only_failed")))
    except Exception as exc:  # noqa: BLE001 - never leave leads looking "in progress" forever
        logger.exception("CRM push job failed")
        await service.fail_unfinished(conn["_id"], lead_ids, f"The push did not finish: {exc}")
        raise jobs.PermanentJobError(f"The push did not finish: {exc}") from exc
    finally:
        close = getattr(connector, "aclose", None)
        if close:
            await close()
    # Leads deleted since the list was built never reach push_leads; do not leave them marked queued.
    await service.fail_unfinished(conn["_id"], lead_ids, "Lead no longer exists")
    return {"summary": out["summary"]}


def register_handlers() -> None:
    jobs.register_handler(CRM_PUSH, handle_crm_push)
