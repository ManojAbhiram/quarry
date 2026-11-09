"""Organizations, membership, invites and org-scoped sharing.

Roles (highest first): owner > admin > member > viewer. The `org_members` table is the source of truth; the legacy
`users.org_id` (set at signup) is honoured by lazily making the first such user the owner of that organization.
"""
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.exc import IntegrityError

from app.db.growth_models import OrgInvite, OrgMember, ResourceShare
from app.db.models import TABLES

ROLES = ("owner", "admin", "member", "viewer")
RANK = {r: len(ROLES) - i for i, r in enumerate(ROLES)}
INVITE_TTL_DAYS = 7
SHAREABLE = ("request", "list")


def role_at_least(role: Optional[str], minimum: str) -> bool:
    return RANK.get(role or "", 0) >= RANK[minimum]


class TeamError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# -- organizations / members -------------------------------------------------------------------------------------

async def get_membership(org_id: str, user_id: str) -> Optional[dict]:
    return await TABLES["org_members"].get(org_id=str(org_id), user_id=str(user_id))


async def _add_member(org_id: str, user_id: str, role: str, invited_by: Optional[str] = None) -> Optional[dict]:
    try:
        mid = await TABLES["org_members"].insert(
            {"org_id": org_id, "user_id": user_id, "role": role, "invited_by": invited_by, "created_at": datetime.utcnow()}
        )
    except IntegrityError:
        return None
    return await TABLES["org_members"].get(_id=mid)


async def create_org(user: dict, name: str, domain: Optional[str] = None) -> dict:
    now = datetime.utcnow()
    doc = {"name": name.strip(), "created_at": now, "updated_at": now, "created_by": str(user["_id"])}
    if domain:
        doc["domain"] = domain.lower().strip()
    doc["_id"] = await TABLES["organizations"].insert(doc)
    await _add_member(doc["_id"], str(user["_id"]), "owner")
    return doc


async def ensure_legacy_membership(user: dict) -> None:
    """Users created before teams existed only have `org_id`. The first one becomes the org's owner."""
    org_id = user.get("org_id")
    if not org_id or await get_membership(org_id, str(user["_id"])):
        return
    if not await TABLES["organizations"].get(_id=str(org_id)):
        return
    if await TABLES["org_members"].get(org_id=str(org_id)) is None:
        await _add_member(str(org_id), str(user["_id"]), "owner")


async def list_user_orgs(user: dict) -> list[dict]:
    await ensure_legacy_membership(user)
    memberships = await TABLES["org_members"].find(OrgMember.user_id == str(user["_id"]))
    out = []
    for m in memberships:
        org = await TABLES["organizations"].get(_id=m["org_id"])
        if org:
            out.append({"org": org, "role": m["role"]})
    out.sort(key=lambda x: x["org"].get("created_at") or datetime.min)
    return out


async def list_members(org_id: str) -> list[dict]:
    rows = await TABLES["org_members"].find(OrgMember.org_id == org_id)
    out = []
    for m in rows:
        u = await TABLES["users"].get(_id=m["user_id"]) or {}
        out.append(
            {"user_id": m["user_id"], "role": m["role"], "name": u.get("name") or "", "email": u.get("email") or "",
             "joined_at": m.get("created_at")}
        )
    out.sort(key=lambda x: (-RANK.get(x["role"], 0), x["email"]))
    return out


async def _owner_count(org_id: str) -> int:
    return sum(1 for m in await TABLES["org_members"].find(OrgMember.org_id == org_id) if m["role"] == "owner")


async def change_role(org_id: str, target_user_id: str, new_role: str, actor_role: str) -> dict:
    if new_role not in ROLES:
        raise TeamError(422, "Unknown role")
    target = await get_membership(org_id, target_user_id)
    if not target:
        raise TeamError(404, "Member not found")
    # Only owners can grant or take away ownership; admins manage the roles below owner.
    if (new_role == "owner" or target["role"] == "owner") and actor_role != "owner":
        raise TeamError(403, "Only an owner can change owner roles")
    if target["role"] == "owner" and new_role != "owner" and await _owner_count(org_id) <= 1:
        raise TeamError(409, "An organization needs at least one owner")
    return await TABLES["org_members"].update(target["_id"], {"role": new_role})


async def remove_member(org_id: str, target_user_id: str, actor_user_id: str, actor_role: str) -> None:
    target = await get_membership(org_id, target_user_id)
    if not target:
        raise TeamError(404, "Member not found")
    if target_user_id != actor_user_id:
        if not role_at_least(actor_role, "admin"):
            raise TeamError(403, "Only admins can remove members")
        if target["role"] == "owner" and actor_role != "owner":
            raise TeamError(403, "Only an owner can remove an owner")
    if target["role"] == "owner" and await _owner_count(org_id) <= 1:
        raise TeamError(409, "The last owner cannot leave; transfer ownership first")
    await TABLES["org_members"].delete(target["_id"])


# -- invites ------------------------------------------------------------------------------------------------------

