"""Owner-scoped routes over the durable job queue (app/jobs.py)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app import jobs
from app.services.auth import get_current_user

router = APIRouter(prefix="/jobs", tags=["jobs"])

_PUBLIC_FIELDS = (
    "kind", "status", "attempts", "max_attempts", "result", "error",
    "created_at", "run_at", "started_at", "finished_at",
)


def _out(job: dict) -> dict:
    """Public view of a job. The payload is deliberately omitted (it may hold user data)."""
    out = {"id": job["_id"]}
    for key in _PUBLIC_FIELDS:
        value = job.get(key)
        out[key] = value.isoformat() if hasattr(value, "isoformat") else value
    return out


@router.get("")
async def list_my_jobs(
    status: Optional[str] = Query(None),
    kind: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    items = await jobs.list_jobs(str(current_user["_id"]), status=status, kind=kind, limit=limit)
    return {"jobs": [_out(j) for j in items]}


@router.get("/{job_id}")
async def get_my_job(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await jobs.get_job(job_id, owner_id=str(current_user["_id"]))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _out(job)


@router.post("/{job_id}/cancel")
async def cancel_my_job(job_id: str, current_user: dict = Depends(get_current_user)):
    job = await jobs.cancel_job(job_id, owner_id=str(current_user["_id"]))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _out(job)
