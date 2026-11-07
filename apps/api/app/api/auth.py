from fastapi import APIRouter, HTTPException, Request, status

import httpx

from app.core.config import settings
from app.core.logger import logger
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
from app.services.users import find_or_create_google_user
from app.services.email import send_password_reset_email
from app.schemas import (
    RegisterRequest, LoginRequest, AuthResponse,
    RefreshRequest, RefreshResponse,
    ForgotPasswordRequest, ResetPasswordRequest,
    user_to_out,
)
from app.schemas.auth import GoogleCallbackRequest, LogoutRequest

router = APIRouter(prefix="/auth", tags=["auth"])

_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, request: Request):
    if await get_user_by_email(body.email):
        logger.warning("Registration attempt for existing email: %s", body.email)
        raise HTTPException(status_code=400, detail="Email already registered")

    logger.info("Registering new user: %s", body.email)
    org_doc = await create_organization(body.org_name, body.org_domain)
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
    user_id, doc = await insert_user(doc)
    access_token = create_access_token(user_id)
    refresh_token = create_refresh_token(user_id)

    await create_session(
        user_id=user_id,
        token_hash=hash_token(refresh_token),
        expires_at=refresh_token_expiry(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return AuthResponse(access_token=access_token, refresh_token=refresh_token, user=user_to_out(doc))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, request: Request):
    await purge_expired_sessions()
    user = await get_user_by_email(body.email)
    if not user:
        logger.warning("Failed login attempt for email: %s", body.email)
        raise HTTPException(status_code=401, detail="No account found with this email address.")
    if not user.get("password_hash"):
        logger.warning("Password login attempted on Google-only account: %s", body.email)
        raise HTTPException(
            status_code=401,
            detail="This account was created with Google Sign-In. Use 'Forgot Password' to set a password and enable email login.",
        )
    if not verify_password(body.password, user["password_hash"]):
        logger.warning("Failed login attempt for email: %s", body.email)
        raise HTTPException(status_code=401, detail="Incorrect password. Please try again.")

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
    return AuthResponse(access_token=access_token, refresh_token=refresh_token, user=user_to_out(user))


@router.post("/refresh", response_model=RefreshResponse)
async def refresh(body: RefreshRequest, request: Request):
    user_id = await verify_refresh_token(body.refresh_token)
    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    old_hash = hash_token(body.refresh_token)
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
    return RefreshResponse(access_token=new_access_token, refresh_token=new_refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest):
    if body.refresh_token:
        await delete_session_by_token_hash(hash_token(body.refresh_token))
        logger.info("Session invalidated via logout")
    return None


@router.post("/forgot-password", status_code=status.HTTP_200_OK)
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


@router.post("/reset-password", status_code=status.HTTP_200_OK)
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


@router.post("/google/callback", response_model=AuthResponse)
async def google_callback_api(body: GoogleCallbackRequest, request: Request):
    """Exchange a Google authorization code for app JWT tokens."""
    redirect_uri = f"{settings.FRONTEND_URL}/auth/google/callback"

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": body.code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )

    if token_resp.status_code != 200:
        logger.error("Google token exchange failed: %s", token_resp.text)
        raise HTTPException(status_code=401, detail="Google authentication failed")

    google_access_token = token_resp.json().get("access_token")

    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_access_token}"},
        )

    if userinfo_resp.status_code != 200:
        logger.error("Google userinfo fetch failed: %s", userinfo_resp.text)
        raise HTTPException(status_code=401, detail="Failed to fetch Google user info")

    profile = userinfo_resp.json()
    google_id: str = profile.get("sub", "")
    email: str = profile.get("email", "").lower().strip()
    name: str = profile.get("name", email.split("@")[0] if email else "")

    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email address")

    user_id, user = await find_or_create_google_user(google_id, email, name)

    app_access_token = create_access_token(user_id)
    app_refresh_token = create_refresh_token(user_id)

    await create_session(
        user_id=user_id,
        token_hash=hash_token(app_refresh_token),
        expires_at=refresh_token_expiry(),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return AuthResponse(
        access_token=app_access_token,
        refresh_token=app_refresh_token,
        user=user_to_out(user),
    )
