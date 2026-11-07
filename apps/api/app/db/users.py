from typing import Optional

from sqlalchemy import or_

from app.core.logger import logger
from app.core.security_crypto import decrypt_secret
from app.db.models import TABLES, User

_users = TABLES["users"]


async def get_user_by_id(user_id: str) -> Optional[dict]:
    return await _users.get(_id=str(user_id))


async def get_user_serper_key(user_id: str) -> Optional[str]:
    """Return the user's decrypted Serper API key, or None if not set."""
    user = await get_user_by_id(user_id)
    if not user:
        return None
    token = user.get("serper_api_key_encrypted")
    if not token:
        return None
    return decrypt_secret(token) or None


async def get_user_by_email(email: str) -> Optional[dict]:
    return await _users.get(email=email)


async def find_user_by_google_or_email(google_id: str, email: str) -> Optional[dict]:
    matches = await _users.find(or_(User.google_id == google_id, User.email == email), limit=1)
    return matches[0] if matches else None


async def insert_user(doc: dict) -> tuple[str, dict]:
    user_id = await _users.insert(doc)
    doc["_id"] = user_id
    logger.info("Inserted user %s", user_id)
    return user_id, doc


async def update_user(user_id: str, updates: dict) -> None:
    await _users.update(str(user_id), updates)


async def delete_user(user_id: str) -> None:
    await _users.delete(str(user_id))


async def check_email_conflict(email: str, exclude_user_id) -> bool:
    conflicts = await _users.find(User.email == email, User.id != str(exclude_user_id), limit=1)
    return bool(conflicts)
