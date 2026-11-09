"""Google OAuth2 SSO flow.

Mounted under the API prefix, so the registered redirect URI must match
GOOGLE_REDIRECT_URI (default http://localhost:8000/api/auth/google/callback).
"""
import urllib.parse

import httpx
from fastapi import APIRouter, status
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.logger import logger
from app.db.user_sessions import create_session
from app.services.auth import create_access_token, create_refresh_token, hash_token, refresh_token_expiry
from app.services.users import find_or_create_google_user

router = APIRouter(prefix="/auth/google", tags=["google-auth"])

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


@router.get("")
async def google_login():
    """Redirect the browser to Google's OAuth consent page."""
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
    }
    url = f"{_GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"
    return RedirectResponse(url=url, status_code=status.HTTP_302_FOUND)


@router.get("/callback")
async def google_callback(code: str | None = None, error: str | None = None):
    """Handle Google's redirect after the user grants permission."""
    frontend_callback = f"{settings.FRONTEND_URL}/auth/google/callback"

    if error or not code:
        logger.warning("Google OAuth error: %s", error)
        return RedirectResponse(
            url=f"{frontend_callback}?error={urllib.parse.quote(error or 'access_denied')}",
            status_code=status.HTTP_302_FOUND,
        )

    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )

    if token_resp.status_code != 200:
        logger.error("Google token exchange failed: %s", token_resp.text)
        return RedirectResponse(
            url=f"{frontend_callback}?error=token_exchange_failed",
            status_code=status.HTTP_302_FOUND,
        )

    google_access_token = token_resp.json().get("access_token")

    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {google_access_token}"},
        )

    if userinfo_resp.status_code != 200:
        logger.error("Google userinfo fetch failed: %s", userinfo_resp.text)
        return RedirectResponse(
            url=f"{frontend_callback}?error=userinfo_failed",
            status_code=status.HTTP_302_FOUND,
        )

    profile = userinfo_resp.json()
    google_id: str = profile.get("sub", "")
    email: str = profile.get("email", "").lower().strip()
    name: str = profile.get("name", email.split("@")[0])

    if not email:
        return RedirectResponse(
            url=f"{frontend_callback}?error=no_email",
            status_code=status.HTTP_302_FOUND,
        )

    user_id, _ = await find_or_create_google_user(google_id, email, name)

    our_access_token = create_access_token(user_id)
    our_refresh_token = create_refresh_token(user_id)

    await create_session(
        user_id=user_id,
        token_hash=hash_token(our_refresh_token),
        expires_at=refresh_token_expiry(),
    )

    redirect_url = (
        f"{frontend_callback}"
        f"?access_token={urllib.parse.quote(our_access_token)}"
        f"&refresh_token={urllib.parse.quote(our_refresh_token)}"
    )
    return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)
