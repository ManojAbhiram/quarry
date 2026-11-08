"""Refuse to fetch addresses the scraper has no business reaching (SSRF guard).

Scraped URLs come from search results and crawled pages, so an attacker can point them
at ``127.0.0.1``, a private network or the cloud metadata address (169.254.169.254).
Every fetch path goes through one of these helpers:

* ``check_url``               validates one URL (scheme, and that every resolved address is public)
* ``httpx_request_guard``     httpx request hook; httpx calls it for every hop, redirects included
* ``safe_get``                ``requests.get`` that checks each redirect hop itself
* ``playwright_route_guard``  Playwright route handler covering navigation, redirects and subresources

Known limit: the address is checked, then the HTTP client resolves the name again. A DNS
server that answers differently the second time (DNS rebinding) could slip past. Closing
that needs connecting to the checked IP directly.
"""

import asyncio
import ipaddress
import logging
import socket
from urllib.parse import urljoin, urlparse

import httpx
import requests

logger = logging.getLogger(__name__)

_ALLOWED_SCHEMES = {"http", "https"}
_REDIRECT_CODES = {301, 302, 303, 307, 308}
_MAX_REDIRECTS = 5


class UnsafeURLError(ValueError):
    """The URL points somewhere the scraper must not fetch."""


def _is_public(ip: str) -> bool:
    address = ipaddress.ip_address(ip.split("%")[0])
    if address.version == 6 and address.ipv4_mapped:
        address = address.ipv4_mapped
    return address.is_global and not address.is_multicast


def check_url(url: str) -> None:
    """Raise UnsafeURLError unless ``url`` is http(s) and every address it resolves to is public."""
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise UnsafeURLError(f"scheme not allowed: {parsed.scheme or 'none'}")
    host = parsed.hostname
    if not host:
        raise UnsafeURLError("URL has no host")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, ValueError) as exc:
        raise UnsafeURLError(f"cannot resolve {host}: {exc}") from exc
    for info in infos:
        ip = info[4][0]
        if not _is_public(ip):
            raise UnsafeURLError(f"{host} resolves to a non-public address ({ip})")


async def httpx_request_guard(request: httpx.Request) -> None:
    """httpx ``request`` event hook. Runs before every request, including each redirect hop."""
    await asyncio.to_thread(check_url, str(request.url))


def safe_get(url: str, **kwargs) -> requests.Response:
    """``requests.get`` that validates the URL and every redirect hop before connecting."""
    kwargs.pop("allow_redirects", None)
    current = url
    for _ in range(_MAX_REDIRECTS + 1):
        check_url(current)
        response = requests.get(current, allow_redirects=False, **kwargs)
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
