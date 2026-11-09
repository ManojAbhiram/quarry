import asyncio
import csv
import io
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, BackgroundTasks, File, Form, HTTPException, UploadFile

from app.schemas.request_intake import (
    RequestIntakeCreate,
    RequestIntakeResponse,
    ConsistencyCheckResponse,
    DirectCompaniesCreate,
    ProductIntakeForm,
    StructuredICP,
    SuggestChipRequest,
    SuggestChipResponse,
)
from app.services.auth import get_current_user
import app.services.request_intake_service as svc
import app.services.competitor_service as competitor_svc
import app.services.pipeline_jobs as pipeline_jobs
from app import jobs
from app.services.leads import run_pipeline_background, run_direct_companies_background
from app.services.serper import current_serper_key
from app.db.requests import get_request_by_id
from app.db.users import get_user_serper_key
from app import usage

SERPER_KEY_REQUIRED_MSG = "Add your Serper API key in Profile to launch lead generation."

logger = logging.getLogger("app.api.request_intake")


async def run_parallel_pipelines(
    request_id: str,
    pipeline_payload: dict,
    product_desc: str,
    user_id: str,
    serper_api_key: str,
) -> None:
    """Run lead generation and competitor pipelines in true parallel."""
    current_serper_key.set(serper_api_key)
    logger.info("Starting parallel pipelines for request_id=%s", request_id)
    try:
        async with usage.tracked(user_id, request_id):
            await asyncio.gather(
                run_pipeline_background(request_id, pipeline_payload, user_id),
                competitor_svc.run_competitor_pipeline(request_id, product_desc, user_id),
                return_exceptions=True,
            )
        logger.info("Parallel pipelines completed for request_id=%s", request_id)
    except Exception as exc:
        logger.error("Parallel pipelines failed for request_id=%s: %s", request_id, exc, exc_info=True)

async def _launch_durable(
    background_tasks: BackgroundTasks, user_id: str, request_id: str, kind: str, payload: dict, fallback: tuple
) -> None:
    """Queue the run on the durable job queue; if the queue is unavailable, fall back to in-process BackgroundTasks
    (the run then does not survive a restart). The Serper key is never stored in the job: the worker loads it."""
    try:
        await jobs.enqueue(kind, payload, owner_id=user_id, max_attempts=pipeline_jobs.PIPELINE_MAX_ATTEMPTS)
    except Exception as exc:
        logger.error("Could not enqueue %s for request %s (%s); falling back to BackgroundTasks", kind, request_id, exc)
        fn, *args = fallback
        background_tasks.add_task(fn, *args)


router = APIRouter(prefix="/requests", tags=["request-intake"])


@router.post("/analyze-source")
async def analyze_source_endpoint(
    description: Optional[str] = Form(None),
    urls: Optional[str] = Form(None),
    files: Optional[List[UploadFile]] = File(None),
    current_user: dict = Depends(get_current_user),
):
    logger.info(
        "Source analysis requested by user=%s files=%s",
        current_user.get("email"),
        [f.filename for f in files] if files else None,
    )
    return await svc.analyze_sources(description, files, urls)


@router.post("/suggest-chip", response_model=SuggestChipResponse)
async def suggest_chip_endpoint(
    body: SuggestChipRequest,
    current_user: dict = Depends(get_current_user),
):
    logger.info("Chip suggestion for user=%s chip_type=%s", current_user.get("email"), body.chip_type)
    suggestion = await svc.suggest_chip(
        chip_type=body.chip_type,
        product_name=body.product_name or "",
        product_category=body.product_category or "",
        current_description=body.current_description or "",
    )
    return SuggestChipResponse(suggestion=suggestion)


