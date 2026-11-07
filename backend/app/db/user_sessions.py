from datetime import datetime
from typing import Optional

from app.core.logger import logger
from app.db.models import TABLES, UserSession

_sessions = TABLES["user_sessions"]


async def create_session(
    user_id: str,
    token_hash: str,
    expires_at: datetime,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> str:
    """Create a user session doc. Returns the session _id."""
    session_id = await _sessions.insert(
        {
            "user_id": user_id,
            "token_hash": token_hash,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "expires_at": expires_at,
            "created_at": datetime.utcnow(),
        }
    )
    logger.info("Created session %s for user %s", session_id, user_id)
    return session_id


async def get_session_by_token_hash(token_hash: str) -> Optional[dict]:
    """Return the session for a token hash, or None if missing or expired."""
    session = await _sessions.get(token_hash=token_hash)
    if session and session["expires_at"] and session["expires_at"] <= datetime.utcnow():
        return None
    return session


async def purge_expired_sessions() -> int:
    """Delete expired sessions (there is no automatic expiry in SQLite). Returns how many were removed."""
    removed = await _sessions.delete_where(UserSession.expires_at <= datetime.utcnow())
    if removed:
        logger.info("Purged %d expired sessions", removed)
    return removed


async def delete_session(session_id: str) -> None:
    await _sessions.delete(session_id)
    logger.info("Deleted session %s", session_id)


async def delete_session_by_token_hash(token_hash: str) -> None:
    removed = await _sessions.delete_where(UserSession.token_hash == token_hash)
    if removed:
        logger.info("Deleted session by token hash")


async def delete_sessions_for_user(user_id: str) -> None:
    removed = await _sessions.delete_where(UserSession.user_id == str(user_id))
    logger.info("Deleted %d sessions for user %s", removed, user_id)
