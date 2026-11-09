"""Email verification settings (provider, key, SMTP probe) and decision-maker verification.

GET    /verification/settings                      current provider, masked key, SMTP preference
PUT    /verification/settings                      choose provider / store key (encrypted) / toggle SMTP probe
DELETE /verification/settings/key                  remove the stored provider key
POST   /verification/decision-makers/{dm_id}/verify   verify and store the status of a contact's email
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.security_crypto import decrypt_secret, encrypt_secret, mask_secret
from app.db.decision_makers import get_decision_maker_for_user, update_decision_maker
from app.db.users import get_user_by_id, update_user
from app.services.auth import get_current_user
from app.verification import VerifierConfig, verify
from app.verification.providers import PROVIDERS

router = APIRouter(prefix="/verification", tags=["verification"])


class VerifierSettingsIn(BaseModel):
    provider: Optional[str] = Field(default=None, description="millionverifier | zerobounce | neverbounce | '' for none")
    api_key: Optional[str] = Field(default=None, min_length=8, max_length=200)
    smtp_probe: Optional[bool] = None


def _settings_out(user: dict) -> dict:
    key = decrypt_secret(user.get("verifier_api_key_encrypted") or "")
    return {
        "provider": user.get("verifier_provider") or None,
        "has_key": bool(key),
        "masked": mask_secret(key) if key else None,
        "smtp_probe": bool(user.get("verifier_smtp_probe")),
        "providers": [{"name": p.name, "label": p.label} for p in PROVIDERS.values()],
    }


@router.get("/settings")
async def get_settings(current_user: dict = Depends(get_current_user)):
    return _settings_out(current_user)


@router.put("/settings")
async def put_settings(body: VerifierSettingsIn, current_user: dict = Depends(get_current_user)):
    updates: dict = {}
    if body.provider is not None:
        name = body.provider.strip().lower()
        if name and name not in PROVIDERS:
            raise HTTPException(status_code=400, detail=f"Unknown provider. Choose one of: {', '.join(PROVIDERS)}.")
        updates["verifier_provider"] = name or None
        if not name:
            updates["verifier_api_key_encrypted"] = None
    if body.api_key is not None:
        updates["verifier_api_key_encrypted"] = encrypt_secret(body.api_key.strip())
    if body.smtp_probe is not None:
        updates["verifier_smtp_probe"] = body.smtp_probe
    user_id = str(current_user["_id"])
    if updates:
        await update_user(user_id, updates)
    return _settings_out(await get_user_by_id(user_id))


@router.delete("/settings/key")
async def delete_key(current_user: dict = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    await update_user(user_id, {"verifier_api_key_encrypted": None})
    return _settings_out(await get_user_by_id(user_id))


@router.post("/decision-makers/{dm_id}/verify")
async def verify_decision_maker(dm_id: str, current_user: dict = Depends(get_current_user)):
    dm = await get_decision_maker_for_user(dm_id, str(current_user["_id"]))
    if not dm:
        raise HTTPException(status_code=404, detail="Contact not found")
    if not dm.get("email"):
        raise HTTPException(status_code=400, detail="This contact has no email address to verify")
    result = await verify(dm["email"], VerifierConfig.from_user(current_user))
    await update_decision_maker(dm_id, result.lead_fields())
    return result.to_dict()
