from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.db.engine import connect_db, close_db
from app.db.requests import fail_orphaned_requests
from app.api import auth, users, requests, leads, request_intake, competitors, tech_stack
from app.api import google_auth
from app.api import organizations
from app.api import verification as verification_router
from app.api import lists as lead_lists_router
from app.core.config import settings
from app.core.logger import logger
import traceback


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting up {settings.PROJECT_NAME}...")
    await connect_db()
    orphaned = await fail_orphaned_requests()
    if orphaned:
        logger.warning("Marked %d interrupted request(s) as Failed after restart", orphaned)
    yield
    logger.info(f"Shutting down {settings.PROJECT_NAME}...")
    await close_db()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception: %s\n%s", exc, traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )

app.include_router(auth.router, prefix=settings.API_V1_STR)
app.include_router(users.router, prefix=settings.API_V1_STR)
app.include_router(requests.router, prefix=settings.API_V1_STR)
app.include_router(leads.router, prefix=settings.API_V1_STR)
app.include_router(request_intake.router, prefix=settings.API_V1_STR)
app.include_router(competitors.router, prefix=settings.API_V1_STR)
app.include_router(tech_stack.router, prefix=settings.API_V1_STR)
app.include_router(organizations.router, prefix=settings.API_V1_STR)
app.include_router(google_auth.router, prefix=settings.API_V1_STR)
app.include_router(lead_lists_router.router, prefix=settings.API_V1_STR)
app.include_router(verification_router.router, prefix=settings.API_V1_STR)


@app.get(f"{settings.API_V1_STR}/health")
async def health():
    return {"status": "ok", "project": settings.PROJECT_NAME, "version": settings.VERSION}
