import pytest

from app.db.models import TABLES
from app.integrations import webhooks
from app.watch import signals
from app.watch.ports import keyword_label, ports


class FakePages:
    def __init__(self):
        self.html: dict[str, str] = {}

    async def get_html(self, url):
        return self.html.get(url)


class FakeFeeds:
    def __init__(self):
        self.xml = ""

    async def get_xml(self, url):
        return self.xml


class FakeClassifier:
    def __init__(self, labels=None):
        self.labels = labels
        self.seen = []

    async def classify(self, company, items):
        self.seen.append((company, [i["title"] for i in items]))
        return self.labels or [keyword_label(i["title"]) for i in items]


class FakeTech:
    def __init__(self):
        self.stack = []

    async def detect(self, url):
        return self.stack


class FakeEmail:
    def __init__(self):
        self.sent = []
        self.fail = False

    async def send(self, to, subject, text):
        if self.fail:
            raise RuntimeError("smtp down")
        self.sent.append((to, subject, text))


class FakeSlack:
    def __init__(self):
        self.calls = []
        self.status = 200

    async def post(self, url, body, headers):
        self.calls.append((url, body))
        return self.status


@pytest.fixture
def fakes(monkeypatch):
    class F:
        pages, feeds, classifier, tech, email, slack = FakePages(), FakeFeeds(), FakeClassifier(), FakeTech(), FakeEmail(), FakeSlack()

    for name in ("pages", "feeds", "classifier", "tech", "email", "slack"):
        monkeypatch.setattr(ports, name, getattr(F, name))
    # keep the (unrelated) webhook queue from touching the network
    monkeypatch.setattr(webhooks.ports, "poster", FakeSlack())
    return F


def rss(*titles):
    items = "".join(f"<item><title>{t}</title><link>https://n.test/{i}</link><pubDate>Mon</pubDate></item>"
                    for i, t in enumerate(titles))
    return f"<rss><channel>{items}</channel></rss>"


def careers(*roles):
    return "<html><body>" + "".join(f"<li><a href='/j'>{r}</a></li>" for r in roles) + "</body></html>"


async def lead(uid, url="https://acme.test", title="Acme", score=50.0, **kw):
    return await TABLES["leads"].insert({"request_id": "r1", "user_id": uid, "url": url, "title": title,
                                         "match_score": score, **kw})


def test_domain_extraction():
    assert signals.domain_of("https://www.Acme.test/about") == "acme.test"
    assert signals.domain_of("acme.test") == "acme.test"
    assert signals.domain_of("") == ""


def test_feed_parser_rejects_entity_declarations_and_garbage():
    assert signals.parse_feed("<!DOCTYPE x [<!ENTITY a 'b'>]><rss/>") == []
    assert signals.parse_feed("not xml") == []
    assert signals.parse_feed(rss("A", "B"))[1]["title"] == "B"


async def test_hiring_signal_is_a_diff_not_a_baseline(api, signup, fakes):
    _, uid = await signup()
    fakes.pages.html["https://acme.test/careers"] = careers("Senior Backend Engineer", "Account Executive")
    assert await signals.scan_hiring(uid, "acme.test") is None  # first sight = baseline
    assert await signals.scan_hiring(uid, "acme.test") is None  # unchanged
    fakes.pages.html["https://acme.test/careers"] = careers("Senior Backend Engineer", "Account Executive", "Head of Data")
    ev = await signals.scan_hiring(uid, "acme.test")
    assert ev["kind"] == "hiring" and ev["details"]["added"] == ["head of data"]
    assert await signals.scan_hiring(uid, "acme.test") is None  # already recorded
    assert await signals.scan_hiring(uid, "nowhere.test") is None  # no careers page


async def test_whole_page_redesign_is_not_a_hiring_signal(api, signup, fakes):
    _, uid = await signup()
    fakes.pages.html["https://acme.test/careers"] = careers(*[f"Role number {i}" for i in range(5)])
    await signals.scan_hiring(uid, "acme.test")
    fakes.pages.html["https://acme.test/careers"] = careers(*[f"Totally new {i} thing" for i in range(40)])
    assert await signals.scan_hiring(uid, "acme.test") is None