async def create_invite(org_id: str, email: str, role: str, invited_by: str, seat_limit: int) -> tuple[dict, str]:
    email = email.lower().strip()
    if role not in ROLES or role == "owner":
        raise TeamError(422, "Invites can grant admin, member or viewer")
    members = await TABLES["org_members"].find(OrgMember.org_id == org_id)
    for m in members:
        u = await TABLES["users"].get(_id=m["user_id"])
        if u and (u.get("email") or "").lower() == email:
            raise TeamError(409, "That person is already a member")
    pending = [i for i in await TABLES["org_invites"].find(OrgInvite.org_id == org_id) if i.get("status") == "pending"]
    for old in [i for i in pending if i["email"] == email]:  # re-inviting replaces the previous link
        await TABLES["org_invites"].update(old["_id"], {"status": "revoked"})
    pending = [i for i in pending if i["email"] != email]
    if len(members) + len(pending) >= seat_limit:
        raise TeamError(402, "Seat limit reached for this plan. Upgrade to invite more people.")
    token = secrets.token_urlsafe(32)
    doc = {
        "org_id": org_id, "email": email, "role": role, "token_hash": _hash(token), "status": "pending",
        "invited_by": invited_by, "created_at": datetime.utcnow(),
        "expires_at": datetime.utcnow() + timedelta(days=INVITE_TTL_DAYS),
    }
    doc["_id"] = await TABLES["org_invites"].insert(doc)
    return doc, token


async def list_pending_invites(org_id: str) -> list[dict]:
    now = datetime.utcnow()
    rows = await TABLES["org_invites"].find(OrgInvite.org_id == org_id)
    return [i for i in rows if i.get("status") == "pending" and i["expires_at"] > now]


async def revoke_invite(org_id: str, invite_id: str) -> None:
    inv = await TABLES["org_invites"].get(_id=invite_id, org_id=org_id)
    if not inv or inv.get("status") != "pending":
        raise TeamError(404, "Invite not found")
    await TABLES["org_invites"].update(invite_id, {"status": "revoked"})


async def get_invite_by_token(token: str) -> Optional[dict]:
    return await TABLES["org_invites"].get(token_hash=_hash(token))


async def accept_invite(token: str, user: dict) -> dict:
    inv = await get_invite_by_token(token)
    if not inv or inv.get("status") != "pending":
        raise TeamError(404, "This invite is invalid or was already used")
    if inv["expires_at"] <= datetime.utcnow():
        raise TeamError(410, "This invite has expired")
    if (user.get("email") or "").lower() != inv["email"]:
        raise TeamError(403, "This invite was sent to a different email address")
    existing = await get_membership(inv["org_id"], str(user["_id"]))
    if not existing:
        await _add_member(inv["org_id"], str(user["_id"]), inv["role"], invited_by=inv.get("invited_by"))
    await TABLES["org_invites"].update(inv["_id"], {"status": "accepted", "accepted_at": datetime.utcnow()})
    return await TABLES["organizations"].get(_id=inv["org_id"])


# -- sharing ------------------------------------------------------------------------------------------------------

async def _resource_owner(rtype: str, rid: str) -> Optional[str]:
    table = TABLES["requests"] if rtype == "request" else TABLES["lead_lists"]
    doc = await table.get(_id=rid)
    return doc.get("user_id") if doc else None


async def share_resource(org_id: str, rtype: str, rid: str, user_id: str) -> dict:
    if rtype not in SHAREABLE:
        raise TeamError(422, "Only requests and lead lists can be shared")
    # 404 (not 403) for someone else's resource, so ids are not probeable.
    if await _resource_owner(rtype, rid) != str(user_id):
        raise TeamError(404, "Resource not found")
    await TABLES["resource_shares"].upsert(
        {"org_id": org_id, "resource_type": rtype, "resource_id": rid},
        {"shared_by": str(user_id), "created_at": datetime.utcnow()},
    )
    return {"org_id": org_id, "resource_type": rtype, "resource_id": rid}


async def unshare_resource(org_id: str, rtype: str, rid: str, user_id: str, actor_role: str) -> None:
    share = await TABLES["resource_shares"].get(org_id=org_id, resource_type=rtype, resource_id=rid)
    if not share:
        raise TeamError(404, "Share not found")
    if share.get("shared_by") != str(user_id) and not role_at_least(actor_role, "admin"):
        raise TeamError(403, "Only the sharer or an admin can stop sharing")
    await TABLES["resource_shares"].delete(share["_id"])


async def list_shares(org_id: str, rtype: Optional[str] = None) -> list[dict]:
    conds = [ResourceShare.org_id == org_id]
    if rtype:
        conds.append(ResourceShare.resource_type == rtype)
    return await TABLES["resource_shares"].find(*conds)


async def is_shared_with_org(org_id: str, rtype: str, rid: str) -> bool:
    return await TABLES["resource_shares"].get(org_id=org_id, resource_type=rtype, resource_id=rid) is not None


async def shared_resource_ids_for_user(user_id: str, rtype: str) -> set[str]:
    """Resource ids shared into any organization this user belongs to."""
    out: set[str] = set()
    for m in await TABLES["org_members"].find(OrgMember.user_id == str(user_id)):
        out |= {s["resource_id"] for s in await list_shares(m["org_id"], rtype)}
    return out
