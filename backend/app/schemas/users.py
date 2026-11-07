from typing import Optional
from pydantic import BaseModel, EmailStr, Field


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    org_id: Optional[str] = None
    company: Optional[str] = None
    job_title: Optional[str] = None
    phone: Optional[str] = None


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    company: Optional[str] = None
    job_title: Optional[str] = None
    phone: Optional[str] = None


class SerperKeyUpdate(BaseModel):
    serper_api_key: str = Field(min_length=8, description="The user's Serper.dev API key")


class SerperKeyStatus(BaseModel):
    has_key: bool
    masked: Optional[str] = None



def user_to_out(doc: dict) -> UserOut:
    org_id = doc.get("org_id")
    return UserOut(
        id=str(doc["_id"]),
        email=doc["email"],
        name=doc["name"],
        org_id=str(org_id) if org_id else None,
        company=doc.get("company"),
        job_title=doc.get("job_title"),
        phone=doc.get("phone"),
    )
