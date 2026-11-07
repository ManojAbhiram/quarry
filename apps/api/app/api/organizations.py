from fastapi import APIRouter, Depends, HTTPException, status

from app.core.logger import logger
from app.db.organizations import (
    create_organization,
    get_organization_by_domain,
    get_organization_by_id,
    update_organization,
)
from app.db.users import update_user
from app.services.auth import get_current_user
from app.schemas.organizations import OrganizationCreate, OrganizationUpdate, org_to_out

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_organization_endpoint(
    body: OrganizationCreate,
    current_user: dict = Depends(get_current_user),
):
    if await get_organization_by_domain(body.domain):
        raise HTTPException(status_code=409, detail="An organization with this domain already exists")

    org = await create_organization(name=body.name, domain=body.domain)
    await update_user(str(current_user["_id"]), {"org_id": org["_id"]})
    logger.info("User %s linked to org %s", current_user.get("email"), org["_id"])
    return org_to_out(org)


@router.get("/me")
async def get_my_organization(current_user: dict = Depends(get_current_user)):
    org_id = current_user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=404, detail="You are not associated with any organization")

    org = await get_organization_by_id(str(org_id))
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org_to_out(org)


@router.put("/me")
async def update_my_organization(
    body: OrganizationUpdate,
    current_user: dict = Depends(get_current_user),
):
    org_id = current_user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=404, detail="You are not associated with any organization")

    update_fields: dict = {}
    if body.name is not None:
        update_fields["name"] = body.name
    if body.domain is not None:
        update_fields["domain"] = body.domain.lower().strip()

    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    org = await update_organization(str(org_id), update_fields)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org_to_out(org)
