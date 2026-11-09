"""Enrichment providers behind one interface, plus the HTTP port they share (fake it in tests)."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx

PROVIDER_ORDER = ("scrape", "hunter", "snov", "pdl")


@dataclass
class Person:
    name: str = ""
    domain: str = ""
    company: str = ""
    linkedin_url: str = ""
    known_email: str = ""

    @property
    def first(self) -> str:
        return self.name.strip().split(" ")[0] if self.name.strip() else ""

    @property
    def last(self) -> str:
        parts = self.name.strip().split(" ")
        return " ".join(parts[1:]) if len(parts) > 1 else ""


@dataclass
class Found:
    email: str
    confidence: float = 0.0


class HttpClient(Protocol):
    async def get_json(self, url: str, params: dict | None = None, headers: dict | None = None) -> tuple[int, dict]: ...

    async def post_json(self, url: str, body: dict, headers: dict | None = None) -> tuple[int, dict]: ...


class RealHttp:
    async def get_json(self, url, params=None, headers=None):
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url, params=params, headers=headers)
            return r.status_code, _json(r)

    async def post_json(self, url, body, headers=None):
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(url, json=body, headers=headers)
            return r.status_code, _json(r)


def _json(r: httpx.Response) -> dict:
    try:
        data = r.json()
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


class Ports:
    http: HttpClient = RealHttp()


ports = Ports()


class Provider(Protocol):
    name: str
    credits: int  # platform credits debited per successful lookup (0 when the user brings their own key)
    needs_key: bool

    async def find_email(self, person: Person, api_key: str) -> Found | None: ...


class ScrapeProvider:
    """The app's existing scraping pipeline already ran; reuse whatever email it found. Free, no key."""

    name, credits, needs_key = "scrape", 0, False

    async def find_email(self, person: Person, api_key: str) -> Found | None:
        return Found(person.known_email, 0.5) if "@" in (person.known_email or "") else None


class HunterProvider:
    name, credits, needs_key = "hunter", 1, True

    async def find_email(self, person: Person, api_key: str) -> Found | None:
        if not (person.domain and person.first):
            return None
        status, data = await ports.http.get_json("https://api.hunter.io/v2/email-finder", {
            "domain": person.domain, "first_name": person.first, "last_name": person.last, "api_key": api_key})
        d = data.get("data") or {}
        if status == 200 and d.get("email"):
            return Found(d["email"], float(d.get("score") or 0) / 100)
        if status in (401, 403, 429):
            raise RuntimeError(f"hunter HTTP {status}")
        return None


class SnovProvider:
    """`api_key` is 'client_id:client_secret'."""

    name, credits, needs_key = "snov", 1, True

    async def find_email(self, person: Person, api_key: str) -> Found | None:
        if not (person.domain and person.first) or ":" not in api_key:
            return None
        cid, _, secret = api_key.partition(":")
        status, tok = await ports.http.post_json("https://api.snov.io/v1/oauth/access_token", {
            "grant_type": "client_credentials", "client_id": cid, "client_secret": secret})
        if status != 200 or not tok.get("access_token"):
            raise RuntimeError(f"snov auth HTTP {status}")
        status, data = await ports.http.post_json("https://api.snov.io/v1/get-emails-from-names", {
            "first_name": person.first, "last_name": person.last, "domain": person.domain},
            {"Authorization": f"Bearer {tok['access_token']}"})
        emails = ((data.get("data") or {}).get("emails")) or []
        valid = [e for e in emails if e.get("email") and e.get("emailStatus", "valid") != "not_valid"]
        return Found(valid[0]["email"], 0.8) if status == 200 and valid else None


class PdlProvider:
    name, credits, needs_key = "pdl", 3, True

    async def find_email(self, person: Person, api_key: str) -> Found | None:
        if not (person.name and (person.domain or person.company)):
            return None
        params = {"name": person.name, "min_likelihood": 6}
        if person.domain:
            params["company"] = person.domain
        elif person.company:
            params["company"] = person.company
        status, data = await ports.http.get_json("https://api.peopledatalabs.com/v5/person/enrich", params,
                                                 {"X-Api-Key": api_key})
        d = data.get("data") or {}
        email = d.get("work_email") or next((e.get("address") for e in d.get("emails") or [] if e.get("address")), None)
        if status == 200 and email:
            return Found(email, float(data.get("likelihood") or 0) / 10)
        if status in (401, 402, 403, 429):
            raise RuntimeError(f"pdl HTTP {status}")
        return None


REGISTRY: dict[str, Provider] = {p.name: p for p in (ScrapeProvider(), HunterProvider(), SnovProvider(), PdlProvider())}
