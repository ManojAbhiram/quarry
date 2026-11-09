import logging

from fastapi import APIRouter, Depends

from app.services.auth import get_current_user
import app.services.competitor_service as svc

logger = logging.getLogger("app.api.competitors")

router = APIRouter(prefix="/requests", tags=["competitors"])
@router.get("/find-competitors")
async def get_competitors_endpoint(
    request_id: str,
    current_user: dict = Depends(get_current_user),
):
    logger.info("get-competitors for user=%s request_id=%s", current_user.get("email"), request_id)
    doc = await svc.get_competitors(request_id, str(current_user["_id"]))
    competitors = doc.get("competitors", [])
    return {
        "request_id": request_id,
        "status": doc.get("status"),
        "total": len(competitors),
        "results": competitors,
    }
