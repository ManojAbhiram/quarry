"""Refuse to fetch addresses the scraper has no business reaching (SSRF guard).

Scraped URLs come from search results and crawled pages, so an attacker can point them
at ``127.0.0.1``, a private network or the cloud metadata address (169.254.169.254).
Every fetch path goes through one of these helpers:

* ``GuardedAsyncClient``      httpx client: checks every request (redirect hops included) and
                              connects to the address it checked, so a name cannot resolve
                              differently a second time (DNS rebinding)
* ``safe_get``                ``requests.get`` that checks and pins each redirect hop itself
* ``playwright_route_guard``  Playwright route handler covering navigation, redirects and subresources
* ``resolve_public``          resolve a host and refuse non-public addresses (used by the SMTP probe)
* ``check_url``               validate one URL without connecting

Known limits: Playwright and its browser do their own DNS, so the route handler checks the
address but cannot pin it. A GuardedAsyncClient ignores environment proxy settings because it
supplies its own transport; behind a proxy the proxy resolves names.
"""

import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urljoin, urlparse, urlunparse

import httpcore
import httpx
import requests
from requests.adapters import HTTPAdapter

logger = logging.getLogger(__name__)

_ALLOWED_SCHEMES = {"http", "https"}
_REDIRECT_CODES = {301, 302, 303, 307, 308}
_MAX_REDIRECTS = 5
_TRANSPORT_OPTIONS = ("verify", "cert", "http1", "http2", "limits", "retries", "socket_options", "local_address", "uds")


class UnsafeURLError(ValueError):
    """The URL points somewhere the scraper must not fetch."""


def _is_public(ip: str) -> bool:
    address = ipaddress.ip_address(ip.split("%")[0])
    if address.version == 6 and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.is_global and not address.is_multicast


def resolve_public(host: str, port: int) -> list[str]:
    """Resolve ``host`` and return its addresses, raising UnsafeURLError if any is non-public.

    Callers that connect should connect to a returned address, not re-resolve the name.
    """
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, ValueError) as exc:
        raise UnsafeURLError(f"cannot resolve {host}: {exc}") from exc
    addresses: list[str] = []
    for info in infos:
        ip = info[4][0]
        if not _is_public(ip):
            raise UnsafeURLError(f"{host} resolves to a non-public address ({ip})")
        addresses.append(ip)
    return addresses


def _parse_target(url: str):
    """Return (parsed, host, port) for an http(s) URL, or raise UnsafeURLError."""
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise UnsafeURLError(f"scheme not allowed: {parsed.scheme or 'none'}")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no host")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise UnsafeURLError(f"bad port in URL: {exc}") from exc
    return parsed, host, port


def check_url(url: str) -> None:
    """Raise UnsafeURLError unless ``url`` is http(s) and every address it resolves to is public."""
    _, host, port = _parse_target(url)
    resolve_public(host, port)


async def httpx_request_guard(request: httpx.Request) -> None:
    """httpx ``request`` event hook. Runs before every request, including each redirect hop."""
    await asyncio.to_thread(check_url, str(request.url))


class _PinnedBackend(httpcore.AsyncNetworkBackend):
    """httpcore network backend: resolve, check, then connect to a checked address."""

    def __init__(self, inner: httpcore.AsyncNetworkBackend):
        self._inner = inner

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        addresses = await asyncio.to_thread(resolve_public, host, port)
        last_error: Exception | None = None
        for ip in addresses:  # fall back to the next address like a normal client would
            try:
                return await self._inner.connect_tcp(
                    ip, port, timeout=timeout, local_address=local_address, socket_options=socket_options
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                last_error = exc
        raise last_error  # type: ignore[misc]  # addresses is never empty

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise UnsafeURLError("unix sockets are not allowed")

    async def sleep(self, seconds):
        await self._inner.sleep(seconds)


class GuardedAsyncClient(httpx.AsyncClient):
    """``httpx.AsyncClient`` that refuses non-public targets and pins the address it checked.

    Takes the same arguments as ``httpx.AsyncClient``. Transport options (``limits``, ``verify``,
    ``http2``, ...) are applied to the guarded transport; caller event hooks run after the guard.
    """

    def __init__(self, **kwargs):
        transport_kwargs = {key: kwargs.pop(key) for key in _TRANSPORT_OPTIONS if key in kwargs}
        transport = httpx.AsyncHTTPTransport(**transport_kwargs)
        pool = transport._pool
        pool._network_backend = _PinnedBackend(pool._network_backend)
        hooks = {name: list(funcs) for name, funcs in (kwargs.pop("event_hooks", None) or {}).items()}
        hooks["request"] = [httpx_request_guard, *hooks.get("request", [])]
        super().__init__(transport=transport, event_hooks=hooks, **kwargs)


class _PinnedAdapter(HTTPAdapter):
    """requests adapter that connects to an IP URL but verifies TLS against the real hostname."""

    def __init__(self, server_hostname: str):
        self._server_hostname = server_hostname
        super().__init__()

    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        super().init_poolmanager(connections, maxsize, block=block, server_hostname=self._server_hostname, **pool_kwargs)


def _pinned_url(parsed, ip: str) -> str:
    host = f"[{ip}]" if ":" in ip else ip
    netloc = f"{host}:{parsed.port}" if parsed.port else host
    return urlunparse(parsed._replace(netloc=netloc))


def _get_once(url: str, headers: dict, kwargs: dict) -> requests.Response:
    parsed, host, port = _parse_target(url)
    addresses = resolve_public(host, port)
    request_headers = {**headers, "Host": parsed.netloc.rpartition("@")[2]}
    last_error: Exception | None = None
    for ip in addresses:  # fall back to the next address like a normal client would
        with requests.Session() as session:
            session.mount("https://", _PinnedAdapter(host))
            try:
                return session.get(_pinned_url(parsed, ip), allow_redirects=False, headers=request_headers, **kwargs)
            except requests.ConnectionError as exc:
                last_error = exc
    raise last_error  # type: ignore[misc]  # addresses is never empty


def safe_get(url: str, **kwargs) -> requests.Response:
    """``requests.get`` that validates each hop, then connects to the address it checked."""
    kwargs.pop("allow_redirects", None)
    headers = dict(kwargs.pop("headers", None) or {})
    current = url
    for _ in range(_MAX_REDIRECTS + 1):
        response = _get_once(current, headers, kwargs)
        location = response.headers.get("location")
        if response.status_code in _REDIRECT_CODES and location:
            current = urljoin(current, location)
            continue
        return response
    raise requests.TooManyRedirects(f"more than {_MAX_REDIRECTS} redirects from {url}")


async def playwright_route_guard(route) -> None:
    """Playwright route handler: abort any request that targets a non-public address."""
    try:
        await asyncio.to_thread(check_url, route.request.url)
    except UnsafeURLError as exc:
        logger.warning("Blocked browser request to %s: %s", route.request.url, exc)
        await route.abort()
        return
    await route.continue_()
