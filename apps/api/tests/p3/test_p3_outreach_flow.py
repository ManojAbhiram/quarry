from datetime import datetime, timedelta
from email.message import EmailMessage

from app.db.models import TABLES
from app.outreach import deps, inbound, service
from app.outreach.ports import SendError
from tests.p3.conftest import MAILBOX

NOW = datetime.utcnow() + timedelta(minutes=1)  # enrollments are due 'now'; windows in these tests are all-day


def dsn(original_id: str, status: str = "5.1.1", sender="MAILER-DAEMON@x.test") -> bytes:
    raw = (
        f"From: {sender}\nTo: me@sender.test\nSubject: Undelivered Mail Returned to Sender\n"
        "MIME-Version: 1.0\nContent-Type: multipart/report; report-type=delivery-status; boundary=B\n\n"
        "--B\nContent-Type: text/plain\n\nCould not deliver.\n"
        f"--B\nContent-Type: message/delivery-status\n\nFinal-Recipient: rfc822; lead@acme.test\nStatus: {status}\n"
        "Action: failed\n\n"
        f"--B\nContent-Type: message/rfc822\n\nMessage-ID: {original_id}\nSubject: Hi\n\nbody\n--B--\n"
    )
    return raw.encode()


def reply(original_id: str, mid="<reply1@acme.test>", extra="") -> bytes:
    return (f"From: lead@acme.test\nTo: me@sender.test\nSubject: Re: Hi\nMessage-ID: {mid}\n"
            f"In-Reply-To: {original_id}\nReferences: {original_id}\n{extra}\nYes, let's talk.\n").encode()


async def started(api, headers, make_sequence, contacts=None, **kw):
    box, seq = await make_sequence(headers, **kw)
    contacts = contacts or [{"email": "lead@acme.test", "name": "Lena Park", "company": "Acme"}]
    r = await api.post(f"/api/outreach/sequences/{seq['_id']}/enroll", headers=headers, json={"contacts": contacts})
    assert r.status_code == 200, r.text
    assert (await api.post(f"/api/outreach/sequences/{seq['_id']}/start", headers=headers)).status_code == 200
    return box, seq, r.json()


async def test_mailbox_secrets_encrypted_at_rest_and_never_returned(api, signup):
    h, _ = await signup()
    r = await api.post("/api/outreach/mailboxes", headers=h, json=MAILBOX)
    assert r.status_code == 201
    body = r.json()
    assert "smtp_password" not in body and "smtp_password_enc" not in body
    assert body["has_smtp_password"] and body["has_imap_password"]
    stored = await TABLES["outreach_mailboxes"].get(_id=body["_id"])
    assert "s3cret-smtp" not in str(stored) and "s3cret-imap" not in str(stored)
    listed = (await api.get("/api/outreach/mailboxes", headers=h)).json()["mailboxes"][0]
    assert "smtp_password_enc" not in listed
    creds = service.mailbox_creds(stored)
    assert creds.smtp_password == "s3cret-smtp" and creds.imap_password == "s3cret-imap"
    # blank password on update keeps the stored one
    await api.put(f"/api/outreach/mailboxes/{body['_id']}", headers=h, json={"from_name": "New"})
    again = service.mailbox_creds(await TABLES["outreach_mailboxes"].get(_id=body["_id"]))
    assert again.smtp_password == "s3cret-smtp"


async def test_mailboxes_are_private_to_their_owner(api, signup):
    ha, _ = await signup("a@t.com")
    hb, _ = await signup("b@t.com")
    box = (await api.post("/api/outreach/mailboxes", headers=ha, json=MAILBOX)).json()
    assert (await api.put(f"/api/outreach/mailboxes/{box['_id']}", headers=hb, json={"from_name": "x"})).status_code == 404
    assert (await api.delete(f"/api/outreach/mailboxes/{box['_id']}", headers=hb)).status_code == 404


