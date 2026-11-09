"""Email status (verified / likely / risky / invalid): local checks, SMTP probe, paid providers. No network."""
import httpx
import pytest

from app.db.models import TABLES
from app.verification import VerifierConfig, local, smtp, verify, verify_many
from app.verification import providers as prov


@pytest.fixture
def mx(monkeypatch):
    """Control DNS: domains in the returned set have an MX record."""
    domains = {"acme.com", "mailinator.com"}
    monkeypatch.setattr(local, "get_mx_records", lambda d: ["mx." + d] if d in domains else [])
    return domains


def _transport(handler):
    return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))


# ── local checks ─────────────────────────────────────────────────────────────

async def test_bad_syntax_is_invalid(mx):
    r = await verify("not-an-email")
    assert r.status == "invalid" and r.method == "syntax_check" and r.checked_at


async def test_no_mx_is_invalid(mx):
    r = await verify("jane@nodomain.example")
    assert r.status == "invalid" and "No MX" in r.reason


async def test_mx_without_probe_is_likely_with_timestamp(mx):
    r = await verify("jane@acme.com")
    assert r.status == "likely" and r.method == "dns_mx"
    d = r.to_dict()
    assert d["email_status"] == "likely" and d["verified"] is True and d["confidence"] == "medium" and d["checked_at"]


async def test_disposable_domain_is_risky(mx):
    r = await verify("x@mailinator.com")
    assert r.status == "risky" and "disposable" in r.reason


async def test_role_account_is_risky(mx):
    r = await verify("info@acme.com")
    assert r.status == "risky" and "role account" in r.reason


async def test_invalid_maps_to_legacy_not_verified(mx):
    d = (await verify("bad")).to_dict()
    assert d["verified"] is False and d["confidence"] == "low"


async def test_verify_many_keeps_order(mx):
    out = await verify_many(["jane@acme.com", "bad", "info@acme.com"])
    assert [o.status for o in out] == ["likely", "invalid", "risky"]


# ── SMTP probe and catch-all ─────────────────────────────────────────────────

def _smtp(monkeypatch, outcome):
    monkeypatch.setattr(smtp, "probe", lambda host, email, timeout=5: outcome)


async def test_smtp_accept_is_verified(mx, monkeypatch):
    _smtp(monkeypatch, smtp.SmtpOutcome(True, False, "SMTP RCPT returned 250"))
    r = await verify("jane@acme.com", VerifierConfig(smtp_probe=True))
    assert r.status == "verified" and r.catch_all is False and r.method == "smtp_rcpt"


async def test_smtp_catch_all_is_risky(mx, monkeypatch):
    _smtp(monkeypatch, smtp.SmtpOutcome(True, True, "SMTP RCPT returned 250"))
    r = await verify("jane@acme.com", VerifierConfig(smtp_probe=True))
    assert r.status == "risky" and r.catch_all is True and "cannot confirm" in r.reason


async def test_smtp_reject_is_invalid(mx, monkeypatch):
    _smtp(monkeypatch, smtp.SmtpOutcome(False, False, "SMTP RCPT returned 550"))
    assert (await verify("jane@acme.com", VerifierConfig(smtp_probe=True))).status == "invalid"


async def test_smtp_inconclusive_stays_likely(mx, monkeypatch):
    _smtp(monkeypatch, smtp.SmtpOutcome(None, None, "SMTP probe inconclusive: timeout"))
    assert (await verify("jane@acme.com", VerifierConfig(smtp_probe=True))).status == "likely"