@router.post("/generate-icp", response_model=StructuredICP)
async def generate_icp_endpoint(
    body: ProductIntakeForm,
    request_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    if not request_id:
        raise HTTPException(status_code=422, detail="request_id query parameter is required")
    logger.info(
        "ICP generation for user=%s product=%s request_id=%s",
        current_user.get("email"), body.product_name, request_id,
    )
    user_id = str(current_user["_id"])
    icp_data = await svc.generate_icp(body.model_dump(), request_id, user_id)
    # NOTE: Competitor pipeline is intentionally NOT triggered here.
    # It runs exactly once from the /launch endpoint to avoid duplicate executions.
    return StructuredICP(**icp_data)


@router.post("/check-consistency", response_model=ConsistencyCheckResponse)
async def check_consistency_endpoint(
    body: StructuredICP,
    current_user: dict = Depends(get_current_user),
):
    logger.info("ICP consistency check for user=%s", current_user.get("email"))
    return await svc.check_consistency(body.model_dump())


@router.post("/launch", response_model=RequestIntakeResponse, status_code=202)
async def create_request_endpoint(
    body: RequestIntakeCreate,
    background_tasks: BackgroundTasks,
    draft_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    logger.info(
        "Request launch for user=%s product=%s draft_id=%s",
        current_user.get("email"), body.product_intake.product_name, draft_id,
    )
    user_id = str(current_user["_id"])
    serper_api_key = await get_user_serper_key(user_id)
    if not serper_api_key:
        raise HTTPException(status_code=400, detail=SERPER_KEY_REQUIRED_MSG)
    estimate = usage.estimate_run(body.num_leads or 10, body.icp_dimensions.model_dump())
    await usage.check_quota(user_id, current_user, estimate)
    request_id = await svc.create_request(body, user_id, draft_id)
    await usage.begin_run(user_id, request_id, estimate)

    # Build pipeline payload from the stored request doc so the pipeline has
    # ideal_lead_profile, business_type, target_location, and title.
    # Fall back to body.model_dump() if the doc is not yet readable.
    pipeline_payload = body.model_dump()
    try:
        doc = await get_request_by_id(request_id, user_id)
        if doc:
            pipeline_payload = {
                "title": doc.get("title") or "",
                "business_type": doc.get("business_type") or "",
                "target_location": doc.get("target_location") or "",
                "ideal_lead_profile": doc.get("ideal_lead_profile") or "",
                "product_description": doc.get("product_description") or "",
                "status": doc.get("status") or "Pending",
                "product_intake": body.product_intake.model_dump(),
                "icp_dimensions": body.icp_dimensions.model_dump(),
                "num_leads": body.num_leads,
            }
    except Exception as exc:
        logger.warning("Could not fetch request doc for pipeline payload (request_id=%s): %s", request_id, exc)

    product_desc = pipeline_payload.get("product_description") or ""

    await _launch_durable(
        background_tasks,
        user_id,
        request_id,
        pipeline_jobs.PIPELINE_RUN,
        {
            "request_id": request_id,
            "pipeline_payload": pipeline_payload,
            "product_desc": product_desc,
            "user_id": user_id,
        },
        fallback=(
            (run_parallel_pipelines, request_id, pipeline_payload, product_desc, user_id, serper_api_key)
            if product_desc
            else (run_pipeline_background, request_id, pipeline_payload, user_id, serper_api_key)
        ),
    )

    return RequestIntakeResponse(
        message="Lead request created. Discovery pipeline started in background.",
        request_id=request_id,
        status="Pending",
    )


@router.post("/parse-companies-csv")
async def parse_companies_csv_endpoint(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Parse an uploaded CSV of companies and return the list of company names/domains.

    Accepts a header row containing a 'company'/'company_name'/'name'/'domain'/'website'
    column. If no recognizable header is present, the first column of each row is used.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded CSV is empty.")
    try:
        text = raw.decode("utf-8-sig", errors="replace")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read CSV file: {exc}") from exc

    reader = csv.reader(io.StringIO(text))
    rows = [row for row in reader if any((cell or "").strip() for cell in row)]
    if not rows:
        raise HTTPException(status_code=400, detail="No rows found in CSV.")

    target_keys = {"company", "company_name", "company name", "name", "domain", "website"}
    header = [(c or "").strip().lower() for c in rows[0]]
    col_idx = 0
    data_rows = rows
    if any(h in target_keys for h in header):
        for i, h in enumerate(header):
            if h in target_keys:
                col_idx = i
                break
        data_rows = rows[1:]

    companies: list[str] = []
    seen: set[str] = set()
    for row in data_rows:
        if col_idx >= len(row):
            continue
        value = (row[col_idx] or "").strip()
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            companies.append(value)

    if not companies:
        raise HTTPException(status_code=422, detail="No company names found in the CSV.")

    logger.info("Parsed %d companies from CSV for user=%s", len(companies), current_user.get("email"))
    return {"companies": companies, "total": len(companies)}


@router.post("/launch-direct", response_model=RequestIntakeResponse, status_code=202)
async def launch_direct_companies_endpoint(
    body: DirectCompaniesCreate,
    background_tasks: BackgroundTasks,
    draft_id: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Launch the 'direct companies → decision makers' flow.

    Persists the request (new or from a draft) and kicks off the
    direct-companies pipeline in the background.
    """
    logger.info(
        "Direct-companies launch for user=%s companies=%d draft_id=%s",
        current_user.get("email"), len(body.companies), draft_id,
    )
    user_id = str(current_user["_id"])
    serper_api_key = await get_user_serper_key(user_id)
    if not serper_api_key:
        raise HTTPException(status_code=400, detail=SERPER_KEY_REQUIRED_MSG)
    estimate = usage.estimate_direct(len(body.companies))
    await usage.check_quota(user_id, current_user, estimate)
    request_id = await svc.create_direct_companies_request(body, user_id, draft_id)
    await usage.begin_run(user_id, request_id, estimate)

    await _launch_durable(
        background_tasks,
        user_id,
        request_id,
        pipeline_jobs.PIPELINE_DIRECT,
        {
            "request_id": request_id,
            "companies": body.companies,
            "target_roles": body.target_roles,
            "user_id": user_id,
        },
        fallback=(
            run_direct_companies_background, request_id, body.companies, body.target_roles, user_id, serper_api_key
        ),
    )

    return RequestIntakeResponse(
        message="Direct companies request created. Decision-maker discovery started in background.",
        request_id=request_id,
        status="Pending",
    )
