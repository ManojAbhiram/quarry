"""Paid verification providers, bring-your-own-key.

Each provider maps its own vocabulary onto Quarry's four statuses. All HTTP goes through `http_client()`, so tests
replace it with a client on an httpx.MockTransport and never touch the network. Keys are never logged.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import httpx

from app.core.logger import logger

TIMEOUT = 15.0


def http_client() -> httpx.AsyncClient:
    """The client used for every provider call. Tests monkeypatch this."""
    return httpx.AsyncClient(timeout=TIMEOUT)


@dataclass
class ProviderResult:
    status: str  # verified | likely | risky | invalid
    reason: str
    catch_all: bool | None = None


class ProviderError(Exception):
    """The provider could not give an answer (bad key, quota, network). The caller falls back to local checks."""


class Provider(ABC):
    name: str = ""
    label: str = ""

    def __init__(self, api_key: str):
        self.api_key = api_key

    @abstractmethod
    async def verify(self, email: str) -> ProviderResult: ...

    async def _get_json(self, url: str, params: dict) -> dict:
        try:
            async with http_client() as client:
                resp = await client.get(url, params=params)
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.label} request failed: {type(exc).__name__}") from exc
        if resp.status_code in (401, 403):
            raise ProviderError(f"{self.label} rejected the API key")
        if resp.status_code == 429:
            raise ProviderError(f"{self.label} rate limit reached")
        if resp.status_code >= 400:
            raise ProviderError(f"{self.label} returned HTTP {resp.status_code}")
        try:
            return resp.json()
        except ValueError as exc:
            raise ProviderError(f"{self.label} returned an unreadable response") from exc


class MillionVerifier(Provider):
    name = "millionverifier"
    label = "MillionVerifier"
    url = "https://api.millionverifier.com/api/v3/"

    async def verify(self, email: str) -> ProviderResult:
        data = await self._get_json(self.url, {"api": self.api_key, "email": email})
        if data.get("error"):
            raise ProviderError(f"{self.label}: {data['error']}")
        result = str(data.get("result") or "").lower()
        sub = str(data.get("subresult") or "")
        if result == "ok":
            return ProviderResult("verified", "MillionVerifier: mailbox is valid", catch_all=False)
        if result == "catch_all":
            return ProviderResult("risky", "MillionVerifier: domain accepts all mail (catch-all)", catch_all=True)
        if result in ("invalid", "disposable"):
            return ProviderResult("invalid", f"MillionVerifier: {result}" + (f" ({sub})" if sub else ""))
        return ProviderResult("risky", f"MillionVerifier: {result or 'unknown'}")


class ZeroBounce(Provider):
    name = "zerobounce"
    label = "ZeroBounce"
    url = "https://api.zerobounce.net/v2/validate"

    async def verify(self, email: str) -> ProviderResult:
        data = await self._get_json(self.url, {"api_key": self.api_key, "email": email, "ip_address": ""})
        if data.get("error"):
            raise ProviderError(f"{self.label}: {data['error']}")
        status = str(data.get("status") or "").lower()
        sub = str(data.get("sub_status") or "")
        if status == "valid":
            return ProviderResult("verified", "ZeroBounce: mailbox is valid", catch_all=False)
        if status == "catch-all":
            return ProviderResult("risky", "ZeroBounce: domain accepts all mail (catch-all)", catch_all=True)
        if status in ("invalid", "spamtrap", "abuse", "do_not_mail"):
            return ProviderResult("invalid", f"ZeroBounce: {status}" + (f" ({sub})" if sub else ""))
        return ProviderResult("risky", f"ZeroBounce: {status or 'unknown'}")


class NeverBounce(Provider):
    name = "neverbounce"
    label = "NeverBounce"
    url = "https://api.neverbounce.com/v4/single/check"

    async def verify(self, email: str) -> ProviderResult:
        data = await self._get_json(self.url, {"key": self.api_key, "email": email})
        if str(data.get("status")) != "success":
            raise ProviderError(f"{self.label}: {data.get('message') or 'request failed'}")
        result = str(data.get("result") or "").lower()
        if result == "valid":
            return ProviderResult("verified", "NeverBounce: mailbox is valid", catch_all=False)
        if result == "catchall":
            return ProviderResult("risky", "NeverBounce: domain accepts all mail (catch-all)", catch_all=True)
        if result in ("invalid", "disposable"):
            return ProviderResult("invalid", f"NeverBounce: {result}")
        return ProviderResult("risky", f"NeverBounce: {result or 'unknown'}")


PROVIDERS: dict[str, type[Provider]] = {p.name: p for p in (MillionVerifier, ZeroBounce, NeverBounce)}


def get_provider(name: str | None, api_key: str | None) -> Provider | None:
    cls = PROVIDERS.get((name or "").lower())
    if cls is None or not api_key:
        if name and name.lower() not in PROVIDERS:
            logger.warning("Unknown email verification provider %r ignored", name)
        return None
    return cls(api_key)
