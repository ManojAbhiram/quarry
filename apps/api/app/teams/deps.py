"""FastAPI dependencies that resolve the caller's organization role and active workspace."""
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException

from app.billing.store import personal_scope
from app.services.auth import get_current_user
from app.teams import store


@dataclass
class OrgContext:
    user: dict
    org_id: str
    role: str


@dataclass
class Workspace:
    """Where an action is billed and scoped: a personal workspace (org_id None) or an organization."""

    user: dict
    org_id: Optional[str]
    role: Optional[str]

    @property
    def scope_id(self) -> str:
        return self.org_id or personal_scope(self.user["_id"])


def org_member(minimum: str = "viewer"):
    """Dependency factory: caller must belong to the org in the path with at least `minimum` role."""

    async def dep(org_id: str, user: dict = Depends(get_current_user)) -> OrgContext:
        await store.ensure_legacy_membership(user)
        m = await store.get_membership(org_id, str(user["_id"]))
        if not m:
            raise HTTPException(status_code=404, detail="Organization not found")  # do not reveal other orgs exist
        if not store.role_at_least(m["role"], minimum):
            raise HTTPException(status_code=403, detail=f"This action needs the {minimum} role or higher")
        return OrgContext(user=user, org_id=org_id, role=m["role"])

    return dep


async def get_workspace(
    user: dict = Depends(get_current_user), x_org_id: Optional[str] = Header(default=None)
) -> Workspace:
    """Active workspace from the optional X-Org-Id header; membership is always verified server side."""
    if not x_org_id:
        return Workspace(user=user, org_id=None, role=None)
    await store.ensure_legacy_membership(user)
    m = await store.get_membership(x_org_id, str(user["_id"]))
    if not m:
        raise HTTPException(status_code=403, detail="You are not a member of that organization")
    return Workspace(user=user, org_id=x_org_id, role=m["role"])


def workspace_role(minimum: str):
    """Workspace dependency that also requires `minimum` role when an organization is active."""

    async def dep(ws: Workspace = Depends(get_workspace)) -> Workspace:
        if ws.org_id and not store.role_at_least(ws.role, minimum):
            raise HTTPException(status_code=403, detail=f"This action needs the {minimum} role or higher")
        return ws

    return dep
