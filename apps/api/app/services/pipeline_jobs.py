"""Job handlers that run the lead pipelines on the durable queue (see app/jobs.py).

Kinds:
  pipeline.run           payload: request_id, pipeline_payload, product_desc, user_id
  pipeline.direct        payload: request_id, companies, target_roles, user_id
  lead.retry_enrichment  payload: lead_id, user_id

The user's Serper key is never stored in the payload (it is a credential); handlers load it at run time.
"""
from app import jobs
from app.core.logger import logger
from app.db.requests import get_request_by_id, update_request_status
from app.db.users import get_user_serper_key

PIPELINE_RUN = "pipeline.run"
PIPELINE_DIRECT = "pipeline.direct"
LEAD_RETRY_ENRICHMENT = "lead.retry_enrichment"

# One automatic resume after a restart; the pipeline itself already handles its own failures.
PIPELINE_MAX_ATTEMPTS = 2


async def _prepare(request_id: str, user_id: str) -> str:
    """Return the user's Serper key, and clear a stale 'Failed' left by an interrupted earlier attempt."""
    key = await get_user_serper_key(user_id)
    if not key:
        raise jobs.PermanentJobError("No Serper API key configured for this user")
    doc = await get_request_by_id(request_id, user_id)
    if doc is None:
        raise jobs.PermanentJobError("Request no longer exists")
    if doc.get("status") != "Pending":
        await update_request_status(request_id, "Pending")
    return key


async def _check_outcome(request_id: str, user_id: str) -> dict:
    doc = await get_request_by_id(request_id, user_id)
    status = (doc or {}).get("status")
    if status == "Failed":
        raise jobs.PermanentJobError((doc or {}).get("failure_reason") or "The pipeline failed")
    return {"request_id": request_id, "request_status": status}


async def handle_pipeline_run(payload: dict) -> dict:
    from app.api.request_intake import run_parallel_pipelines
    from app.services.leads import run_pipeline_background

    request_id, user_id = payload["request_id"], payload["user_id"]
    key = await _prepare(request_id, user_id)
    pipeline_payload = dict(payload.get("pipeline_payload") or {})
    product_desc = payload.get("product_desc") or ""
    if product_desc:
        await run_parallel_pipelines(request_id, pipeline_payload, product_desc, user_id, key)
    else:
        await run_pipeline_background(request_id, pipeline_payload, user_id, key)
    return await _check_outcome(request_id, user_id)


async def handle_pipeline_direct(payload: dict) -> dict:
    from app.services.leads import run_direct_companies_background

    request_id, user_id = payload["request_id"], payload["user_id"]
    key = await _prepare(request_id, user_id)
    await run_direct_companies_background(
        request_id, payload.get("companies") or [], payload.get("target_roles") or [], user_id, key
    )
    return await _check_outcome(request_id, user_id)


async def handle_lead_retry_enrichment(payload: dict) -> dict:
    from app.services.leads import retry_lead_enrichment
    from app.services.serper import current_serper_key

    user_id = payload["user_id"]
    key = await get_user_serper_key(user_id)
    if key:
        current_serper_key.set(key)
    try:
        return await retry_lead_enrichment(payload["lead_id"], user_id)
    except LookupError as exc:
        raise jobs.PermanentJobError(str(exc)) from exc


def register_handlers() -> None:
    jobs.register_handler(PIPELINE_RUN, handle_pipeline_run)
    jobs.register_handler(PIPELINE_DIRECT, handle_pipeline_direct)
    jobs.register_handler(LEAD_RETRY_ENRICHMENT, handle_lead_retry_enrichment)
    logger.debug("Registered pipeline job handlers")


async def pending_pipeline_request_ids() -> set[str]:
    """Request ids that a queued/running pipeline job will (re)run, so startup does not mark them Failed."""
    ids: set[str] = set()
    for kind in (PIPELINE_RUN, PIPELINE_DIRECT):
        for job in await jobs.active_jobs(kind):
            rid = (job.get("payload") or {}).get("request_id")
            if rid:
                ids.add(str(rid))
    return ids
