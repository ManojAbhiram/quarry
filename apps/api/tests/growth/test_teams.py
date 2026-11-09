from app.db.models import TABLES


async def _org(api, h, name="Acme"):
    r = await api.post("/api/orgs", json={"name": name}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _join(api, owner_h, org_id, email, h, role="member"):
    r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": email, "role": role}, headers=owner_h)
    assert r.status_code == 201, r.text
    token = r.json()["invite_url"].split("token=")[1]
    a = await api.post("/api/orgs/invites/accept", json={"token": token}, headers=h)
    assert a.status_code == 200, a.text
    return token


async def test_create_rename_and_list_orgs(api, signup):
    h, _ = await signup("a@x.com")
    org_id = await _org(api, h)
    listed = (await api.get("/api/orgs", headers=h)).json()["organizations"]
    assert any(o["id"] == org_id and o["role"] == "owner" for o in listed)
    r = await api.put(f"/api/orgs/{org_id}", json={"name": "Renamed"}, headers=h)
    assert r.json()["name"] == "Renamed"


async def test_legacy_signup_org_makes_user_owner(api, signup):
    h, _ = await signup("legacy@x.com")
    orgs = (await api.get("/api/orgs", headers=h)).json()["organizations"]
    assert [o["role"] for o in orgs] == ["owner"]


async def test_invite_accept_flow_and_single_use(api, signup):
    oh, _ = await signup("own@x.com")
    mh, _ = await signup("mem@x.com")
    org_id = await _org(api, oh)
    token = await _join(api, oh, org_id, "mem@x.com", mh)
    members = (await api.get(f"/api/orgs/{org_id}/members", headers=oh)).json()["members"]
    assert {m["email"]: m["role"] for m in members} == {"own@x.com": "owner", "mem@x.com": "member"}
    again = await api.post("/api/orgs/invites/accept", json={"token": token}, headers=mh)
    assert again.status_code == 404  # already used


async def test_invite_for_other_email_is_rejected(api, signup):
    oh, _ = await signup("own2@x.com")
    other, _ = await signup("other@x.com")
    org_id = await _org(api, oh)
    r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": "someone@x.com"}, headers=oh)
    token = r.json()["invite_url"].split("token=")[1]
    bad = await api.post("/api/orgs/invites/accept", json={"token": token}, headers=other)
    assert bad.status_code == 403


async def test_expired_invite_rejected(api, signup):
    from datetime import datetime, timedelta

    oh, _ = await signup("own3@x.com")
    mh, _ = await signup("m3@x.com")
    org_id = await _org(api, oh)
    r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": "m3@x.com"}, headers=oh)
    await TABLES["org_invites"].update(r.json()["id"], {"expires_at": datetime.utcnow() - timedelta(days=1)})
    token = r.json()["invite_url"].split("token=")[1]
    assert (await api.post("/api/orgs/invites/accept", json={"token": token}, headers=mh)).status_code == 410


async def test_role_permissions(api, signup):
    oh, _ = await signup("o4@x.com")
    mh, mid = await signup("m4@x.com")
    vh, vid = await signup("v4@x.com")
    org_id = await _org(api, oh)
    from app.billing.store import upsert_subscription

    await upsert_subscription(org_id, {"plan": "team", "status": "active"})  # enough seats for four people
    await _join(api, oh, org_id, "m4@x.com", mh, "member")
    await _join(api, oh, org_id, "v4@x.com", vh, "viewer")
    # members cannot invite, rename or change roles
    assert (await api.post(f"/api/orgs/{org_id}/invites", json={"email": "z@x.com"}, headers=mh)).status_code == 403
    assert (await api.put(f"/api/orgs/{org_id}", json={"name": "n"}, headers=mh)).status_code == 403
    assert (await api.put(f"/api/orgs/{org_id}/members/{vid}", json={"role": "admin"}, headers=mh)).status_code == 403
    # viewers can read the roster but not share
    assert (await api.get(f"/api/orgs/{org_id}/members", headers=vh)).status_code == 200
    share = await api.post(f"/api/orgs/{org_id}/shares", json={"resource_type": "list", "resource_id": "x"}, headers=vh)
    assert share.status_code == 403
    # an admin cannot promote to owner, an owner can
    ah, aid = await signup("a4@x.com")
    await _join(api, oh, org_id, "a4@x.com", ah, "admin")
    assert (await api.put(f"/api/orgs/{org_id}/members/{mid}", json={"role": "owner"}, headers=ah)).status_code == 403
    assert (await api.put(f"/api/orgs/{org_id}/members/{mid}", json={"role": "admin"}, headers=ah)).status_code == 200
    assert (await api.put(f"/api/orgs/{org_id}/members/{mid}", json={"role": "owner"}, headers=oh)).status_code == 200


async def test_last_owner_cannot_leave_or_be_demoted(api, signup):
    oh, oid = await signup("o5@x.com")
    org_id = await _org(api, oh)
    assert (await api.delete(f"/api/orgs/{org_id}/members/{oid}", headers=oh)).status_code == 409
    assert (await api.put(f"/api/orgs/{org_id}/members/{oid}", json={"role": "member"}, headers=oh)).status_code == 409


async def test_member_can_leave_and_admin_can_remove(api, signup):
    oh, _ = await signup("o6@x.com")
    mh, mid = await signup("m6@x.com")
    org_id = await _org(api, oh)
    await _join(api, oh, org_id, "m6@x.com", mh)
    assert (await api.delete(f"/api/orgs/{org_id}/members/{mid}", headers=mh)).status_code == 204
    assert (await api.get(f"/api/orgs/{org_id}/members", headers=mh)).status_code == 404


async def test_seat_limit_enforced_on_free_plan(api, signup):
    oh, _ = await signup("o7@x.com")
    org_id = await _org(api, oh)  # free plan: 3 seats; owner uses one
    for i in range(2):
        r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": f"s{i}@x.com"}, headers=oh)
        assert r.status_code == 201
    r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": "s9@x.com"}, headers=oh)
    assert r.status_code == 402


async def test_revoke_invite(api, signup):
    oh, _ = await signup("o8@x.com")
    mh, _ = await signup("m8@x.com")
    org_id = await _org(api, oh)
    r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": "m8@x.com"}, headers=oh)
    assert (await api.delete(f"/api/orgs/{org_id}/invites/{r.json()['id']}", headers=oh)).status_code == 204
    token = r.json()["invite_url"].split("token=")[1]
    assert (await api.post("/api/orgs/invites/accept", json={"token": token}, headers=mh)).status_code == 404


# -- cross-org isolation + sharing -------------------------------------------------------------------------------

async def _make_list(api, h, name="L"):
    r = await api.post("/api/lists", json={"name": name}, headers=h)
    assert r.status_code == 201
    return r.json()["_id"]


async def test_member_of_org_a_cannot_access_org_b(api, signup):
    a_h, _ = await signup("ownera@x.com")
    b_h, _ = await signup("ownerb@x.com")
    org_a, org_b = await _org(api, a_h, "A"), await _org(api, b_h, "B")
    list_b = await _make_list(api, b_h)
    await api.post(f"/api/orgs/{org_b}/shares", json={"resource_type": "list", "resource_id": list_b}, headers=b_h)

    for path in (f"/api/orgs/{org_b}", f"/api/orgs/{org_b}/members", f"/api/orgs/{org_b}/invites",
                 f"/api/orgs/{org_b}/shared/lists", f"/api/orgs/{org_b}/shared/lists/{list_b}",
                 f"/api/orgs/{org_b}/shared/requests"):
        assert (await api.get(path, headers=a_h)).status_code == 404, path
    # writes too
    assert (await api.post(f"/api/orgs/{org_b}/invites", json={"email": "q@x.com"}, headers=a_h)).status_code == 404
    assert (await api.post(f"/api/orgs/{org_b}/shares", json={"resource_type": "list", "resource_id": "x"}, headers=a_h)).status_code == 404
    # org B's list is also not reachable through org A's id or the personal endpoints
    assert (await api.get(f"/api/orgs/{org_a}/shared/lists/{list_b}", headers=a_h)).status_code == 404
    assert (await api.get(f"/api/lists/{list_b}", headers=a_h)).status_code == 404
    # X-Org-Id header for an org you are not in is refused
    r = await api.get("/api/billing/summary", headers={**a_h, "X-Org-Id": org_b})
    assert r.status_code == 403


async def test_share_list_and_request_with_org(api, signup):
    oh, _ = await signup("o9@x.com")
    mh, _ = await signup("m9@x.com")
    vh, _ = await signup("v9@x.com")
    org_id = await _org(api, oh)
    await _join(api, oh, org_id, "m9@x.com", mh)
    await _join(api, oh, org_id, "v9@x.com", vh, "viewer")
    list_id = await _make_list(api, oh, "Shared one")
    req = (await api.post("/api/requests", json={"name": "R", "description": "d"}, headers=oh)).json()

    # not visible before sharing
    assert (await api.get(f"/api/orgs/{org_id}/shared/lists/{list_id}", headers=mh)).status_code == 404
    for rtype, rid in (("list", list_id), ("request", req["id"])):
        r = await api.post(f"/api/orgs/{org_id}/shares", json={"resource_type": rtype, "resource_id": rid}, headers=oh)
        assert r.status_code == 201, r.text
    for h in (mh, vh):
        assert (await api.get(f"/api/orgs/{org_id}/shared/lists/{list_id}", headers=h)).json()["name"] == "Shared one"
        assert (await api.get(f"/api/orgs/{org_id}/shared/requests/{req['id']}", headers=h)).status_code == 200
        assert len((await api.get(f"/api/orgs/{org_id}/shared/lists", headers=h)).json()["lists"]) == 1
    # sharing never grants edit rights on the owner's personal endpoints
    assert (await api.get(f"/api/lists/{list_id}", headers=mh)).status_code == 404
    assert (await api.put(f"/api/requests/{req['id']}", json={"title": "x"}, headers=mh)).status_code == 404

    # unshare removes access; only owner of resource may share it
    assert (await api.delete(f"/api/orgs/{org_id}/shares/list/{list_id}", headers=oh)).status_code == 204
    assert (await api.get(f"/api/orgs/{org_id}/shared/lists/{list_id}", headers=mh)).status_code == 404
    stolen = await api.post(f"/api/orgs/{org_id}/shares", json={"resource_type": "list", "resource_id": list_id}, headers=mh)
    assert stolen.status_code == 404
