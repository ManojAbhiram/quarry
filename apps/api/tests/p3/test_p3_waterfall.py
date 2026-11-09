import json

import pytest

from app.db.models import TABLES
from app.p3.config import p3_settings
from app.waterfall import claude_scoring, providers, service
from app.waterfall.providers import Person


class FakeHttp:
    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.responses: dict[str, tuple[int, dict]] = {}

    async def get_json(self, url, params=None, headers=None):
        self.calls.append(("GET", url))
        return self.responses.get(url, (404, {}))

    async def post_json(self, url, body, headers=None):
        self.calls.append(("POST", url))
        return self.responses.get(url, (404, {}))


HUNTER = "https://api.hunter.io/v2/email-finder"
PDL = "https://api.peopledatalabs.com/v5/person/enrich"


@pytest.fixture
def http(monkeypatch):
    fake = FakeHttp()
    monkeypatch.setattr(providers.ports, "http", fake)
    for p in ("HUNTER", "SNOV", "PDL"):
        monkeypatch.delenv(f"{p}_API_KEY", raising=False)
    return fake


PERSON = Person(name="Dee Fox", domain="acme.test", company="Acme")


async def test_free_scrape_hit_costs_nothing_and_stops_waterfall(api, signup, http):
    _, uid = await signup()
    res = await service.run_waterfall(uid, Person(name="Dee Fox", domain="acme.test", known_email="dee@acme.test"))
    assert res["provider"] == "scrape" and res["credits_spent"] == 0 and http.calls == []
    assert await service.balance(uid) == 100  # welcome credits untouched


async def test_waterfall_order_skips_providers_without_keys(api, signup, http):
    _, uid = await signup()
    res = await service.run_waterfall(uid, PERSON)
    assert res["found"] is False
    assert [t["status"] for t in res["tried"]] == ["miss", "skipped_no_key", "skipped_no_key", "skipped_no_key"]
    assert http.calls == []


async def test_byo_key_hit_logs_usage_without_debiting_credits(api, signup, http):
    _, uid = await signup()
    await service.set_key(uid, "hunter", "hunter-key-1234")
    http.responses[HUNTER] = (200, {"data": {"email": "dee@acme.test", "score": 91}})
    res = await service.run_waterfall(uid, PERSON)
    assert res["provider"] == "hunter" and res["email"] == "dee@acme.test" and res["credits_spent"] == 0
    assert await service.balance(uid) == 100
    hist = await service.history(uid)
    usage = next(h for h in hist if h["kind"] == "debit")
    assert usage["byo"] is True and usage["delta"] == 0


async def test_platform_key_debits_per_success_only(api, signup, http, monkeypatch):
    _, uid = await signup()
    monkeypatch.setenv("HUNTER_API_KEY", "platform-hunter")
    monkeypatch.setenv("PDL_API_KEY", "platform-pdl")
    # hunter misses (no debit), pdl hits (3 credits)
    http.responses[HUNTER] = (200, {"data": {}})
    http.responses[PDL] = (200, {"data": {"work_email": "dee@acme.test"}, "likelihood": 8})
    res = await service.run_waterfall(uid, PERSON)
    assert [t["status"] for t in res["tried"]] == ["miss", "miss", "skipped_no_key", "hit"]
    assert res["credits_spent"] == 3 and await service.balance(uid) == 97
    # a pure miss costs nothing
    http.responses[PDL] = (200, {"data": {}})
    assert (await service.run_waterfall(uid, PERSON))["credits_spent"] == 0
    assert await service.balance(uid) == 97


async def test_insufficient_credits_skips_platform_provider(api, signup, http, monkeypatch):
    _, uid = await signup()
    monkeypatch.setenv("PDL_API_KEY", "platform-pdl")
    await service.balance(uid)
    await service.debit(uid, 99, "x", "drain")  # 1 credit left, pdl needs 3
    http.responses[PDL] = (200, {"data": {"work_email": "dee@acme.test"}})
    res = await service.run_waterfall(uid, PERSON)
    assert res["found"] is False and res["tried"][-1]["status"] == "skipped_no_credits"
    assert ("GET", PDL) not in http.calls


async def test_provider_errors_fall_through_to_next(api, signup, http):
    _, uid = await signup()
    await service.set_key(uid, "hunter", "bad-key-1")
    await service.set_key(uid, "pdl", "good-key-1")
    http.responses[HUNTER] = (429, {})
    http.responses[PDL] = (200, {"data": {"emails": [{"address": "dee@acme.test"}]}})
    res = await service.run_waterfall(uid, PERSON)
    assert [t["status"] for t in res["tried"]] == ["miss", "error", "skipped_no_key", "hit"]
    assert res["provider"] == "pdl"


async def test_snov_uses_oauth_then_lookup(api, signup, http):
    _, uid = await signup()
    await service.set_key(uid, "snov", "cid:csecret")
    http.responses["https://api.snov.io/v1/oauth/access_token"] = (200, {"access_token": "tok"})
    http.responses["https://api.snov.io/v1/get-emails-from-names"] = (
        200, {"data": {"emails": [{"email": "bad@acme.test", "emailStatus": "not_valid"}, {"email": "dee@acme.test", "emailStatus": "valid"}]}})
    res = await service.run_waterfall(uid, PERSON, order=["snov"])
    assert res["email"] == "dee@acme.test"


