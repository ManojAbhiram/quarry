from fastapi import APIRouter, HTTPException, Depends, status

from app.core.security_crypto import encrypt_secret, decrypt_secret, mask_secret
from app.db.erasure import erase_user_data
from app.db.users import check_email_conflict, get_user_by_id, update_user
from app.services.auth import get_current_user
from app.services.serper import validate_serper_key
from app.schemas import (
    UserOut,
    ProfileUpdate,
    SerperKeyUpdate,
    SerperKeyStatus,
    user_to_out,
)

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def get_me(current_user: dict = Depends(get_current_user)):
    return user_to_out(current_user)


@router.put("/me", response_model=UserOut)
async def update_profile(
    body: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return user_to_out(current_user)

    if "email" in updates:
        if await check_email_conflict(updates["email"], current_user["_id"]):
            raise HTTPException(status_code=400, detail="Email already in use")

    user_id = str(current_user["_id"])
    await update_user(user_id, updates)
    updated = await get_user_by_id(user_id)
    return user_to_out(updated)


def _serper_status(current_user: dict) -> SerperKeyStatus:
    token = current_user.get("serper_api_key_encrypted")
    if not token:
        return SerperKeyStatus(has_key=False, masked=None)
    plain = decrypt_secret(token)
    return SerperKeyStatus(has_key=bool(plain), masked=mask_secret(plain) if plain else None)


@router.get("/me/serper-key", response_model=SerperKeyStatus)
async def get_serper_key_status(current_user: dict = Depends(get_current_user)):
    return _serper_status(current_user)


@router.put("/me/serper-key", response_model=SerperKeyStatus)
async def set_serper_key(
    body: SerperKeyUpdate,
    current_user: dict = Depends(get_current_user),
):
    key = body.serper_api_key.strip()
    if not await validate_serper_key(key):
        raise HTTPException(
            status_code=400,
            detail="That Serper API key was rejected. Check the key and try again.",
        )
    user_id = str(current_user["_id"])
    await update_user(user_id, {"serper_api_key_encrypted": encrypt_secret(key)})
    return SerperKeyStatus(has_key=True, masked=mask_secret(key))


@router.delete("/me/serper-key", response_model=SerperKeyStatus)
async def delete_serper_key(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    await update_user(user_id, {"serper_api_key_encrypted": None})
    return SerperKeyStatus(has_key=False, masked=None)


@router.delete("/me", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(current_user: dict = Depends(get_current_user)):
    user_id = current_user["_id"]
    await erase_user_data(str(user_id))  # the user, their requests, leads, lists and sessions
