"""HttpOnly cookie sessions + double-submit CSRF protection.

Login, register, refresh and the Google callback set three cookies:

* quarry_access   HttpOnly  JWT access token          (path /)
* quarry_refresh  HttpOnly  JWT refresh token         (path /api/auth, so it is only sent to the auth routes)
* quarry_csrf     readable  random CSRF token         (path /)  -> the SPA echoes it in the X-CSRF-Token header

The Authorization: Bearer header keeps working for API clients and tests. A request authenticated by a Bearer header
is not exposed to CSRF (browsers never attach that header on their own), so the CSRF check only applies when the
credential came from a cookie and the method is unsafe (anything but GET/HEAD/OPTIONS).
"""
import hmac
import secrets

from fastapi import HTTPException, Request, Response, status

from app.core.config import settings

ACCESS_COOKIE = "quarry_access"
REFRESH_COOKIE = "quarry_refresh"
CSRF_COOKIE = "quarry_csrf"
CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


def _auth_path() -> str:
    return f"{settings.API_V1_STR}/auth"


def _common() -> dict:
    samesite = settings.COOKIE_SAMESITE
    return {
        "secure": settings.COOKIE_SECURE or samesite == "none",  # browsers reject SameSite=None without Secure
        "samesite": samesite,
        "domain": settings.COOKIE_DOMAIN or None,
    }


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> str:
    """Attach the session cookies to `response`; returns the CSRF token that was issued."""
    csrf = new_csrf_token()
    common = _common()
    response.set_cookie(
        ACCESS_COOKIE, access_token, max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        httponly=True, path="/", **common,
    )
    response.set_cookie(
        REFRESH_COOKIE, refresh_token, max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=True, path=_auth_path(), **common,
    )
    response.set_cookie(
        CSRF_COOKIE, csrf, max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        httponly=False, path="/", **common,
    )
    return csrf


def clear_auth_cookies(response: Response) -> None:
    common = _common()
    response.delete_cookie(ACCESS_COOKIE, path="/", httponly=True, **common)
    response.delete_cookie(REFRESH_COOKIE, path=_auth_path(), httponly=True, **common)
    response.delete_cookie(CSRF_COOKIE, path="/", **common)


def check_csrf(request: Request) -> None:
    """Raise 403 unless the X-CSRF-Token header matches the CSRF cookie (constant-time compare)."""
    if request.method in SAFE_METHODS:
        return
    cookie = request.cookies.get(CSRF_COOKIE) or ""
    header = request.headers.get(CSRF_HEADER) or ""
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token missing or invalid")
