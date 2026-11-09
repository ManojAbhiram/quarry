"""Fixtures and fakes for the Phase 3 tests: no network, no real SMTP/IMAP/DNS."""
from email.message import EmailMessage

import httpx
import pytest

from app.outreach.ports import SendError, ports


class FakeSmtp:
    def __init__(self):
        self.sent: list[EmailMessage] = []
        self.fail_with: SendError | None = None

    async def send(self, creds, message):
        if self.fail_with:
            raise self.fail_with
        self.sent.append(message)


class FakeImap:
    def __init__(self):
        self.inbox: list[tuple[int, bytes]] = []
        self.boom = False

    async def fetch_new(self, creds, after_uid):
        if self.boom:
            raise OSError("imap down")
        return [(u, r) for u, r in self.inbox if u > after_uid]


class FakeDns:
    def __init__(self, records=None):
        self.records = records or {}

    async def txt(self, name):
        return self.records.get(name, [])


@pytest.fixture
def smtp(monkeypatch):
    fake = FakeSmtp()
    monkeypatch.setattr(ports, "smtp", fake)
    return fake


@pytest.fixture
def imap(monkeypatch):
    fake = FakeImap()
    monkeypatch.setattr(ports, "imap", fake)
    return fake


@pytest.fixture
def dns(monkeypatch):
    fake = FakeDns()
    monkeypatch.setattr(ports, "dns", fake)
    return fake


@pytest.fixture
async def api(db):
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def signup(api):
    async def _signup(email="p3@t.com"):
        body = {"email": email, "name": "Pat Three", "password": "Passw0rd!x", "org_name": "Org",
                "org_domain": email.split("@")[0] + ".test"}
        r = await api.post("/api/auth/register", json=body)
        assert r.status_code == 201, r.text
        j = r.json()
        return {"Authorization": f"Bearer {j['access_token']}"}, j["user"]["id"]

    return _signup


MAILBOX = {"email": "me@sender.test", "from_name": "Me Sender", "smtp_host": "smtp.sender.test", "smtp_port": 587,
           "smtp_password": "s3cret-smtp", "imap_host": "imap.sender.test", "imap_password": "s3cret-imap",
           "daily_cap": 50, "warmup": False, "timezone": "UTC"}

STEPS = [{"subject": "Hi {{first_name|there}}", "body": "Hello {{first_name|there}} at {{company}}", "delay_days": 0},
         {"subject": "", "body": "Following up, {{first_name|there}}", "delay_days": 2}]


@pytest.fixture
def make_sequence(api):
    async def _make(headers, steps=None, **extra):
        mb = await api.post("/api/outreach/mailboxes", headers=headers, json=MAILBOX)
        assert mb.status_code == 201, mb.text
        body = {"name": "Seq", "mailbox_id": mb.json()["_id"], "steps": steps or STEPS, "timezone": "UTC",
                "window_start": "00:00", "window_end": "23:59", "days": [0, 1, 2, 3, 4, 5, 6], **extra}
        seq = await api.post("/api/outreach/sequences", headers=headers, json=body)
        assert seq.status_code == 201, seq.text
        return mb.json(), seq.json()

    return _make
