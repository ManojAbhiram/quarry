"""The invite email is sent in the background and `email_status` is honest about what happened."""
import asyncio

from app.api import teams as teams_api


async def _org(api, h):
    r = await api.post("/api/orgs", json={"name": "Acme"}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_invite_without_smtp_reports_disabled(api, signup, monkeypatch):
    monkeypatch.setattr(teams_api, "smtp_configured", lambda: False)
    oh, _ = await signup("own@x.com")
    org_id = await _org(api, oh)
    r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": "d@x.com"}, headers=oh)
    assert r.status_code == 201
    body = r.json()
    assert body["email_status"] == "disabled" and "emailed" not in body and "token=" in body["invite_url"]


async def test_invite_returns_link_and_records_sent(api, signup, monkeypatch):
    sent = []

    async def fake_send(to, org_name, inviter, link):
        await asyncio.sleep(0)
        sent.append((to, link))

    monkeypatch.setattr(teams_api, "smtp_configured", lambda: True)
    monkeypatch.setattr(teams_api, "send_invite_email", fake_send)
    oh, _ = await signup("own@x.com")
    org_id = await _org(api, oh)
    r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": "s@x.com"}, headers=oh)
    assert r.status_code == 201 and r.json()["email_status"] == "queued"  # the response reports queued, never waits
    assert sent and sent[0][1] == r.json()["invite_url"]
    listed = (await api.get(f"/api/orgs/{org_id}/invites", headers=oh)).json()["invites"]
    assert listed[0]["email_status"] == "sent"


async def test_invite_email_failure_is_recorded_not_raised(api, signup, monkeypatch):
    async def boom(*a):
        raise OSError("smtp down")

    monkeypatch.setattr(teams_api, "smtp_configured", lambda: True)
    monkeypatch.setattr(teams_api, "send_invite_email", boom)
    oh, _ = await signup("own@x.com")
    org_id = await _org(api, oh)
    r = await api.post(f"/api/orgs/{org_id}/invites", json={"email": "f@x.com"}, headers=oh)
    assert r.status_code == 201
    listed = (await api.get(f"/api/orgs/{org_id}/invites", headers=oh)).json()["invites"]
    assert listed[0]["email_status"] == "failed"
