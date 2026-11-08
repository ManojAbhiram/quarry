"""careers_tech_stack must never fetch private or metadata addresses, directly or via redirect.

Network-free: DNS is patched and the httpx transport is patched, so any entry in
``attempts`` means a request was about to leave the machine.
"""

import socket

import httpx
import pytest

from app.services import careers_tech_stack as cts
from tests.test_url_guard import PUBLIC_IP, fake_dns

METADATA = "http://169.254.169.254/latest/meta-data/"
BODY = "<html><body>" + "internal secret " * 60 + '<a href="/jobs/1">Engineer role</a></body></html>'


@pytest.fixture
def attempts(monkeypatch):
    seen = []

    async def fake_transport(self, request):
        seen.append(str(request.url))
        if request.url.host == "public.example" and request.url.path.startswith("/redir"):
            return httpx.Response(302, headers={"location": METADATA})
        return httpx.Response(200, text=BODY, headers={"content-type": "text/html"})

    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", fake_transport)

    async def no_serper(query):
        return {}

    async def no_llm(*args, **kwargs):
        return {}

    monkeypatch.setattr(cts, "fetch_leads_from_serper", no_serper)
    monkeypatch.setattr(cts, "pick_official_careers_url", no_llm)
    monkeypatch.setattr(cts, "resolve_company_from_job_board_page", no_llm)
    return seen


def metadata_hits(seen):
    return [u for u in seen if "169.254.169.254" in u]


async def test_discover_careers_hub_never_fetches_a_metadata_address(attempts):
    await cts.discover_careers_hub("http://169.254.169.254/")
    assert attempts == []


async def test_collect_job_listings_never_fetches_a_metadata_address(attempts):
    assert await cts.collect_job_listings(METADATA, "169.254.169.254") == []
    assert attempts == []


async def test_collect_job_listings_does_not_follow_a_redirect_to_metadata(attempts):
    url = "https://public.example/redir"
    assert await cts.collect_job_listings(url, "public.example") == []
    assert attempts == [url]


async def test_fetch_job_descriptions_never_fetches_a_metadata_address(attempts):
    jobs = [{"title": "Engineer", "url": METADATA}]
    assert await cts.fetch_job_descriptions(jobs, METADATA, "169.254.169.254") == []
    assert attempts == []


async def test_fetch_job_descriptions_does_not_follow_a_redirect_to_metadata(attempts):
    url = "https://public.example/redir/job"
    jobs = [{"title": "Engineer", "url": url}]
    assert await cts.fetch_job_descriptions(jobs, "https://public.example/careers", "public.example") == []
    assert attempts == [url]


async def test_discover_careers_hub_does_not_follow_a_redirect_to_metadata(attempts):
    await cts.discover_careers_hub("https://public.example/redir")
    assert metadata_hits(attempts) == []
    # a blocked redirect is not retried: each public URL is requested once
    assert len(attempts) == len(set(attempts))


async def test_detect_careers_tech_stack_never_fetches_a_metadata_address(attempts):
    out = await cts.detect_careers_tech_stack("http://169.254.169.254/")
    assert attempts == []
    assert out["job_results"] == []


async def test_detect_careers_tech_stack_does_not_follow_a_redirect_to_metadata(attempts):
    await cts.detect_careers_tech_stack("https://public.example/redir")
    assert metadata_hits(attempts) == []
