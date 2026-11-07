from fastapi import APIRouter, Depends, status

from app.services.auth import get_current_user
from app.services import requests as svc
from app.schemas.requests import LeadRequestCreate, LeadRequestOut, DraftUpdateRequest, StatsOut, RequestListsUpdate

router = APIRouter(prefix="/requests", tags=["requests"])


@router.post("", status_code=201)
async def create_lead_request(
    body: LeadRequestCreate,
    current_user: dict = Depends(get_current_user),
):
    org_id = current_user.get("org_id") or None
    return await svc.create_request(current_user["_id"], org_id, body)


@router.get("", response_model=list[LeadRequestOut])
async def list_requests(current_user: dict = Depends(get_current_user)):
    return await svc.list_requests(current_user["_id"])


@router.get("/stats", response_model=StatsOut)
async def get_stats(current_user: dict = Depends(get_current_user)):
    return await svc.get_request_stats(current_user["_id"])


@router.delete("/{request_id}", status_code=204)
async def delete_request(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    await svc.delete_request(request_id, current_user["_id"])
    return None


@router.put("/{request_id}", response_model=LeadRequestOut)
async def update_lead_request(
    request_id: str,
    body: DraftUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    return await svc.update_request(request_id, current_user["_id"], body)


@router.put("/{request_id}/lists", response_model=LeadRequestOut)
async def update_request_lists(
    request_id: str,
    body: RequestListsUpdate,
    current_user: dict = Depends(get_current_user),
):
    return await svc.update_request_lists(request_id, current_user["_id"], body)
