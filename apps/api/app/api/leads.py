import asyncio
import json
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status, Response
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel

from app.core.config import settings
from app.core.logger import logger
from app.db.leads import get_lead_for_user, update_lead_fields
from app.db.requests import get_request_by_id
from app.db.signals import save_intent_analysis
from app.db.users import get_user_serper_key
from app.schemas.leads import LeadsListResponse
from app.services.auth import bearer_scheme, get_current_user
from app.services.serper import current_serper_key
from app.services.leads import (
    get_decision_makers_service,
    get_leads_for_request,
    get_request_status_summary,
    run_lead_pipeline,
    run_pipeline_background,
)
from app.services.signals.orchestrator import collect_all_signals
from app.services.export_service import (
    generate_csv,
    generate_xlsx,
    generate_companies_pdf,
    generate_competitors_pdf,
    generate_decision_makers_pdf,
)
from app.services.email_verification import verify_email, verify_emails_batch

router = APIRouter(prefix="/leads", tags=["leads"])


async def _get_current_user_sse(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    token: Optional[str] = Query(None),
):
    """Auth dependency for SSE endpoints: accepts bearer header OR ?token= query param."""
    from app.db.users import get_user_by_id

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
    )

    raw_token = credentials.credentials if credentials else token
    if not raw_token:
        raise credentials_exception

    try:
        payload = jwt.decode(raw_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = await get_user_by_id(user_id)
    if user is None:
        raise credentials_exception
    return user


@router.get("/status/{request_id}/stream")
async def stream_request_status(
    request_id: str,
    request: Request,
    current_user: dict = Depends(_get_current_user_sse),
):
    """SSE endpoint that streams status updates for a lead request until terminal state."""
    terminal = {"completed", "failed"}

    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
            try:
                data = await get_request_status_summary(request_id, current_user["_id"])
            except HTTPException:
                yield f"data: {json.dumps({'error': 'not_found'})}\n\n"
                break

            yield f"data: {json.dumps(data)}\n\n"

            if data["status"].lower() in terminal:
                break

            await asyncio.sleep(2)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/status/{request_id}")
async def get_request_status(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_request_status_summary(request_id, current_user["_id"])


@router.get("")
async def get_leads(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_leads_for_request(request_id, current_user["_id"])




class IntentAnalyzeRequest(BaseModel):
    request_id: str
    lead_index: int


@router.post("/intent/analyze")
async def analyze_lead_intent(
    body: IntentAnalyzeRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    On-demand intent analysis for a specific lead.

    Triggered when the user clicks "Analyze Intent" on a lead card.
    Runs all 5 signal sources in parallel (~7-9 Serper queries) and
    returns the intent score, signal timeline, and AI summary.
    """
    user_id = str(current_user["_id"])

    serper_api_key = await get_user_serper_key(user_id)
    if not serper_api_key:
        raise HTTPException(
            status_code=400,
            detail="Add your Serper API key in Profile to analyze intent.",
        )
    current_serper_key.set(serper_api_key)

    doc = await get_request_by_id(body.request_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Lead request not found")

    from app.services.leads import get_leads_for_request
    leads_data = await get_leads_for_request(body.request_id, user_id)
    leads = leads_data.get("leads") or []
    if body.lead_index < 0 or body.lead_index >= len(leads):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid lead_index {body.lead_index}. "
                   f"Valid range: 0-{len(leads) - 1}",
        )

    lead = leads[body.lead_index]
    company_name = lead.get("company_name") or lead.get("title") or "Unknown"

    logger.info(
        "Intent analysis requested for lead '%s' (index=%d, request=%s)",
        company_name, body.lead_index, body.request_id,
    )


    try:
        intent_result = await collect_all_signals(lead, doc)
    except Exception as exc:
        logger.error(
            "Intent analysis failed for '%s': %s", company_name, exc,
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Intent analysis failed: {str(exc)}",
        )


    try:
        await save_intent_analysis(
            body.request_id, body.lead_index, intent_result,
        )
    except Exception as exc:
        logger.warning("Failed to persist intent results: %s", exc)
        # Don't fail the request — return the results even if save fails

    return {
        "success": True,
        "company_name": company_name,
        "lead_index": body.lead_index,
        **intent_result,
    }


@router.get("/intent/{request_id}/{lead_index}")
async def get_lead_intent(
    request_id: str,
    lead_index: int,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieve existing intent analysis data for a specific lead.

    Returns cached results if the lead has already been analyzed,
    or a minimal response indicating no analysis has been performed yet.
    """
    user_id = str(current_user["_id"])

    from app.services.leads import get_leads_for_request
    leads_data = await get_leads_for_request(request_id, user_id)
    leads = leads_data.get("leads") or []
    if lead_index < 0 or lead_index >= len(leads):
        raise HTTPException(status_code=400, detail="Invalid lead index")

    lead = leads[lead_index]


    if lead.get("intent_score") is not None:
        return {
            "analyzed": True,
            "company_name": lead.get("company_name") or lead.get("title") or "",
            "lead_index": lead_index,
            "intent_score": lead.get("intent_score"),
            "intent_band": lead.get("intent_band"),
            "band_emoji": lead.get("band_emoji"),
            "band_action": lead.get("band_action"),
            "intent_signals": lead.get("intent_signals", []),
            "intent_summary": lead.get("intent_summary", ""),
            "score_breakdown": lead.get("score_breakdown", {}),
            "pillar_details": lead.get("pillar_details", {}),
            "total_signals": lead.get("total_signals", 0),
            "intent_score_updated_at": lead.get("intent_score_updated_at"),
            "signal_timeline": lead.get("signal_timeline", []),
        }

    return {
        "analyzed": False,
        "company_name": lead.get("company_name") or lead.get("title") or "",
        "lead_index": lead_index,
        "message": "Intent analysis has not been performed yet. "
                   "Click 'Analyze Intent' to start.",
    }


@router.get("/decision-makers")
async def get_decision_makers(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    return await get_decision_makers_service(request_id, current_user["_id"])

@router.get("/{request_id}/export/companies")
async def export_companies(
    request_id: str,
    format: str = Query("csv", pattern="^(csv|xlsx|pdf)$"),
    current_user: dict = Depends(get_current_user),
):
    from app.services.leads import get_leads_for_request
    leads_data = await get_leads_for_request(request_id, str(current_user["_id"]))
    leads = leads_data.get("leads", [])

    if format == "pdf":
        pdf_data = generate_companies_pdf(leads)
        return Response(
            content=pdf_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=quarry_companies_{request_id}.pdf"}
        )

    headers = [
        "Company Name", "ICP Match Score", "Intent Score", "Intent Band", 
        "Industry", "Employee Size Estimate", "Growth", "Funding Stage", 
        "Tech Stack", "Signals", "Deep Intent Signals", "Location", 
        "Website URL", "Description"
    ]
    rows = []
    for lead in leads:
        name = lead.get("company_name") or lead.get("name") or lead.get("title") or ""
        score = lead.get("match_score", "")
        intent_score = lead.get("intent_score", "")
        intent_band = lead.get("intent_band", "")
        industry = lead.get("industry", "")
        employees = lead.get("employee_size_estimate", "")
        growth = lead.get("growth", "")
        funding = lead.get("funding_stage", "")
        tech = "; ".join(lead.get("tech_stack", []))
        signals = "; ".join(lead.get("signals", []))
        intent_signals = " | ".join([f"{s.get('type')}: {s.get('summary')}" for s in lead.get("intent_signals", [])])
        location = lead.get("location", "")
        url = lead.get("url", "")
        description = lead.get("description", "")
        
        rows.append([name, score, intent_score, intent_band, industry, employees, growth, funding, tech, signals, intent_signals, location, url, description])

    if format == "xlsx":
        xlsx_data = generate_xlsx("Companies", headers, rows)
        return Response(
            content=xlsx_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=quarry_companies_{request_id}.xlsx"}
        )


    csv_data = generate_csv(headers, rows)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=quarry_companies_{request_id}.csv"}
    )

@router.get("/{request_id}/export/competitors")
async def export_competitors(
    request_id: str,
    format: str = Query("csv", pattern="^(csv|xlsx|pdf)$"),
    current_user: dict = Depends(get_current_user),
):
    from app.services.competitor_service import get_competitors

    user_id = str(current_user["_id"])
    doc = await get_request_by_id(request_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Lead request not found")

    comp_doc = await get_competitors(request_id, user_id)
    competitors = comp_doc.get("competitors", [])

    if format == "pdf":
        pdf_data = generate_competitors_pdf(competitors)
        return Response(
            content=pdf_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=quarry_competitors_{request_id}.pdf"}
        )
    
    headers = ["Competitor Name", "Category", "G2 Rating", "Employee Size", "Location", "Specialties", "Funding", "Description"]
    rows = []
    for comp in competitors:
        name = comp.get("name", "") or comp.get("company_name", "")
        category = comp.get("category", "") or comp.get("tier", "")
        rating = comp.get("rating", "") or comp.get("g2_rating", "")
        size = comp.get("size", "") or comp.get("employee_count", "") or comp.get("company_size", "")
        location = comp.get("location", "") or comp.get("headquarters", "")
        specialties = comp.get("specialties", "")
        funding = comp.get("funding", "") or comp.get("funding_stage", "")
        description = comp.get("description", "")
        
        rows.append([name, category, rating, size, location, specialties, funding, description])
        
    if format == "xlsx":
        xlsx_data = generate_xlsx("Competitors", headers, rows)
        return Response(
            content=xlsx_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=quarry_competitors_{request_id}.xlsx"}
        )


    csv_data = generate_csv(headers, rows)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=quarry_competitors_{request_id}.csv"}
    )


def _group_decision_makers_by_lead(decision_makers) -> dict:
    """Index decision makers by ``lead_id``.

    ``get_decision_makers_service`` returns a flat list of contacts, so it has to
    be grouped before it can be joined against the request's leads. A mapping is
    also accepted so both shapes are handled.
    """
    if isinstance(decision_makers, dict):
        return {str(key): list(value or []) for key, value in decision_makers.items()}

    grouped: dict = {}
    for dm in decision_makers or []:
        grouped.setdefault(str(dm.get("lead_id", "")), []).append(dm)
    return grouped


@router.get("/{request_id}/export/decision-makers")
async def export_decision_makers(
    request_id: str,
    format: str = Query("csv", pattern="^(csv|xlsx|pdf)$"),
    current_user: dict = Depends(get_current_user),
):
    from app.services.leads import get_decision_makers_service, get_leads_for_request
    user_id = str(current_user["_id"])
    
    leads_data = await get_leads_for_request(request_id, user_id)
    leads = leads_data.get("leads", [])
    
    dm_data = await get_decision_makers_service(request_id, user_id)
    dm_map = _group_decision_makers_by_lead(dm_data.get("decision_makers"))

    # Flatten to contacts carrying their company once — every format needs the
    # same lead/contact join.
    flat_contacts = []
    joined_lead_ids = set()
    for lead in leads:
        company = lead.get("company_name") or lead.get("name") or lead.get("title") or ""
        lead_id = str(lead.get("_id", ""))
        contacts = dm_map.get(lead_id) or lead.get("decision_makers") or []
        if contacts:
            joined_lead_ids.add(lead_id)
        for dm in contacts:
            flat_dm = dict(dm)
            flat_dm["company"] = company
            flat_contacts.append(flat_dm)

    # Keep contacts whose lead is absent from the leads payload instead of
    # dropping them from the export.
    for lead_id, contacts in dm_map.items():
        if lead_id in joined_lead_ids:
            continue
        for dm in contacts:
            flat_dm = dict(dm)
            flat_dm["company"] = dm.get("company_name") or ""
            flat_contacts.append(flat_dm)

    if format == "pdf":
        pdf_data = generate_decision_makers_pdf(flat_contacts)
        return Response(
            content=pdf_data,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename=quarry_all_decision_makers_{request_id}.pdf"}
        )
    
    headers = ["Company", "Name", "Title", "Seniority", "Department", "Location", "LinkedIn URL", "Email", "Snippet"]
    rows = []
    for dm in flat_contacts:
        rows.append([
            dm.get("company", ""),
            dm.get("name", ""),
            dm.get("title", ""),
            dm.get("seniority", ""),
            dm.get("department", ""),
            dm.get("location", ""),
            dm.get("linkedin_url") or dm.get("url") or "",
            dm.get("email", ""),
            dm.get("snippet") or "",
        ])
            
    if format == "xlsx":
        xlsx_data = generate_xlsx("Decision Makers", headers, rows)
        return Response(
            content=xlsx_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=quarry_all_decision_makers_{request_id}.xlsx"}
        )


    csv_data = generate_csv(headers, rows)
    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=quarry_all_decision_makers_{request_id}.csv"}
    )


# ---------------------------------------------------------------------------
# Email Verification Endpoints
# ---------------------------------------------------------------------------

class EmailVerifyRequest(BaseModel):
    email: str


class EmailsBatchRequest(BaseModel):
    emails: List[str]


@router.post("/verify-email")
async def verify_single_email(
    body: EmailVerifyRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Verify a single email address using DNS MX lookup + SMTP probe.
    Saves the result back to the lead record (if lead_id provided).
    """
    result = await verify_email(body.email)
    return result


@router.post("/verify-emails-batch")
async def verify_emails_in_batch(
    body: EmailsBatchRequest,
    current_user: dict = Depends(get_current_user),
):
    """Verify multiple emails concurrently (up to 50)."""
    emails = body.emails[:50]  # safety cap
    results = await verify_emails_batch(emails)
    return {"results": results}


@router.post("/{lead_id}/verify-email")
async def verify_and_save_email(
    lead_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Verify the email on a specific lead and persist the result.
    Returns verification badge data.
    """
    user_id = str(current_user["_id"])

    lead = await get_lead_for_user(lead_id, user_id)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    email = lead.get("email")
    if not email:
        raise HTTPException(status_code=400, detail="Lead has no email address to verify")

    result = await verify_email(email)

    # Persist verification result on the lead document
    await update_lead_fields(lead_id, {
        "email_verified": result["verified"],
        "email_confidence": result["confidence"],
        "email_verify_method": result["method"],
        "email_verify_reason": result["reason"],
    })

    return result


# ---------------------------------------------------------------------------
# Lead-Lists membership endpoint
# ---------------------------------------------------------------------------

@router.get("/{lead_id}/lists")
async def get_lead_list_memberships(
    lead_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return all lists that contain the given lead."""
    from app.db.lead_lists import get_lists_for_lead
    user_id = str(current_user["_id"])
    docs = await get_lists_for_lead(lead_id, user_id)
    return {"lists": [{"id": d["_id"], "name": d["name"], "color": d.get("color", "#6366f1")} for d in docs]}
