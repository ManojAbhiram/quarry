"""The scraper must never fetch loopback, private, link-local or metadata addresses.

Network-free: hostnames are resolved through a patched ``socket.getaddrinfo``, and
HTTP goes through patched transports, so a failure here means a request was about
to leave the machine (or, for the Playwright hook, a navigation was allowed).
"""

import socket
import types

import httpx
import pytest

from app.core import url_guard
from app.core.url_guard import UnsafeURLError, check_url

PUBLIC_IP = "93.184.216.34"


def fake_dns(mapping):
    """Patch for socket.getaddrinfo: host -> ip or list of ips. Literals resolve to themselves."""

    def _getaddrinfo(host, port, *args, **kwargs):
        ips = mapping.get(host, host)  # a literal IP resolves to itself
        ips = [ips] if isinstance(ips, str) else ips
        return [
            (socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port or 0))
            for ip in ips
        ]

    return _getaddrinfo


BLOCKED_URLS = [
    "http://127.0.0.1/",
    "http://127.0.0.1:8000/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://192.168.0.10/",
    "http://0.0.0.0/",
    "http://100.64.0.1/",  # carrier-grade NAT, not globally routable
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",  # IPv4-mapped IPv6 loopback
    "http://[fd00::1]/",  # unique local address
    "file:///etc/passwd",
    "ftp://example.com/",
    "gopher://127.0.0.1/",
    "http:///no-host",
]


@pytest.mark.parametrize("url", BLOCKED_URLS)
def test_check_url_blocks_private_and_non_http_targets(url):
    with pytest.raises(UnsafeURLError):
        check_url(url)


def test_check_url_blocks_a_hostname_that_resolves_to_a_private_address(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"internal.example": "10.0.0.7"}))
    with pytest.raises(UnsafeURLError):
        check_url("https://internal.example/")


def test_check_url_blocks_when_any_resolved_address_is_private(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"mixed.example": [PUBLIC_IP, "127.0.0.1"]}))
    with pytest.raises(UnsafeURLError):
        check_url("https://mixed.example/")


def test_check_url_blocks_a_hostname_that_does_not_resolve(monkeypatch):
    def boom(*args, **kwargs):
        raise socket.gaierror("no such host")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    with pytest.raises(UnsafeURLError):
        check_url("https://nowhere.example/")


def test_check_url_allows_a_public_address(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    check_url("https://public.example/page")


async def test_httpx_guard_blocks_a_redirect_to_the_metadata_address(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    seen = []

    def handler(request):
        seen.append(str(request.url))
        if request.url.host == "public.example":
            return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})
        return httpx.Response(200, text="SECRET")

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handler),
        follow_redirects=True,
        event_hooks={"request": [url_guard.httpx_request_guard]},
    ) as client:
        with pytest.raises(UnsafeURLError):
            await client.get("https://public.example/")
    assert seen == ["https://public.example/"]


class FakeResponse:
    def __init__(self, status_code, headers=None):
        self.status_code = status_code
        self.headers = headers or {}


def test_safe_get_refuses_a_private_url_before_any_request(monkeypatch):
    calls = []
    monkeypatch.setattr(url_guard.requests, "get", lambda *a, **k: calls.append(a) or FakeResponse(200))
    with pytest.raises(UnsafeURLError):
        url_guard.safe_get("http://127.0.0.1:8000/")
    assert calls == []


def test_safe_get_blocks_a_redirect_to_a_private_address(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        return FakeResponse(302, {"location": "http://10.0.0.1/secret"})

    monkeypatch.setattr(url_guard.requests, "get", fake_get)
    with pytest.raises(UnsafeURLError):
        url_guard.safe_get("https://public.example/")
    assert calls == ["https://public.example/"]


def test_safe_get_follows_a_safe_relative_redirect(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    calls = []

    def fake_get(url, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            return FakeResponse(301, {"location": "/next"})
        return FakeResponse(200)

    monkeypatch.setattr(url_guard.requests, "get", fake_get)
    resp = url_guard.safe_get("https://public.example/start")
    assert resp.status_code == 200
    assert calls == ["https://public.example/start", "https://public.example/next"]


def test_safe_get_stops_a_redirect_loop(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    monkeypatch.setattr(
        url_guard.requests, "get", lambda url, **k: FakeResponse(302, {"location": "https://public.example/again"})
    )
    with pytest.raises(url_guard.requests.TooManyRedirects):
        url_guard.safe_get("https://public.example/")


class FakeRoute:
    def __init__(self, url):
        self.request = types.SimpleNamespace(url=url)
        self.aborted = False
        self.continued = False

    async def abort(self):
        self.aborted = True

    async def continue_(self):
        self.continued = True


async def test_playwright_route_aborts_a_private_navigation():
    route = FakeRoute("http://169.254.169.254/latest/meta-data/")
    await url_guard.playwright_route_guard(route)
    assert route.aborted and not route.continued


async def test_playwright_route_continues_a_public_request(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    route = FakeRoute("https://public.example/app.js")
    await url_guard.playwright_route_guard(route)
    assert route.continued and not route.aborted


# --- the scraper itself must use the guard on every fetch path -------------------


def test_scrape_url_makes_no_request_to_a_private_address(monkeypatch):
    from app.services import scraper

    calls = []

    def no_network(*args, **kwargs):
        calls.append(args)
        raise AssertionError("network call to a private address")

    monkeypatch.setattr("requests.get", no_network)
    assert scraper.scrape_url("http://127.0.0.1:9/") == ""
    assert calls == []


def test_scrape_directory_links_makes_no_request_to_a_private_address(monkeypatch):
    from app.services import scraper

    calls = []

    def no_network(*args, **kwargs):
        calls.append(args)
        raise AssertionError("network call to a private address")

    monkeypatch.setattr("requests.get", no_network)
    assert scraper.scrape_directory_links("http://169.254.169.254/") == []
    assert calls == []


async def test_scrape_url_with_discovery_makes_no_request_to_a_private_address(monkeypatch):
    from app.services import scraper

    attempts = []

    async def fake_transport(self, request):
        attempts.append(str(request.url))
        return httpx.Response(200, text="<html><body>internal secret</body></html>", headers={"content-type": "text/html"})

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", fake_transport)
    assert await scraper.scrape_url_with_discovery("http://169.254.169.254/latest/meta-data/") == ("", {})
    assert attempts == []


async def test_scrape_url_with_discovery_does_not_follow_a_redirect_to_a_private_address(monkeypatch):
    from app.services import scraper

    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    attempts = []

    async def fake_transport(self, request):
        attempts.append(str(request.url))
        if request.url.host == "public.example":
            return httpx.Response(302, headers={"location": "http://127.0.0.1:8000/admin"})
        return httpx.Response(200, text="<html><body>internal secret</body></html>", headers={"content-type": "text/html"})

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", fake_transport)
    assert await scraper.scrape_url_with_discovery("https://public.example/") == ("", {})
    assert attempts == ["https://public.example/"]