async def test_sequence_validation_and_preview(api, signup, make_sequence):
    h, _ = await signup()
    box, seq = await make_sequence(h)
    bad = await api.post("/api/outreach/sequences", headers=h, json={"name": "x", "steps": [{"subject": "s", "body": "{{nope}}"}]})
    assert bad.status_code == 422 and "nope" in bad.text
    no_subject = await api.post("/api/outreach/sequences", headers=h, json={"name": "x", "steps": [{"subject": "", "body": "b"}]})
    assert no_subject.status_code == 422
    pv = (await api.post(f"/api/outreach/sequences/{seq['_id']}/preview", headers=h,
                         json={"contact": {"name": "Zed Quinn", "company": "Zeta"}})).json()["steps"]
    assert pv[0]["subject"] == "Hi Zed" and "Zeta" in pv[0]["body"]
    assert pv[1]["subject"] == "Re: Hi Zed" and pv[1]["delay_days"] == 2
    assert (await api.post(f"/api/outreach/sequences/{seq['_id']}/preview", headers=h,
                           json={"contact": {}})).json()["steps"][0]["missing"] == ["company"]
    assert seq["track_opens"] is False  # open tracking is off by default


async def test_enroll_skips_duplicates_suppressed_and_invalid(api, signup, make_sequence):
    h, uid = await signup()
    _, seq = await make_sequence(h)
    await deps.add_suppression(uid, "blocked.test", "manual", "test")
    contacts = [{"email": "ok@acme.test"}, {"email": "OK@acme.test"}, {"email": "x@blocked.test"}, {"name": "no email"}]
    res = (await api.post(f"/api/outreach/sequences/{seq['_id']}/enroll", headers=h, json={"contacts": contacts})).json()
    assert res["enrolled"] == 1
    assert {s["reason"] for s in res["skipped"]} == {"duplicate", "suppressed", "no_email"}


