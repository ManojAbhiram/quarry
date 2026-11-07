from datetime import datetime
from typing import Optional
import uuid

from app.core.logger import logger
from app.db.database import get_db


async def create_session(
    user_id: str,
    token_hash: str,
    expires_at: datetime,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> str:
    """Create a user session doc. Returns the session _id."""
    db = get_db()
    session_id = str(uuid.uuid4())
    doc = {
        "_id": session_id,
        "user_id": user_id,
        "token_hash": token_hash,
        "ip_address": ip_address,
        "user_agent": user_agent,
        "expires_at": expires_at,
        "created_at": datetime.utcnow(),
    }
    await db.user_sessions.insert_one(doc)
    logger.info("Created session %s for user %s", session_id, user_id)
    return session_id


async def get_session_by_token_hash(token_hash: str) -> Optional[dict]:
    db = get_db()
    return await db.user_sessions.find_one({"token_hash": token_hash})


async def delete_session(session_id: str) -> None:
    db = get_db()
    await db.user_sessions.delete_one({"_id": session_id})
    logger.info("Deleted session %s", session_id)


async def delete_session_by_token_hash(token_hash: str) -> None:
    db = get_db()
    result = await db.user_sessions.delete_one({"token_hash": token_hash})
    if result.deleted_count:
        logger.info("Deleted session by token hash")


async def delete_sessions_for_user(user_id: str) -> None:
    db = get_db()
    result = await db.user_sessions.delete_many({"user_id": user_id})
    logger.info("Deleted %d sessions for user %s", result.deleted_count, user_id)
