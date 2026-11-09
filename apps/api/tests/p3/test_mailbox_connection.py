from app.outreach.ports import SendError

from tests.p3.conftest import MAILBOX


async def test_connection_ok(api, signup, smtp, imap):
    h, _ = await signup()
    r = await api.post("/api/outreach/mailboxes/test", headers=h, json=MAILBOX)
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["smtp"]["ok"] and body["imap"]["ok"]
    assert smtp.logins == 1


async def test_smtp_failure_is_reported_per_protocol(api, signup, smtp, imap):
    h, _ = await signup()
    smtp.login_error = SendError("SMTP login was rejected: bad password", permanent=True)
    body = (await api.post("/api/outreach/mailboxes/test", headers=h, json=MAILBOX)).json()
    assert body["ok"] is False
    assert body["smtp"] == {"ok": False, "error": "SMTP login was rejected: bad password"}
    assert body["imap"]["ok"] is True


async def test_imap_failure_and_skipped_imap(api, signup, smtp, imap):
    h, _ = await signup()
    imap.login_error = SendError("IMAP login was rejected: nope")
    body = (await api.post("/api/outreach/mailboxes/test", headers=h, json=MAILBOX)).json()
    assert body["ok"] is False and body["smtp"]["ok"] and body["imap"]["error"].startswith("IMAP")
    no_imap = {k: v for k, v in MAILBOX.items() if not k.startswith("imap")}
    body = (await api.post("/api/outreach/mailboxes/test", headers=h, json=no_imap)).json()
    assert body["ok"] is True and body["imap"]["skipped"] is True


async def test_unexpected_adapter_error_does_not_500(api, signup, smtp, imap):
    h, _ = await signup()

    async def boom(creds):
        raise RuntimeError("kaboom")

    smtp.verify_login = boom
    body = (await api.post("/api/outreach/mailboxes/test", headers=h, json=MAILBOX)).json()
    assert body["ok"] is False and "kaboom" in body["smtp"]["error"]


async def test_requires_smtp_host_and_auth(api, signup, smtp, imap):
    h, _ = await signup()
    assert (await api.post("/api/outreach/mailboxes/test", headers=h, json={"email": "a@b.test"})).status_code == 422
    assert (await api.post("/api/outreach/mailboxes/test", json=MAILBOX)).status_code in (401, 403)


async def test_create_warns_but_does_not_block(api, signup, smtp, imap):
    h, _ = await signup()
    smtp.login_error = SendError("Could not reach smtp.sender.test:587: timed out")
    r = await api.post("/api/outreach/mailboxes", headers=h, json=MAILBOX)
    assert r.status_code == 201
    body = r.json()
    assert body["warning"].startswith("Saved, but the connection test failed") and "SMTP" in body["warning"]
    assert body["connection_test"]["ok"] is False
    assert len((await api.get("/api/outreach/mailboxes", headers=h)).json()["mailboxes"]) == 1


async def test_create_without_problems_has_no_warning(api, signup, smtp, imap):
    h, _ = await signup()
    body = (await api.post("/api/outreach/mailboxes", headers=h, json=MAILBOX)).json()
    assert body["warning"] is None and body["connection_test"]["ok"] is True


async def test_retest_saved_mailbox_uses_stored_password(api, signup, smtp, imap):
    h, _ = await signup()
    box = (await api.post("/api/outreach/mailboxes", headers=h, json=MAILBOX)).json()
    seen = []
    orig = smtp.verify_login

    async def spy(creds):
        seen.append(creds.smtp_password)
        await orig(creds)

    smtp.verify_login = spy
    r = await api.post("/api/outreach/mailboxes/test", headers=h, json={"box_id": box["_id"]})
    assert r.json()["ok"] is True and seen == ["s3cret-smtp"]


async def test_cannot_test_another_users_mailbox(api, signup, smtp, imap):
    ha, _ = await signup("a@t.com")
    hb, _ = await signup("b@t.com")
    box = (await api.post("/api/outreach/mailboxes", headers=ha, json=MAILBOX)).json()
    r = await api.post("/api/outreach/mailboxes/test", headers=hb, json={"box_id": box["_id"]})
    assert r.status_code == 404