async def test_send_follow_up_threading_and_unsubscribe_headers(api, signup, make_sequence, smtp):
    h, _ = await signup()
    await started(api, h, make_sequence)
    stats = await service.run_due(NOW)
    assert stats["sent"] == 1
    first = smtp.sent[0]
    assert first["Subject"] == "Hi Lena" and first["To"] == "lead@acme.test"
    assert first["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "/public/unsubscribe/" in first["List-Unsubscribe"]
    assert "In-Reply-To" not in first
    # nothing is due before the 2-day delay, then the follow-up threads onto the first message
    assert (await service.run_due(NOW + timedelta(days=1)))["sent"] == 0
    assert (await service.run_due(NOW + timedelta(days=2, minutes=1)))["sent"] == 1
    second = smtp.sent[1]
    assert second["In-Reply-To"] == first["Message-ID"] and second["Subject"] == "Re: Hi Lena"
    assert (await service.run_due(NOW + timedelta(days=30)))["sent"] == 0  # completed


async def test_paused_sequence_does_not_send(api, signup, make_sequence, smtp):
    h, _ = await signup()
    _, seq, _ = await started(api, h, make_sequence)
    await api.post(f"/api/outreach/sequences/{seq['_id']}/pause", headers=h)
    assert (await service.run_due(NOW))["sent"] == 0 and smtp.sent == []


async def test_reply_stops_sequence_and_counts_headline_reply_rate(api, signup, make_sequence, smtp, imap):
    h, _ = await signup()
    box, seq, _ = await started(api, h, make_sequence)
    await service.run_due(NOW)
    imap.inbox.append((7, reply(smtp.sent[0]["Message-ID"])))
    res = (await api.post(f"/api/outreach/mailboxes/{box['_id']}/poll", headers=h)).json()
    assert res["processed"] == {"reply": 1}
    assert (await service.run_due(NOW + timedelta(days=5)))["sent"] == 0  # follow-up cancelled
    # re-polling the same message must not double count
    imap.inbox.append((7, reply(smtp.sent[0]["Message-ID"])))
    await api.post(f"/api/outreach/mailboxes/{box['_id']}/poll", headers=h)
    st = (await api.get(f"/api/outreach/sequences/{seq['_id']}/stats", headers=h)).json()
    assert st["replies"] == 1 and st["reply_rate"] == 1.0 and st["statuses"] == {"replied": 1}
    assert st["steps"][0]["sent"] == 1 and st["steps"][0]["replies"] == 1 and st["opens"] is None


async def test_auto_replies_are_ignored(api, signup, make_sequence, smtp, imap):
    h, _ = await signup()
    box, seq, _ = await started(api, h, make_sequence)
    await service.run_due(NOW)
    mid = smtp.sent[0]["Message-ID"]
    imap.inbox.append((1, reply(mid, "<a1@x>", "Auto-Submitted: auto-replied\n")))
    imap.inbox.append((2, reply(mid, "<a2@x>", "Precedence: auto_reply\n")))
    imap.inbox.append((3, reply(mid, "<a3@x>").replace(b"Re: Hi", b"Out of office: Hi")))
    res = (await api.post(f"/api/outreach/mailboxes/{box['_id']}/poll", headers=h)).json()
    assert res["processed"] == {"auto_reply": 3}
    assert (await service.run_due(NOW + timedelta(days=3)))["sent"] == 1  # still going


async def test_hard_bounce_stops_and_suppresses_soft_bounce_does_not(api, signup, make_sequence, smtp, imap):
    h, uid = await signup()
    box, seq, _ = await started(api, h, make_sequence, contacts=[{"email": "lead@acme.test"}, {"email": "b@acme.test"}])
    await service.run_due(NOW)
    ids = {m["To"]: m["Message-ID"] for m in smtp.sent}
    imap.inbox.append((1, dsn(ids["lead@acme.test"], "5.1.1")))
    imap.inbox.append((2, dsn(ids["b@acme.test"], "4.2.2")))
    res = (await api.post(f"/api/outreach/mailboxes/{box['_id']}/poll", headers=h)).json()
    assert res["processed"] == {"hard_bounce": 1, "soft_bounce": 1}
    assert await deps.is_suppressed(uid, "lead@acme.test")
    assert not await deps.is_suppressed(uid, "b@acme.test")
    statuses = {e["email"]: e["status"] for e in await TABLES["outreach_enrollments"].find()}
    assert statuses == {"lead@acme.test": "bounced", "b@acme.test": "active"}


async def test_mailbox_auto_pauses_when_hard_bounce_rate_exceeds_threshold(api, signup, make_sequence, smtp, imap, monkeypatch):
    from app.p3.config import P3Settings

    monkeypatch.setattr(P3Settings, "bounce_pause_min_sent", property(lambda s: 10))
    h, _ = await signup()
    contacts = [{"email": f"p{i}@acme.test"} for i in range(10)]
    box, seq, _ = await started(api, h, make_sequence, contacts=contacts)
    await service.run_due(NOW)
    assert len(smtp.sent) == 10
    imap.inbox.append((1, dsn(smtp.sent[0]["Message-ID"])))  # 1/10 = 10% > 2%
    await api.post(f"/api/outreach/mailboxes/{box['_id']}/poll", headers=h)
    mb = await TABLES["outreach_mailboxes"].get(_id=box["_id"])
    assert mb["paused"] is True and "bounce" in mb["pause_reason"]
    # a paused mailbox sends nothing, and starting a sequence on it is refused
    assert (await service.run_due(NOW + timedelta(days=3)))["sent"] == 0
    assert (await api.post(f"/api/outreach/sequences/{seq['_id']}/start", headers=h)).status_code == 422
    assert (await api.post(f"/api/outreach/mailboxes/{box['_id']}/resume", headers=h)).json()["paused"] is False


async def test_daily_cap_and_warmup_defer_the_rest(api, signup, make_sequence, smtp):
    h, _ = await signup()
    contacts = [{"email": f"c{i}@acme.test"} for i in range(8)]
    box, seq, _ = await started(api, h, make_sequence, contacts=contacts)
    await api.put(f"/api/outreach/mailboxes/{box['_id']}", headers=h, json={"daily_cap": 3})
    stats = await service.run_due(NOW)
    assert stats["sent"] == 3 and stats["deferred"] == 5
    pending = [e for e in await TABLES["outreach_enrollments"].find() if e["step_index"] == 0]
    assert all(e["next_send_at"] > NOW + timedelta(hours=1) for e in pending)
    # warmup: day-0 limit is 5 even though the cap is 50
    await api.put(f"/api/outreach/mailboxes/{box['_id']}", headers=h, json={"daily_cap": 50, "warmup": True})
    await TABLES["outreach_mailboxes"].update(box["_id"], {"warmup_started_at": NOW})
    smtp.sent.clear()
    await TABLES["outreach_messages"].delete_where(TABLES["outreach_messages"].model.direction == "out")
    await TABLES["outreach_enrollments"].delete_where()
    await api.post(f"/api/outreach/sequences/{seq['_id']}/enroll", headers=h,
                   json={"contacts": [{"email": f"w{i}@acme.test"} for i in range(9)]})
    assert (await service.run_due(NOW))["sent"] == 5


async def test_send_window_defers_outside_hours(api, signup, make_sequence, smtp):
    h, _ = await signup()
    _, seq, _ = await started(api, h, make_sequence, window_start="09:00", window_end="17:00", timezone="UTC",
                              days=[0, 1, 2, 3, 4])
    saturday = datetime(2026, 3, 7, 12, 0)
    await TABLES["outreach_enrollments"].update((await TABLES["outreach_enrollments"].find())[0]["_id"],
                                                {"next_send_at": datetime(2026, 3, 1)})
    stats = await service.run_due(saturday)
    assert stats["sent"] == 0 and stats["deferred"] == 1
    enr = (await TABLES["outreach_enrollments"].find())[0]
    assert enr["next_send_at"] == datetime(2026, 3, 9, 9, 0)  # Monday 09:00 UTC


async def test_suppressed_recipient_is_skipped_at_send_time(api, signup, make_sequence, smtp):
    h, uid = await signup()
    await started(api, h, make_sequence)
    await deps.add_suppression(uid, "lead@acme.test", "manual", "test")
    stats = await service.run_due(NOW)
    assert stats["sent"] == 0 and smtp.sent == []
    assert (await TABLES["outreach_enrollments"].find())[0]["status"] == "suppressed"


async def test_smtp_transient_failure_retries_then_permanent_marks_bounce(api, signup, make_sequence, smtp):
    h, uid = await signup()
    await started(api, h, make_sequence)
    smtp.fail_with = SendError("timeout")
    assert (await service.run_due(NOW))["failed"] == 1
    enr = (await TABLES["outreach_enrollments"].find())[0]
    assert enr["status"] == "active" and enr["attempts"] == 1 and enr["next_send_at"] > NOW
    smtp.fail_with = SendError("550 no such user", permanent=True)
    await service.run_due(NOW + timedelta(hours=1))
    assert (await TABLES["outreach_enrollments"].find())[0]["status"] == "failed"
    assert await deps.is_suppressed(uid, "lead@acme.test")


async def test_imap_failure_is_recorded_not_raised(api, signup, make_sequence, imap):
    h, _ = await signup()
    box, _ = await make_sequence(h)
    imap.boom = True
    res = (await api.post(f"/api/outreach/mailboxes/{box['_id']}/poll", headers=h)).json()
    assert res["processed"] == {}
    assert "imap down" in (await TABLES["outreach_mailboxes"].get(_id=box["_id"]))["imap_error"]


async def test_one_click_unsubscribe_adds_suppression_and_stops_sequence(api, signup, make_sequence, smtp):
    h, uid = await signup()
    _, seq, _ = await started(api, h, make_sequence)
    await service.run_due(NOW)
    url = smtp.sent[0]["List-Unsubscribe"].split("<")[1].split(">")[0]
    path = "/api" + url.split("/api", 1)[1]
    # a GET (link prefetchers, scanners) must NOT unsubscribe
    assert "Confirm unsubscribe" in (await api.get(path)).text
    assert not await deps.is_suppressed(uid, "lead@acme.test")
    # RFC 8058 one-click POST
    r = await api.post(path, data={"List-Unsubscribe": "One-Click"})
    assert r.status_code == 200 and "unsubscribed" in r.text.lower()
    assert await deps.is_suppressed(uid, "lead@acme.test")
    assert (await TABLES["outreach_enrollments"].find())[0]["status"] == "unsubscribed"
    assert (await service.run_due(NOW + timedelta(days=5)))["sent"] == 0
    st = (await api.get(f"/api/outreach/sequences/{seq['_id']}/stats", headers=h)).json()
    assert st["unsubscribes"] == 1
    bad = await api.post(path[:-4] + "AAAA", data={})
    assert "not valid" in bad.text and await deps.is_suppressed(uid, "other@x.test") is False


async def test_open_tracking_only_when_enabled(api, signup, make_sequence, smtp):
    h, _ = await signup()
    _, seq, _ = await started(api, h, make_sequence, track_opens=True)
    await service.run_due(NOW)
    html = smtp.sent[0].get_body(("html",)).get_content()
    assert "/public/o/" in html
    token = html.split("/public/o/")[1].split(".gif")[0]
    assert (await api.get(f"/api/public/o/{token}.gif")).headers["content-type"] == "image/gif"
    st = (await api.get(f"/api/outreach/sequences/{seq['_id']}/stats", headers=h)).json()
    assert st["opens"] == 1


async def test_default_sequences_have_no_tracking_pixel(api, signup, make_sequence, smtp):
    h, _ = await signup()
    await started(api, h, make_sequence)
    await service.run_due(NOW)
    assert "/public/o/" not in smtp.sent[0].get_body(("html",)).get_content()


async def test_dns_preflight_reports_spf_dkim_dmarc(api, signup, dns):
    h, _ = await signup()
    box = (await api.post("/api/outreach/mailboxes", headers=h, json=MAILBOX)).json()
    r = (await api.post(f"/api/outreach/mailboxes/{box['_id']}/preflight", headers=h)).json()
    assert r["overall"] == "fail" and r["checks"]["spf"]["status"] == "fail" and r["checks"]["dmarc"]["hint"]
    dns.records = {
        "sender.test": ["v=spf1 include:_spf.google.com ~all"],
        "google._domainkey.sender.test": ["v=DKIM1; k=rsa; p=MIGfMA0"],
        "_dmarc.sender.test": ["v=DMARC1; p=quarantine; rua=mailto:d@sender.test"],
    }
    ok = (await api.post(f"/api/outreach/mailboxes/{box['_id']}/preflight", headers=h)).json()
    assert ok["overall"] == "pass" and ok["checks"]["dkim"]["selector"] == "google"
    dns.records["_dmarc.sender.test"] = ["v=DMARC1; p=none"]
    assert (await api.post(f"/api/outreach/mailboxes/{box['_id']}/preflight", headers=h)).json()["overall"] == "warn"


async def test_enroll_from_leads_uses_decision_maker_emails(api, signup, make_sequence):
    h, uid = await signup()
    _, seq = await make_sequence(h)
    lead_id = await TABLES["leads"].insert({"request_id": "r", "user_id": uid, "url": "https://acme.test", "title": "Acme"})
    await TABLES["decision_makers"].insert({"lead_id": lead_id, "name": "Dee Fox", "title": "CTO", "email": "dee@acme.test"})
    await TABLES["decision_makers"].insert({"lead_id": lead_id, "name": "No Mail", "title": "CEO"})
    res = (await api.post(f"/api/outreach/sequences/{seq['_id']}/enroll", headers=h, json={"lead_ids": [lead_id]})).json()
    assert res["enrolled"] == 1
    enr = (await TABLES["outreach_enrollments"].find())[0]
    assert enr["contact"]["company"] == "Acme" and enr["contact"]["name"] == "Dee Fox"


async def test_dsn_and_reply_parsers_directly():
    msg = EmailMessage()
    msg["From"] = "x@y.test"
    msg["Auto-Submitted"] = "auto-generated"
    assert inbound.is_auto_reply(msg)
    assert inbound.message_ids("a <one@x> b <two@y>") == ["<one@x>", "<two@y>"]
