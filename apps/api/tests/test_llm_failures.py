"""LLM failures must be observable: logged, typed, and recorded on the lead (no silent blanks)."""
import json
import logging
from types import SimpleNamespace

import pytest

from app.services import llm
from app.services.llm import LLMCompletionError


def _resp(content, model="m"):
    return SimpleNamespace(model=model, choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def _patch(monkeypatch, fn):
    monkeypatch.setattr(llm, "acompletion", fn)


async def _call(**kw):
    return await llm._llm_json_completion(model="m", system_prompt="s", user_prompt="u", **kw)


async def test_success_returns_parsed_dict(monkeypatch):
    async def ok(**_):
        return _resp(json.dumps({"a": 1}))

    _patch(monkeypatch, ok)
    assert await _call() == {"a": 1}


async def test_provider_error_degrades_to_empty_dict_and_logs(monkeypatch, caplog):
    async def boom(**_):
        raise RuntimeError("401 bad key")

    _patch(monkeypatch, boom)
    with caplog.at_level(logging.ERROR):
        assert await _call(purpose="unit") == {}
    assert any("reason=provider_error" in r.getMessage() and "purpose=unit" in r.getMessage() for r in caplog.records)


async def test_raise_on_error_provider(monkeypatch):
    async def boom(**_):
        raise RuntimeError("503")

    _patch(monkeypatch, boom)
    with pytest.raises(LLMCompletionError) as ei:
        await _call(raise_on_error=True, purpose="x")
    assert ei.value.reason == "provider_error" and ei.value.purpose == "x" and ei.value.model == "m"


async def test_raise_on_error_empty_and_unparseable(monkeypatch):
    async def empty(**_):
        return _resp("")

    _patch(monkeypatch, empty)
    with pytest.raises(LLMCompletionError) as ei:
        await _call(raise_on_error=True)
    assert ei.value.reason == "empty_response"

    async def junk(**_):
        return _resp("this is not json at all")

    _patch(monkeypatch, junk)
    with pytest.raises(LLMCompletionError) as ei:
        await _call(raise_on_error=True)
    assert ei.value.reason in ("parse_error", "empty_response")


async def test_json_mode_failure_then_text_mode_success(monkeypatch):
    calls = []

    async def flaky(**kw):
        calls.append("response_format" in kw)
        if "response_format" in kw:
            raise RuntimeError("json mode unsupported")
        return _resp('{"ok": true}')

    _patch(monkeypatch, flaky)
    assert await _call(raise_on_error=True) == {"ok": True}
    assert calls == [True, False]


async def test_extract_lead_marks_failure_instead_of_dropping(monkeypatch):
    async def boom(**_):
        raise RuntimeError("provider down")

    _patch(monkeypatch, boom)
    lead = await llm.extract_lead_from_page("Acme builds rockets", "https://acme.test", {}, {"contact_email": "a@acme.test"})
    assert lead["enrichment_failed"] is True
    assert lead["enrichment_failure_code"] == "provider_error"
    assert "AI provider" in lead["enrichment_failure_reason"]
    assert lead["source_url"] == "https://acme.test"
    assert lead["contact_email"] == "a@acme.test"  # deterministic data is kept


async def test_extract_leads_from_pages_keeps_failed_lead_with_title(monkeypatch):
    async def boom(**_):
        raise RuntimeError("down")

    _patch(monkeypatch, boom)
    leads = await llm.extract_leads_from_pages(
        [{"url": "https://acme.test", "text": "Acme\nrockets", "title": "Acme Inc", "structured_data": {}}], {}
    )
    assert len(leads) == 1
    assert leads[0]["company_name"] == "Acme Inc" and leads[0]["enrichment_failed"]


async def test_extract_lead_success_has_no_failure_marker(monkeypatch):
    async def ok(**_):
        return _resp(json.dumps({"company_name": "Acme", "match_score": 80}))

    _patch(monkeypatch, ok)
    lead = await llm.extract_lead_from_page("Acme builds rockets", "https://acme.test", {})
    assert lead["company_name"] == "Acme" and not lead.get("enrichment_failed")


def test_describe_llm_failure_is_user_presentable():
    assert "empty" in llm.describe_llm_failure(LLMCompletionError("empty_response")).lower()
    assert llm.describe_llm_failure(ValueError("x"))
