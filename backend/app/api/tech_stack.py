import time

from fastapi import APIRouter

from app.core.logger import logger
from app.schemas.tech_stack import TechStackDetectionRequest, TechStackDetectionResponse
from app.services.tech_stack import detect_full_tech_profile

router = APIRouter(prefix="/tech-stack", tags=["tech-stack"])


@router.post("/detect", response_model=TechStackDetectionResponse)
async def detect_technologies(request: TechStackDetectionRequest):
    try:
        start_time = time.time()
        logger.info("[/detect] Running full tech stack pipeline for: %s", request.url)
        profile = await detect_full_tech_profile(request.url, timeout=request.timeout)

        if profile.get("errors"):
            for err in profile["errors"]:
                logger.warning("[/detect] Pipeline partial failure for %s: %s", request.url, err)

        infra_profile = {
            "technologies_by_category": profile.get("infrastructure", {}),
            "dns_infrastructure": profile.get("dns_infrastructure", {}),
            "careers": profile.get("careers", {}),
            "tech_provenance": profile.get("tech_provenance", {}),
        }
        execution_time = (time.time() - start_time) * 1000

        return TechStackDetectionResponse(
            status="success",
            url=profile.get("url", request.url),
            technologies=profile.get("technologies", []),
            infrastructure=infra_profile,
            execution_time_ms=execution_time,
        )

    except Exception as e:
        logger.error("[/detect] Error detecting tech stack: %s", e, exc_info=True)
        return TechStackDetectionResponse(
            status="error",
            url=request.url,
            technologies=[],
            infrastructure={},
            execution_time_ms=0,
            error=str(e),
        )
