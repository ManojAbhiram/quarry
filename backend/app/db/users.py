from typing import Optional

from app.core.logger import logger
from app.core.security_crypto import decrypt_secret
from app.db.database import get_db
from app.db.mongo_ids import id_query, id_values


async def get_user_by_id(user_id: str) -> Optional[dict]:
    db = get_db()
    return await db.users.find_one(id_query("_id", user_id))


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
    db = get_db()
    return await db.users.find_one({"email": email})


async def find_user_by_google_or_email(google_id: str, email: str) -> Optional[dict]:
    db = get_db()
    return await db.users.find_one({"$or": [{"google_id": google_id}, {"email": email}]})


async def insert_user(doc: dict) -> tuple[str, dict]:
    db = get_db()
    result = await db.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    logger.info("Inserted user %s", result.inserted_id)
    return str(result.inserted_id), doc


async def update_user(user_id: str, updates: dict) -> None:
    db = get_db()
    await db.users.update_one(id_query("_id", user_id), {"$set": updates})


async def delete_user(user_id: str) -> None:
    db = get_db()
    await db.users.delete_one(id_query("_id", user_id))


async def check_email_conflict(email: str, exclude_user_id) -> bool:
    db = get_db()
    conflict = await db.users.find_one(
        {"email": email, "_id": {"$nin": id_values(exclude_user_id)}}
    )
    return conflict is not None
