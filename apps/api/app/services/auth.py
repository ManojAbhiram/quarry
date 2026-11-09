from datetime import datetime, timedelta, timezone
from typing import Optional
import hashlib
import uuid
from jose import JWTError, jwt
import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.config import settings
from app.core.cookies import ACCESS_COOKIE, check_csrf


bearer_scheme = HTTPBearer(auto_error=False)


def refresh_token_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": user_id, "exp": expire, "type": "access"}, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    # jti makes every refresh token unique: sessions are keyed by the token hash, so two tokens issued for the
    # same user in the same second must not be identical.
    claims = {"sub": user_id, "exp": expire, "type": "refresh", "jti": uuid.uuid4().hex}
    return jwt.encode(claims, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_password_reset_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": user_id, "exp": expire, "type": "password_reset"},
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM,
    )


async def verify_password_reset_token(token: str) -> str:
    """Validates a password-reset token and returns user_id. Raises HTTPException on failure."""
    exc = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid or expired password reset token",
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "password_reset":
            raise exc
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise exc
    except JWTError:
        raise exc from None
    return user_id


async def verify_refresh_token(token: str) -> str:
    """Validates a refresh token and returns the user_id (sub). Raises HTTPException on failure."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "refresh":
            raise credentials_exception
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception from None
    return user_id


def token_from_request(request: Request, credentials: Optional[HTTPAuthorizationCredentials]) -> Optional[str]:
    """The access token for this request: the Authorization header wins, else the HttpOnly cookie (with CSRF check)."""
    if credentials is not None and credentials.credentials:
        return credentials.credentials
    cookie = request.cookies.get(ACCESS_COOKIE)
    if cookie:
        check_csrf(request)  # cookies are sent by the browser on its own, so unsafe methods need the CSRF token
        return cookie
    return None


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
):
    """
    Resolve the current user from a JWT access token, taken from the Authorization: Bearer header (API clients,
    tests) or the HttpOnly `quarry_access` cookie (the web app; unsafe methods also need the X-CSRF-Token header).

    There is deliberately no trusted "X-User-Id" header path: any client can set that header.
    """
    from app.db.users import get_user_by_id

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
    )

    token = token_from_request(request, credentials)
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") not in (None, "access"):
            raise credentials_exception
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception from None

    user = await get_user_by_id(user_id)
    if user is None:
        raise credentials_exception
    return user
