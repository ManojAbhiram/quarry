from typing import Optional
from pydantic import BaseModel


class OrganizationCreate(BaseModel):
    name: str
    domain: str


class OrganizationUpdate(BaseModel):
    name: Optional[str] = None
    domain: Optional[str] = None


class OrganizationOut(BaseModel):
    id: str
    name: str
    domain: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


def org_to_out(doc: dict) -> OrganizationOut:
    return OrganizationOut(
        id=str(doc["_id"]),
        name=doc.get("name", ""),
        domain=doc.get("domain", ""),
        created_at=doc["created_at"].isoformat() if doc.get("created_at") else None,
        updated_at=doc["updated_at"].isoformat() if doc.get("updated_at") else None,
    )