async def test_byo_keys_are_encrypted_masked_and_deletable(api, signup, http):
    h, uid = await signup()
    r = await api.put("/api/enrichment/keys/hunter", headers=h, json={"key": "super-secret-key-9999"})
    assert r.json()["masked"].endswith("9999")
    assert "super-secret" not in str(await TABLES["provider_keys"].find())
    info = (await api.get("/api/enrichment/credits", headers=h)).json()
    hunter = next(p for p in info["providers"] if p["provider"] == "hunter")
    assert hunter["byo_key"].endswith("9999") and "super-secret" not in json.dumps(info)
    assert info["balance"] == 100 and info["order"] == ["scrape", "hunter", "snov", "pdl"]
    assert (await api.put("/api/enrichment/keys/scrape", headers=h, json={"key": "abcd"})).status_code == 404
    assert (await api.delete("/api/enrichment/keys/hunter", headers=h)).status_code == 204
    assert (await api.delete("/api/enrichment/keys/hunter", headers=h)).status_code == 404


async def test_enrich_lead_fills_missing_decision_maker_emails(api, signup, http):
    h, uid = await signup()
    await service.set_key(uid, "hunter", "hunter-key-1234")
    lid = await TABLES["leads"].insert({"request_id": "r", "user_id": uid, "url": "https://www.acme.test", "title": "Acme"})
    dm = await TABLES["decision_makers"].insert({"lead_id": lid, "name": "Dee Fox", "title": "CTO"})
    await TABLES["decision_makers"].insert({"lead_id": lid, "name": "Has Mail", "email": "h@acme.test"})
    http.responses[HUNTER] = (200, {"data": {"email": "dee@acme.test", "score": 80}})
    res = (await api.post(f"/api/enrichment/leads/{lid}/waterfall", headers=h)).json()
    assert len(res["results"]) == 1 and res["results"][0]["provider"] == "hunter"
    stored = await TABLES["decision_makers"].get(_id=dm)
    assert stored["email"] == "dee@acme.test" and stored["email_source"] == "hunter"
    assert (await api.post("/api/enrichment/leads/nope/waterfall", headers=h)).status_code == 404


# ------------------------------------------------------------------ Claude batch scoring
class FakeBatch:
    def __init__(self):
        self.created = None
        self.state = "in_progress"

    async def create(self, requests):
        self.created = requests
        return "batch_1"

    async def status(self, batch_id):
        return {"processing_status": self.state}

    async def results(self, batch_id):
        return [
            {"custom_id": "a", "result": {"type": "succeeded", "message": {"content": [
                {"type": "text", "text": 'Sure: {"score": 87, "reason": "Great fit"}'}]}}},
            {"custom_id": "b", "result": {"type": "errored"}},
            {"custom_id": "c", "result": {"type": "succeeded", "message": {"content": [{"type": "text", "text": "no json"}]}}},
        ]


def test_batch_requests_share_a_cached_system_block():
    reqs = claude_scoring.build_requests([{"_id": "a", "title": "A"}, {"_id": "b", "title": "B"}], "SaaS CTOs")
    assert [r["custom_id"] for r in reqs] == ["a", "b"]
    system = reqs[0]["params"]["system"]
    assert system[0]["cache_control"] == {"type": "ephemeral"} and system == reqs[1]["params"]["system"]
    assert "SaaS CTOs" in reqs[0]["params"]["messages"][0]["content"]


def test_parse_results_skips_failures_and_clamps():
    out = claude_scoring.parse_results(FakeBatch_results())
    assert out == {"a": {"score": 87, "reason": "Great fit"}}


def FakeBatch_results():
    import asyncio

    return asyncio.run(FakeBatch().results("x"))


async def test_batch_scoring_is_off_by_default(api, signup):
    h, uid = await signup()
    req = await TABLES["requests"].insert({"user_id": uid})
    r = await api.post("/api/enrichment/scoring/batch", headers=h, json={"request_id": req, "icp": "x"})
    assert r.status_code == 409 and "disabled" in r.text
    assert (await api.post("/api/enrichment/scoring/batch", headers=h, json={"request_id": "nope"})).status_code == 404


async def test_batch_scoring_submit_collect_apply_with_flag(api, signup, monkeypatch):
    monkeypatch.setenv("CLAUDE_BATCH_SCORING", "true")
    assert p3_settings.claude_batch_scoring
    fake = FakeBatch()
    monkeypatch.setattr(claude_scoring.ports, "client", fake)
    h, uid = await signup()
    req = await TABLES["requests"].insert({"user_id": uid})
    lead_a = await TABLES["leads"].insert({"request_id": req, "user_id": uid, "url": "https://a.test", "title": "A", "match_score": 1.0})
    sub = (await api.post("/api/enrichment/scoring/batch", headers=h, json={"request_id": req, "icp": "icp"})).json()
    assert sub == {"batch_id": "batch_1", "leads": 1} and fake.created[0]["custom_id"] == lead_a
    assert (await api.get("/api/enrichment/scoring/batch/batch_1", headers=h)).json()["status"] == "in_progress"
    fake.state = "ended"
    fake_rows = [{"custom_id": lead_a, "result": {"type": "succeeded", "message": {"content": [
        {"type": "text", "text": '{"score": 72, "reason": "ok"}'}]}}}]

    async def results(_):
        return fake_rows

    fake.results = results
    done = (await api.get("/api/enrichment/scoring/batch/batch_1?apply=true", headers=h)).json()
    assert done["scores"][lead_a]["score"] == 72
    assert (await TABLES["leads"].get(_id=lead_a))["match_score"] == 72.0


async def test_enabled_without_credentials_reports_cleanly(api, signup, monkeypatch):
    monkeypatch.setenv("CLAUDE_BATCH_SCORING", "true")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    h, uid = await signup()
    req = await TABLES["requests"].insert({"user_id": uid})
    r = await api.post("/api/enrichment/scoring/batch", headers=h, json={"request_id": req})
    assert r.status_code == 409 and "ANTHROPIC_API_KEY" in r.text
