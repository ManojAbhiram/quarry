"""tech_stack fetchers must never reach private, loopback or metadata addresses.

Network-free: DNS is patched and the httpx transport is replaced, so a non-empty
``attempts`` list means a request was about to leave the machine.
"""

import socket

import httpx
import pytest

from app.services import tech_stack

PUBLIC_IP = "93.184.216.34"
METADATA = "http://169.254.169.254/latest/meta-data/"


def fake_dns(mapping):
    def _getaddrinfo(host, port, *args, **kwargs):
        ip = mapping.get(host, host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port or 0))]

    return _getaddrinfo


@pytest.fixture
def transport(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP, "redirect.example": PUBLIC_IP}))
    attempts = []

    async def fake_transport(self, request):
        attempts.append(str(request.url))
        if request.url.host == "redirect.example":
            return httpx.Response(302, headers={"location": METADATA})
        return httpx.Response(200, text="<html>secret</html>", headers={"content-type": "text/html"})

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", fake_transport)

    async def no_sleep(_):
        return None

    monkeypatch.setattr(tech_stack.asyncio, "sleep", no_sleep)
    return attempts


async def test_detect_technologies_blocks_metadata_address(transport):
    assert await tech_stack.get_detector().detect_technologies(METADATA) == []
    assert transport == []


async def test_detect_technologies_blocks_redirect_to_metadata(transport):
    await tech_stack.get_detector().detect_technologies("https://redirect.example/")
    assert transport == ["https://redirect.example/"]


async def test_blocked_url_is_not_retried(transport):
    await tech_stack.get_detector().detect_technologies("http://127.0.0.1:8000/")
    assert transport == []


async def test_parallel_detection_blocks_metadata_and_redirect(transport):
    result = await tech_stack.detect_technology_stacks_parallel(
        [METADATA, "https://redirect.example/"]
    )
    assert transport == ["https://redirect.example/"]
    assert set(result) == {METADATA, "https://redirect.example/"}


async def test_backend_framework_detection_blocks_private_hosts(transport):
    await tech_stack.detect_backend_framework("http://169.254.169.254/")
    assert transport == []


async def test_backend_framework_detection_blocks_redirect(transport):
    await tech_stack.detect_backend_framework("https://redirect.example/")
    assert transport  # the public hop did happen
    assert not any("169.254.169.254" in u for u in transport)