async def test_news_is_classified_and_only_funding_style_items_become_signals(api, signup, fakes):
    _, uid = await signup()
    fakes.feeds.xml = rss("Acme in the news")
    assert await signals.scan_news(uid, "acme.test", "Acme") == []  # baseline
    fakes.feeds.xml = rss("Acme in the news", "Acme raises $20M Series B", "Acme hosts a picnic", "Acme launches Pro tier")
    out = await signals.scan_news(uid, "acme.test", "Acme")
    assert [(e["kind"], e["details"]["label"]) for e in out] == [("funding", "funding"), ("news", "launch")]
    assert fakes.classifier.seen[-1][1] == ["Acme raises $20M Series B", "Acme hosts a picnic", "Acme launches Pro tier"]
    assert await signals.scan_news(uid, "acme.test", "Acme") == []  # nothing fresh -> classifier not called again
    assert len(fakes.classifier.seen) == 1


async def test_llm_classifier_falls_back_to_keywords(monkeypatch):
    from app.watch.ports import LlmClassifier

    async def boom(**kw):
        raise RuntimeError("llm down")

    monkeypatch.setattr("app.services.llm._llm_json_completion", boom)
    labels = await LlmClassifier().classify("Acme", [{"title": "Acme acquires Foo"}, {"title": "Weather"}])
    assert labels == ["acquisition", "other"]

    async def good(**kw):
        return {"labels": ["funding", "bogus"]}

    monkeypatch.setattr("app.services.llm._llm_json_completion", good)
    assert await LlmClassifier().classify("Acme", [{"title": "x"}, {"title": "y"}]) == ["funding", "other"]


async def test_tech_stack_change_detected(api, signup, fakes):
    _, uid = await signup()
    fakes.tech.stack = ["React", "AWS"]
    assert await signals.scan_tech(uid, "acme.test") is None
    fakes.tech.stack = ["React", "Snowflake", "Stripe"]
    ev = await signals.scan_tech(uid, "acme.test")
    assert ev["details"] == {"added": ["Snowflake", "Stripe"], "removed": ["AWS"]}
    fakes.tech.stack = []  # detector failure must not look like "everything removed"
    assert await signals.scan_tech(uid, "acme.test") is None


async def test_scan_user_and_surface_on_leads(api, signup, fakes):
    h, uid = await signup()
    lid = await lead(uid)
    fakes.tech.stack = ["React"]
    fakes.pages.html["https://acme.test/careers"] = careers("Engineer")
    fakes.feeds.xml = rss("old")
    assert (await api.post("/api/watch/scan", headers=h)).json()["domains"] == 1
    fakes.tech.stack = ["React", "Vue"]
    fakes.pages.html["https://acme.test/careers"] = careers("Engineer", "Designer")
    fakes.feeds.xml = rss("old", "Acme raises seed round")
    found = (await api.post("/api/watch/scan", headers=h)).json()
    assert (found["hiring"], found["funding"], found["tech"]) == (1, 1, 1)
    by_lead = (await api.get(f"/api/watch/leads/{lid}/signals", headers=h)).json()
    assert by_lead["domain"] == "acme.test" and {s["kind"] for s in by_lead["signals"]} == {"hiring", "funding", "tech"}
    only = (await api.get("/api/watch/signals?kind=funding", headers=h)).json()["signals"]
    assert len(only) == 1 and only[0]["summary"].startswith("Acme raises")


async def test_signals_are_private_per_user(api, signup, fakes):
    ha, ua = await signup("a@t.com")
    hb, ub = await signup("b@t.com")
    lid = await lead(ua)
    fakes.tech.stack = ["A"]
    await signals.scan_tech(ua, "acme.test")
    fakes.tech.stack = ["B"]
    await signals.scan_tech(ua, "acme.test")
    assert (await api.get("/api/watch/signals", headers=hb)).json()["signals"] == []
    assert (await api.get(f"/api/watch/leads/{lid}/signals", headers=hb)).status_code == 404


