from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.core.cookies import (
    CSRF_COOKIE, REFRESH_COOKIE, check_csrf, clear_auth_cookies, new_csrf_token, set_auth_cookies,
)
from app.core.logger import logger
from app.core.rate_limit import auth_rate_limit
from app.db.users import (
    get_user_by_email,
    get_user_by_id,
    insert_user,
    update_user,
)
from app.db.organizations import create_organization
from app.db.user_sessions import (
    create_session,
    delete_session,
    delete_session_by_token_hash,
    get_session_by_token_hash,
    purge_expired_sessions,
)
from app.services.auth import (
    hash_password, verify_password, hash_token,
    create_access_token, create_refresh_token, verify_refresh_token,
    create_password_reset_token, verify_password_reset_token,
    refresh_token_expiry,
)
from app.services.email import send_password_reset_email
from app.schemas import (
    RegisterRequest, LoginRequest, AuthResponse,
    RefreshRequest, RefreshResponse,
    ForgotPasswordRequest, ResetPasswordRequest,
    user_to_out,
)
from app.schemas.auth import LogoutRequest

router = APIRouter(prefix="/auth", tags=["auth"])

# One message for every failed login, so the response never reveals whether an email is registered.
INVALID_LOGIN = "Invalid email or password. If you signed up with Google, use Continue with Google."



@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(auth_rate_limit)])
async def register(body: RegisterRequest, request: Request, response: Response):
    if await get_user_by_email(body.email):
        logger.warning("Registration attempt for existing email: %s", body.email)
        raise HTTPException(status_code=400, detail="Email already registered")

    logger.info("Registering new user: %s", body.email)
    try:
        org_doc = await create_organization(body.org_name, body.org_domain)
    except IntegrityError:
        raise HTTPException(status_code=400, detail="Organization domain already registered") from None
    org_id = str(org_doc["_id"])

    doc = {
        "email": body.email,
        "name": body.name,
        "password_hash": hash_password(body.password),
        "org_id": org_id,
        "company": body.org_name,
        "job_title": None,
        "phone": None,
    }
    try:
        user_id, doc = await insert_user(doc)
    except IntegrityError:  # lost a race against a concurrent signup with the same email
        raise HTTPException(status_code=400, detail="Email already registered") from None
    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)

    await create_session(
        user_id=user_id,
        token_hash=hash_token(refresh_token),
        expires_at=refresh_token_expiry(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    set_auth_cookies(response, access_token, refresh_token)
    return AuthResponse(access_token=access_token, refresh_token=refresh_token, user=user_to_out(doc))


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(auth_rate_limit)])
async def login(body: LoginRequest, request: Request, response: Response):
    await purge_expired_sessions()
    user = await get_user_by_email(body.email)
    if not user:
        logger.warning("Failed login attempt for email: %s", body.email)
        raise HTTPException(status_code=401, detail=INVALID_LOGIN)
    if not user.get("password_hash"):
        logger.warning("Password login attempted on Google-only account: %s", body.email)
        raise HTTPException(status_code=401, detail=INVALID_LOGIN)
    if not verify_password(body.password, user["password_hash"]):
        logger.warning("Failed login attempt for email: %s", body.email)
        raise HTTPException(status_code=401, detail=INVALID_LOGIN)

    logger.info("User logged in: %s", body.email)
    user_id = str(user["_id"])
    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)

    await create_session(
        user_id=user_id,
        token_hash=hash_token(refresh_token),
        expires_at=refresh_token_expiry(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    set_auth_cookies(response, access_token, refresh_token)
    return AuthResponse(access_token=access_token, refresh_token=refresh_token, user=user_to_out(user))


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(request: Request, response: Response, body: RefreshRequest | None = None):
    old_token = body.refresh_token if body and body.refresh_token else None
    if not old_token:
        old_token = request.cookies.get(REFRESH_COOKIE)
        if old_token:
            check_csrf(request)  # cookie-borne credential: require the CSRF header
    if not old_token:
        raise HTTPException(status_code=401, detail="Missing refresh token")
    user_id = await verify_refresh_token(old_token)
    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    old_hash = hash_token(old_token)
    session = await get_session_by_token_hash(old_hash)
    if session is None:
        raise HTTPException(status_code=401, detail="Session expired or already refreshed")

    new_access_token = create_access_token(user_id)
    new_refresh_token = create_refresh_token(user_id)

    await delete_session(session["_id"])
    await create_session(
        user_id=user_id,
        token_hash=hash_token(new_refresh_token),
        expires_at=refresh_token_expiry(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    logger.info("Token refreshed for user_id: %s", user_id)
    set_auth_cookies(response, new_access_token, new_refresh_token)
    return RefreshResponse(access_token=new_access_token, refresh_token=new_refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, response: Response, body: LogoutRequest | None = None):
    token = (body.refresh_token if body else None) or request.cookies.get(REFRESH_COOKIE)
    if token:
        await delete_session_by_token_hash(hash_token(token))
        logger.info("Session invalidated via logout")
    clear_auth_cookies(response)
    return None


@router.get("/csrf")
async def csrf_token(request: Request, response: Response):
    """Return the CSRF token for the current cookie session (issuing a fresh cookie if it is missing)."""
    token = request.cookies.get(CSRF_COOKIE)
    if not token:
        token = new_csrf_token()
        response.set_cookie(
            CSRF_COOKIE, token, max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400, httponly=False, path="/",
            secure=settings.COOKIE_SECURE or settings.COOKIE_SAMESITE == "none", samesite=settings.COOKIE_SAMESITE,
            domain=settings.COOKIE_DOMAIN or None,
        )
    return {"csrf_token": token}


@router.post("/forgot-password", status_code=status.HTTP_200_OK, dependencies=[Depends(auth_rate_limit)])
async def forgot_password(body: ForgotPasswordRequest):
    user = await get_user_by_email(body.email)
    if user:
        token = create_password_reset_token(str(user["_id"]))
        try:
            await send_password_reset_email(body.email, token)
            logger.info("Password reset email sent to %s", body.email)
        except Exception as e:
            logger.error("Failed to send password reset email to %s: %s", body.email, e)
    return {"message": "If an account with that email exists, a reset link has been sent."}


@router.post("/reset-password", status_code=status.HTTP_200_OK, dependencies=[Depends(auth_rate_limit)])
async def reset_password(body: ResetPasswordRequest):
    user_id = await verify_password_reset_token(body.token)
    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    await update_user(str(user["_id"]), {"password_hash": hash_password(body.new_password)})
    logger.info("Password reset successfully for user_id: %s", user_id)
    return {"message": "Password has been reset successfully. You can now log in with your new password."}


@router.get("/google/url")
async def get_google_auth_url():
    backend_oauth_start = settings.GOOGLE_REDIRECT_URI.removesuffix("/callback")
    return {"url": backend_oauth_start}