async def test_smtp_not_called_unless_enabled(mx, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("SMTP must be opt-in")

    monkeypatch.setattr(smtp, "probe", boom)
    assert (await verify("jane@acme.com")).status == "likely"


def test_smtp_probe_detects_catch_all(monkeypatch):
    monkeypatch.setattr(smtp, "resolve_public", lambda host, port: ["203.0.113.5"])
    monkeypatch.setattr(smtp, "_rcpt", lambda ip, addrs, timeout: [(250, "ok"), (250, "ok")])
    out = smtp.probe("mx.acme.com", "jane@acme.com")
    assert out.accepted is True and out.catch_all is True


def test_smtp_probe_refused_target_is_inconclusive(monkeypatch):
    def refuse(host, port):
        raise smtp.UnsafeURLError("private")

    monkeypatch.setattr(smtp, "resolve_public", refuse)
    out = smtp.probe("mx.evil.example", "a@evil.example")
    assert out.accepted is None and "refused" in out.reason


# ── paid providers (HTTP mocked) ─────────────────────────────────────────────

CASES = [
    ("millionverifier", {"result": "ok"}, "verified"),
    ("millionverifier", {"result": "catch_all"}, "risky"),
    ("millionverifier", {"result": "invalid", "subresult": "mailbox_not_found"}, "invalid"),
    ("zerobounce", {"status": "valid"}, "verified"),
    ("zerobounce", {"status": "catch-all"}, "risky"),
    ("zerobounce", {"status": "spamtrap"}, "invalid"),
    ("neverbounce", {"status": "success", "result": "valid"}, "verified"),
    ("neverbounce", {"status": "success", "result": "catchall"}, "risky"),
    ("neverbounce", {"status": "success", "result": "unknown"}, "risky"),
    ("neverbounce", {"status": "success", "result": "invalid"}, "invalid"),
]


@pytest.mark.parametrize("name,payload,expected", CASES)
async def test_provider_status_mapping(mx, monkeypatch, name, payload, expected):
    seen = {}

    def handler(request: httpx.Request):
        seen["host"] = request.url.host
        return httpx.Response(200, json=payload)

    monkeypatch.setattr(prov, "http_client", _transport(handler))
    cfg = VerifierConfig(provider=prov.get_provider(name, "secret-key-123"))
    r = await verify("jane@acme.com", cfg)
    assert r.status == expected and r.provider == name and r.method == f"provider:{name}"
    assert seen["host"]


async def test_provider_catch_all_flag(mx, monkeypatch):
    monkeypatch.setattr(prov, "http_client", _transport(lambda req: httpx.Response(200, json={"result": "catch_all"})))
    r = await verify("jane@acme.com", VerifierConfig(provider=prov.get_provider("millionverifier", "k" * 10)))
    assert r.catch_all is True


async def test_provider_failure_falls_back_to_local_checks(mx, monkeypatch):
    monkeypatch.setattr(prov, "http_client", _transport(lambda req: httpx.Response(401)))
    r = await verify("jane@acme.com", VerifierConfig(provider=prov.get_provider("zerobounce", "k" * 10)))
    assert r.status == "likely" and "rejected the API key" in r.reason


async def test_provider_network_error_falls_back(mx, monkeypatch):
    def handler(request):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(prov, "http_client", _transport(handler))
    r = await verify("jane@acme.com", VerifierConfig(provider=prov.get_provider("neverbounce", "k" * 10)))
    assert r.status == "likely" and "used free checks" in r.reason


async def test_provider_valid_role_account_is_downgraded(mx, monkeypatch):
    monkeypatch.setattr(prov, "http_client", _transport(lambda req: httpx.Response(200, json={"result": "ok"})))
    r = await verify("sales@acme.com", VerifierConfig(provider=prov.get_provider("millionverifier", "k" * 10)))
    assert r.status == "risky"


def test_unknown_provider_or_missing_key_gives_none():
    assert prov.get_provider("nope", "key12345") is None
    assert prov.get_provider("zerobounce", "") is None


# ── settings API: key stored encrypted, status persisted ─────────────────────

async def test_settings_store_key_encrypted_and_mask_it(api, signup):
    h, uid = await signup()
    r = await api.put("/api/verification/settings", headers=h, json={"provider": "zerobounce", "api_key": "zb-secret-1234", "smtp_probe": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "zerobounce" and body["has_key"] and body["smtp_probe"] is True
    assert "secret" not in str(body) and body["masked"].endswith("1234")
    stored = await TABLES["users"].get(_id=uid)
    assert stored["verifier_api_key_encrypted"] and "zb-secret" not in stored["verifier_api_key_encrypted"]
    cfg = VerifierConfig.from_user(stored)
    assert cfg.provider.name == "zerobounce" and cfg.provider.api_key == "zb-secret-1234" and cfg.smtp_probe

    r = await api.delete("/api/verification/settings/key", headers=h)
    assert r.json()["has_key"] is False


async def test_settings_reject_unknown_provider_and_clear(api, signup):
    h, _ = await signup()
    assert (await api.put("/api/verification/settings", headers=h, json={"provider": "bogus"})).status_code == 400
    await api.put("/api/verification/settings", headers=h, json={"provider": "neverbounce", "api_key": "nb-key-12345"})
    r = await api.put("/api/verification/settings", headers=h, json={"provider": ""})
    assert r.json()["provider"] is None and r.json()["has_key"] is False


async def test_verify_lead_endpoint_persists_status_and_checked_at(api, signup, mx):
    h, uid = await signup()
    lead_id = await TABLES["leads"].insert({"request_id": "r", "user_id": uid, "url": "https://acme.com", "title": "Acme", "email": "jane@acme.com"})
    r = await api.post(f"/api/leads/{lead_id}/verify-email", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "likely"
    lead = await TABLES["leads"].get(_id=lead_id)
    assert lead["email_status"] == "likely" and lead["email_checked_at"] and lead["email_status_reason"]


async def test_verify_decision_maker_persists_and_checks_ownership(api, signup, mx):
    h, uid = await signup()
    h2, _ = await signup("other@t.com")
    lead_id = await TABLES["leads"].insert({"request_id": "r", "user_id": uid, "url": "https://acme.com", "title": "Acme"})
    dm_id = await TABLES["decision_makers"].insert({"lead_id": lead_id, "name": "Jane", "email": "jane@acme.com"})
    assert (await api.post(f"/api/verification/decision-makers/{dm_id}/verify", headers=h2)).status_code == 404
    r = await api.post(f"/api/verification/decision-makers/{dm_id}/verify", headers=h)
    assert r.status_code == 200 and r.json()["status"] == "likely"
    assert (await TABLES["decision_makers"].get(_id=dm_id))["email_checked_at"]
    no_email = await TABLES["decision_makers"].insert({"lead_id": lead_id, "name": "Bob"})
    assert (await api.post(f"/api/verification/decision-makers/{no_email}/verify", headers=h)).status_code == 400
