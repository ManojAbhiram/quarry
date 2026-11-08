"""DNS pinning for httpx: the connection goes to the address the guard checked, never to a
second lookup of the same name (DNS rebinding). Network-free: DNS and the inner network
backend are fakes."""

import socket

import httpcore
import httpx
import pytest

from app.core import url_guard
from app.core.url_guard import GuardedAsyncClient, UnsafeURLError

PUBLIC_IP = "93.184.216.34"


def fake_dns(mapping):
    def _getaddrinfo(host, port, *args, **kwargs):
        ips = mapping.get(host, host)  # a literal IP resolves to itself
        ips = [ips] if isinstance(ips, str) else ips
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port or 0)) for ip in ips]

    return _getaddrinfo


class FakeInner(httpcore.AsyncNetworkBackend):
    def __init__(self, unreachable=()):
        self.connects = []
        self.unreachable = set(unreachable)

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        self.connects.append((host, port))
        if host in self.unreachable:
            raise httpcore.ConnectError("unreachable")
        return "stream"

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        return "stream"

    async def sleep(self, seconds):
        return None


async def test_backend_connects_to_the_checked_ip_even_if_dns_changes(monkeypatch):
    lookups = []

    def rebinding_dns(host, port, *args, **kwargs):
        lookups.append(host)
        ip = PUBLIC_IP if len(lookups) == 1 else "127.0.0.1"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    monkeypatch.setattr(socket, "getaddrinfo", rebinding_dns)
    inner = FakeInner()
    stream = await url_guard._PinnedBackend(inner).connect_tcp("rebind.example", 443)
    assert stream == "stream"
    assert inner.connects == [(PUBLIC_IP, 443)]
    assert lookups == ["rebind.example"]  # resolved once


async def test_backend_refuses_a_private_address_without_connecting(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"internal.example": "10.0.0.7"}))
    inner = FakeInner()
    with pytest.raises(UnsafeURLError):
        await url_guard._PinnedBackend(inner).connect_tcp("internal.example", 80)
    assert inner.connects == []


async def test_backend_tries_the_next_address_when_one_is_unreachable(monkeypatch):
    second = "93.184.216.35"
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"dual.example": [PUBLIC_IP, second]}))
    inner = FakeInner(unreachable=[PUBLIC_IP])
    assert await url_guard._PinnedBackend(inner).connect_tcp("dual.example", 80) == "stream"
    assert inner.connects == [(PUBLIC_IP, 80), (second, 80)]


async def test_backend_raises_the_last_error_when_no_address_is_reachable(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"down.example": [PUBLIC_IP]}))
    inner = FakeInner(unreachable=[PUBLIC_IP])
    with pytest.raises(httpcore.ConnectError):
        await url_guard._PinnedBackend(inner).connect_tcp("down.example", 80)


async def test_backend_refuses_unix_sockets():
    with pytest.raises(UnsafeURLError):
        await url_guard._PinnedBackend(FakeInner()).connect_unix_socket("/var/run/docker.sock")


async def test_guarded_client_pins_the_transport_and_keeps_transport_options():
    async with GuardedAsyncClient(limits=httpx.Limits(max_connections=7)) as client:
        pool = client._transport._pool
        assert isinstance(pool._network_backend, url_guard._PinnedBackend)
        assert pool._max_connections == 7


async def test_guarded_client_passes_other_client_options_through():
    async with GuardedAsyncClient(headers={"x-test": "1"}, follow_redirects=True, timeout=5) as client:
        assert client.headers["x-test"] == "1"
        assert client.follow_redirects is True
        assert client.timeout == httpx.Timeout(5)


async def test_guarded_client_checks_every_request_and_keeps_caller_hooks(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"public.example": PUBLIC_IP}))
    attempts, seen = [], []

    async def fake_transport(self, request):
        attempts.append(str(request.url))
        return httpx.Response(200, text="ok")

    async def caller_hook(request):
        seen.append(str(request.url))

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", fake_transport)
    async with GuardedAsyncClient(event_hooks={"request": [caller_hook]}) as client:
        with pytest.raises(UnsafeURLError):
            await client.get("http://169.254.169.254/latest/meta-data/")
        assert attempts == [] and seen == []
        assert (await client.get("http://public.example/")).status_code == 200
    assert attempts == ["http://public.example/"]
    assert seen == ["http://public.example/"]
