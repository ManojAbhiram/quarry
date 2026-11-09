from datetime import timedelta

from app.outreach import service
from app.p3.config import POSTAL_ADDRESS_PLACEHOLDER
from tests.p3.test_p3_outreach_flow import NOW, started


def _bodies(msg):
    return msg.get_body(("plain",)).get_content(), msg.get_body(("html",)).get_content()


async def test_every_email_has_unsubscribe_link_and_postal_address(api, signup, make_sequence, smtp, monkeypatch):
    monkeypatch.setenv("OUTREACH_POSTAL_ADDRESS", "1 Quarry Way, Springfield 12345")
    h, _ = await signup()
    await started(api, h, make_sequence)
    await service.run_due(NOW)
    await service.run_due(NOW + timedelta(days=3))
    assert len(smtp.sent) == 2  # the first step and the follow-up
    for msg in smtp.sent:
        link = msg["List-Unsubscribe"].split("<")[1].split(">")[0]
        assert "/api/public/unsubscribe/" in link
        text, markup = _bodies(msg)
        assert link in text and "1 Quarry Way, Springfield 12345" in text
        assert link in markup and "1 Quarry Way, Springfield 12345" in markup


async def test_missing_address_setting_uses_visible_placeholder(api, signup, make_sequence, smtp, monkeypatch):
    monkeypatch.delenv("OUTREACH_POSTAL_ADDRESS", raising=False)
    h, _ = await signup()
    await started(api, h, make_sequence)
    await service.run_due(NOW)
    text, markup = _bodies(smtp.sent[0])
    assert POSTAL_ADDRESS_PLACEHOLDER in text and "OUTREACH_POSTAL_ADDRESS" in markup


def test_footer_escapes_html_in_address(monkeypatch):
    monkeypatch.setenv("OUTREACH_POSTAL_ADDRESS", "A & B <Ltd>")
    _, markup = service.compliance_footer("https://x.test/u?a=1&b=2")
    assert "A &amp; B &lt;Ltd&gt;" in markup and "a=1&amp;b=2" in markup
