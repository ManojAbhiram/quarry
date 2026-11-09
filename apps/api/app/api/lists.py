"""
Lead Lists API
==============
CRUD endpoints for user-defined lead collections ("lists").

Routes
------
GET    /lists                           – list all lists for current user
POST   /lists                           – create a new list
GET    /lists/{list_id}                 – get a single list with its leads
PUT    /lists/{list_id}                 – rename / recolor / update description
DELETE /lists/{list_id}                 – delete a list
POST   /lists/{list_id}/leads           – add leads to a list (bulk)
DELETE /lists/{list_id}/leads           – remove leads from a list (bulk)
GET    /lists/lead/{lead_id}            – get all lists that contain a lead
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app.crm.hooks import schedule_event
from app.db import lead_lists as db_lists
from app.db.leads import get_leads_by_ids
from app.services.auth import get_current_user
from app.services.export_service import generate_csv, generate_xlsx

router = APIRouter(prefix="/lists", tags=["lead-lists"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CreateListRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    color: str = "#6366f1"
    description: Optional[str] = None


class UpdateListRequest(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    color: Optional[str] = None
    description: Optional[str] = None


class LeadIdsRequest(BaseModel):
    lead_ids: List[str] = Field(..., min_length=1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize(doc: dict) -> dict:
    """Make a list document JSON-serialisable."""
    out = dict(doc)
    for ts_field in ("created_at", "updated_at"):
        val = out.get(ts_field)
        if val is not None:
            out[ts_field] = val.isoformat()
    return out


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("")
async def list_all(current_user: dict = Depends(get_current_user)):
    """Return all lists owned by the current user."""
    user_id = str(current_user["_id"])
    docs = await db_lists.get_lead_lists_for_user(user_id)
    return {"lists": [_serialize(d) for d in docs]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_list(
    body: CreateListRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    doc = await db_lists.create_lead_list(
        user_id=user_id,
        name=body.name,
        color=body.color,
        description=body.description,
    )
    return _serialize(doc)


@router.get("/lead/{lead_id}")
async def get_lists_for_lead(
    lead_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Return all lists that contain the given lead."""
    user_id = str(current_user["_id"])
    docs = await db_lists.get_lists_for_lead(lead_id, user_id)
    return {"lists": [_serialize(d) for d in docs]}


@router.get("/{list_id}")
async def get_list(
    list_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    doc = await db_lists.get_lead_list_by_id(list_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="List not found")

    # Enrich with lead details
    lead_ids = doc.get("lead_ids") or []
    leads = []
    if lead_ids:
        raw_leads = await get_leads_by_ids(lead_ids, user_id)
        # Build a quick lookup by _id
        by_id = {str(l["_id"]): l for l in raw_leads}
        for lid in lead_ids:
            lead_doc = by_id.get(lid)
            if lead_doc:
                leads.append({
                    "id": str(lead_doc["_id"]),
                    "title": lead_doc.get("title", ""),
                    "url": lead_doc.get("url", ""),
                    "email": lead_doc.get("email"),
                    "match_score": lead_doc.get("match_score"),
                    "email_verified": lead_doc.get("email_verified"),
                    "email_confidence": lead_doc.get("email_confidence"),
                })

    result = _serialize(doc)
    result["leads"] = leads
    return result


@router.put("/{list_id}")
async def update_list(
    list_id: str,
    body: UpdateListRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    doc = await db_lists.update_lead_list(list_id, user_id, updates)
    if not doc:
        raise HTTPException(status_code=404, detail="List not found")
    return _serialize(doc)


@router.delete("/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_list(
    list_id: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    deleted = await db_lists.delete_lead_list(list_id, user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="List not found")


@router.post("/{list_id}/leads")
async def add_leads(
    list_id: str,
    body: LeadIdsRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    doc = await db_lists.add_leads_to_list(list_id, user_id, body.lead_ids)
    if not doc:
        raise HTTPException(status_code=404, detail="List not found")
    schedule_event(user_id, "list.updated", {"list": {"id": list_id, "name": doc.get("name"), "lead_count": len(doc.get("lead_ids") or [])}, "change": "leads_added"})
    return {"message": f"Added {len(body.lead_ids)} lead(s) to list", "list": _serialize(doc)}


@router.delete("/{list_id}/leads")
async def remove_leads(
    list_id: str,
    body: LeadIdsRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = str(current_user["_id"])
    doc = await db_lists.remove_leads_from_list(list_id, user_id, body.lead_ids)
    if not doc:
        raise HTTPException(status_code=404, detail="List not found")
    schedule_event(user_id, "list.updated", {"list": {"id": list_id, "name": doc.get("name"), "lead_count": len(doc.get("lead_ids") or [])}, "change": "leads_removed"})
    return {"message": f"Removed {len(body.lead_ids)} lead(s) from list", "list": _serialize(doc)}


def _safe_filename(name: str) -> str:
    """Turn a list name into a filesystem-safe filename fragment."""
    cleaned = "".join(c if c.isalnum() or c in "-_ " else "" for c in (name or "list")).strip()
    return (cleaned.replace(" ", "_") or "list")[:60]


@router.get("/{list_id}/export")
async def export_list(
    list_id: str,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
    current_user: dict = Depends(get_current_user),
):
    """Export a list's leads as CSV or XLSX."""
    user_id = str(current_user["_id"])
    doc = await db_lists.get_lead_list_by_id(list_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="List not found")

    lead_ids = doc.get("lead_ids") or []
    by_id: dict = {}
    if lead_ids:
        raw_leads = await get_leads_by_ids(lead_ids, user_id)
        by_id = {str(l["_id"]): l for l in raw_leads}

    headers = [
        "Company / Title", "Email", "Email Verified", "Email Confidence",
        "Phone", "ICP Match Score", "Website URL",
    ]
    rows = []
    for lid in lead_ids:  # preserve the list's ordering
        lead = by_id.get(lid)
        if not lead:
            continue
        verified = lead.get("email_verified")
        verified_str = "" if verified is None else ("Yes" if verified else "No")
        rows.append([
            lead.get("title", ""),
            lead.get("email") or "",
            verified_str,
            lead.get("email_confidence") or "",
            lead.get("phone") or "",
            lead.get("match_score", ""),
            lead.get("url", ""),
        ])

    fname = _safe_filename(doc.get("name"))
    if format == "xlsx":
        data = generate_xlsx("Leads", headers, rows)
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=quarry_{fname}.xlsx"},
        )

    data = generate_csv(headers, rows)
    return Response(
        content=data,
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=quarry_{fname}.csv"},
    )
