"""Outbound fetches outside the scraper must also refuse private/metadata targets.

Network-free: DNS is patched and the httpx transport is replaced, so ``attempts``
records every request that would have left the machine.
"""

import socket

import httpx
import pytest

from tests.test_url_guard import PUBLIC_IP, fake_dns

METADATA = "http://169.254.169.254/latest/meta-data/"


@pytest.fixture
def transport(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    attempts: list[str] = []

    async def fake_transport(self, request):
        attempts.append(str(request.url))
        if request.url.host == "public.example":
            return httpx.Response(302, headers={"location": METADATA})
        return httpx.Response(200, text="<dl><dt>Website</dt><dd>SECRET</dd></dl>")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", fake_transport)
    return attempts


async def _enrichment(url):
    from app.services import company_enrichment

    return await company_enrichment._scrape_linkedin_company_page("Acme", url)


async def _similarity(url, monkeypatch):
    from app.services import product_similarity

    async def fake_serper(query):
        return {"organic": [{"link": url}]}

    monkeypatch.setattr(product_similarity, "fetch_leads_from_serper", fake_serper)
    return await product_similarity.fetch_linkedin_company_info("Acme")


async def test_enrichment_linkedin_scrape_refuses_a_metadata_url(transport):
    await _enrichment(METADATA + "?x=linkedin.com/company/acme")
    assert transport == []


async def test_enrichment_linkedin_scrape_does_not_follow_a_redirect_to_metadata(transport):
    await _enrichment("https://public.example/linkedin.com/company/acme")
    assert transport == ["https://public.example/linkedin.com/company/acme"]


async def test_similarity_linkedin_scrape_refuses_a_metadata_url(transport, monkeypatch):
    await _similarity(METADATA + "?x=linkedin.com/company/acme", monkeypatch)
    assert transport == []


async def test_similarity_linkedin_scrape_does_not_follow_a_redirect_to_metadata(transport, monkeypatch):
    await _similarity("https://public.example/linkedin.com/company/acme", monkeypatch)
    assert transport == ["https://public.example/linkedin.com/company/acme"]