async def test_saved_search_alerts_email_and_slack_for_new_matches_only(api, signup, fakes):
    h, uid = await signup("alerts@t.com")
    await lead(uid, "https://old.test", "Old Fintech", 80)
    r = await api.post("/api/watch/searches", headers=h, json={
        "name": "Fintech 70+", "query": {"text": "fintech", "min_score": 70},
        "slack_webhook_url": "https://hooks.slack.com/services/T/B/secret"})
    assert r.status_code == 201
    sid = r.json()["_id"]
    assert r.json()["has_slack"] and "slack_webhook_enc" not in r.json() and r.json()["seen_count"] == 1
    assert "secret" not in str(await TABLES["saved_searches"].get(_id=sid)).replace("slack_webhook_enc", "")
    assert (await api.post(f"/api/watch/searches/{sid}/run", headers=h)).json()["new"] == 0  # existing not announced
    await lead(uid, "https://new.test", "New Fintech", 90)
    await lead(uid, "https://low.test", "Low Fintech", 10)
    await lead(uid, "https://other.test", "Bakery", 99)
    res = (await api.post(f"/api/watch/searches/{sid}/run", headers=h)).json()
    assert res["new"] == 1 and set(res["alerted"]) == {"email", "slack"}
    assert fakes.email.sent[0][0] == "alerts@t.com" and "New Fintech" in fakes.email.sent[0][2]
    assert fakes.slack.calls[0][0] == "https://hooks.slack.com/services/T/B/secret"
    assert (await api.post(f"/api/watch/searches/{sid}/run", headers=h)).json()["new"] == 0  # not repeated


async def test_failed_alert_is_retried_next_run(api, signup, fakes):
    h, uid = await signup()
    sid = (await api.post("/api/watch/searches", headers=h, json={"name": "all", "query": {}})).json()["_id"]
    await lead(uid)
    fakes.email.fail = True
    assert (await api.post(f"/api/watch/searches/{sid}/run", headers=h)).json()["alerted"] == []
    assert "smtp down" in (await TABLES["saved_searches"].get(_id=sid))["last_error"]
    fakes.email.fail = False
    assert (await api.post(f"/api/watch/searches/{sid}/run", headers=h)).json()["alerted"] == ["email"]


async def test_saved_search_can_require_signals(api, signup, fakes):
    h, uid = await signup()
    sid = (await api.post("/api/watch/searches", headers=h, json={"name": "hot", "query": {"signal_kinds": ["funding"]}})).json()["_id"]
    await lead(uid)
    assert (await api.post(f"/api/watch/searches/{sid}/run", headers=h)).json()["new"] == 0
    await signals._record(uid, "acme.test", "funding", "Acme raises", {})
    assert (await api.post(f"/api/watch/searches/{sid}/run", headers=h)).json()["new"] == 1


async def test_slack_url_validation_and_ownership(api, signup, fakes):
    ha, _ = await signup("a@t.com")
    hb, _ = await signup("b@t.com")
    bad = await api.post("/api/watch/searches", headers=ha, json={"name": "x", "slack_webhook_url": "https://evil.test/hook"})
    assert bad.status_code == 422
    assert (await api.post("/api/watch/searches", headers=ha, json={"query": {}})).status_code == 422
    sid = (await api.post("/api/watch/searches", headers=ha, json={"name": "mine"})).json()["_id"]
    assert (await api.put(f"/api/watch/searches/{sid}", headers=hb, json={"name": "hijack"})).status_code == 404
    assert (await api.post(f"/api/watch/searches/{sid}/run", headers=hb)).status_code == 404
    assert (await api.delete(f"/api/watch/searches/{sid}", headers=hb)).status_code == 404
    assert (await api.delete(f"/api/watch/searches/{sid}", headers=ha)).status_code == 204
