from app.core.logger import logger
from app.db.users import (
    find_user_by_google_or_email,
    get_user_by_id,
    insert_user,
    update_user,
)


async def find_or_create_google_user(google_id: str, email: str, name: str) -> tuple[str, dict]:
    """
    Find an existing user by google_id or email; create one if none exists.
    Also links google_id to an existing email-only account.
    Returns (user_id, user_doc).
    """
    user = await find_user_by_google_or_email(google_id, email)

    if user:
        if not user.get("google_id"):
            await update_user(str(user["_id"]), {"google_id": google_id})
            user["google_id"] = google_id
        user_id = str(user["_id"])
        logger.info("Google SSO login for existing user: %s", email)
        user = await get_user_by_id(user_id)
        return user_id, user

    doc = {
        "email": email,
        "name": name,
        "google_id": google_id,
        "password_hash": None,
        "org_id": None,
        "company": None,
        "job_title": None,
        "phone": None,
    }
    user_id, doc = await insert_user(doc)
    logger.info("Google SSO: new user created for %s", email)
    return user_id, doc
