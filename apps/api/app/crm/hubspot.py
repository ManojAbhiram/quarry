"""HubSpot connector (CRM v3 REST) using a private-app token or an OAuth access token.

Dedupe: companies by `domain`, contacts by `email` (search first, then PATCH or POST). Transient failures (429, 5xx,
network) are retried with backoff; a 401 triggers one OAuth refresh when a refresh token is available.
"""
import asyncio
from typing import Awaitable, Callable, Optional

import httpx

from app.crm.base import CrmConnector, CrmError, UpsertResult

API = "https://api.hubapi.com"
TOKEN_URL = f"{API}/oauth/v1/token"
AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize"
OAUTH_SCOPES = "crm.objects.companies.read crm.objects.companies.write crm.objects.contacts.read crm.objects.contacts.write"


class HubSpotConnector(CrmConnector):
    provider = "hubspot"

    def __init__(
        self,
        access_token: str,
        *,
        refresh_token: Optional[str] = None,
        client_id: str = "",
        client_secret: str = "",
        on_token_refresh: Optional[Callable[[str, Optional[str]], Awaitable[None]]] = None,
        client: Optional[httpx.AsyncClient] = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        max_attempts: int = 4,
    ):
        self.access_token = access_token
        self.refresh_token = refresh_token
        self.client_id = client_id
        self.client_secret = client_secret
        self.on_token_refresh = on_token_refresh
        self._client = client or httpx.AsyncClient(timeout=20)
        self._sleep = sleep
        self.max_attempts = max_attempts

    async def aclose(self):
        await self._client.aclose()

    # -- transport ---------------------------------------------------------------------------------------------
    async def _refresh(self) -> bool:
        if not (self.refresh_token and self.client_id and self.client_secret):
            return False
        res = await self._client.post(
            TOKEN_URL,
            data={"grant_type": "refresh_token", "client_id": self.client_id, "client_secret": self.client_secret,
                  "refresh_token": self.refresh_token},
        )
        if res.status_code != 200:
            return False
        body = res.json()
        self.access_token = body["access_token"]
        self.refresh_token = body.get("refresh_token", self.refresh_token)
        if self.on_token_refresh:
            await self.on_token_refresh(self.access_token, self.refresh_token)
        return True

    async def _request(self, method: str, path: str, json: Optional[dict] = None) -> httpx.Response:
        refreshed = False
        last = "unknown error"
        for attempt in range(1, self.max_attempts + 1):
            try:
                res = await self._client.request(
                    method, f"{API}{path}", json=json, headers={"Authorization": f"Bearer {self.access_token}"}
                )
            except httpx.HTTPError as exc:
                last = f"network error: {exc.__class__.__name__}"
                res = None
            if res is not None:
                if res.status_code == 401 and not refreshed:
                    refreshed = True
                    if await self._refresh():
                        continue
                if res.status_code < 400:
                    return res
                if res.status_code == 429 or res.status_code >= 500:
                    last = f"HubSpot returned {res.status_code}"
                    retry_after = res.headers.get("retry-after")
                    delay = float(retry_after) if retry_after and retry_after.replace(".", "").isdigit() else 2 ** (attempt - 1) * 0.5
                    if attempt < self.max_attempts:
                        await self._sleep(min(delay, 30))
                    continue
                if res.status_code in (401, 403):
                    raise CrmError("HubSpot rejected the credentials. Reconnect the integration.", status=res.status_code)
                raise CrmError(self._detail(res), status=res.status_code)
            if attempt < self.max_attempts:
                await self._sleep(2 ** (attempt - 1) * 0.5)
        raise CrmError(f"HubSpot is unavailable ({last}); try again shortly", retryable=True)

    @staticmethod
    def _detail(res: httpx.Response) -> str:
        try:
            msg = res.json().get("message")
        except ValueError:
            msg = None
        return f"HubSpot error {res.status_code}: {msg or res.text[:200]}"

    # -- connector API -----------------------------------------------------------------------------------------
    async def test_connection(self) -> dict:
        res = await self._request("GET", "/account-info/v3/details")
        body = res.json()
        return {"portal_id": body.get("portalId"), "account_type": body.get("accountType")}

    async def _find(self, obj: str, prop: str, value: str) -> Optional[str]:
        res = await self._request(
            "POST", f"/crm/v3/objects/{obj}/search",
            json={"filterGroups": [{"filters": [{"propertyName": prop, "operator": "EQ", "value": value}]}],
                  "limit": 1, "properties": [prop]},
        )
        results = res.json().get("results") or []
        return results[0]["id"] if results else None

    async def _upsert(self, obj: str, key: str, properties: dict) -> UpsertResult:
        value = properties.get(key)
        if not value:
            raise CrmError(f"Missing required property '{key}'")
        existing = await self._find(obj, key, value)
        if existing:
            await self._request("PATCH", f"/crm/v3/objects/{obj}/{existing}", json={"properties": properties})
            return UpsertResult(existing, created=False)
        try:
            res = await self._request("POST", f"/crm/v3/objects/{obj}", json={"properties": properties})
        except CrmError as exc:
            if exc.status != 409:
                raise
            # Lost a race with another writer (or search lag): find the record and update it instead.
            existing = await self._find(obj, key, value)
            if not existing:
                raise
            await self._request("PATCH", f"/crm/v3/objects/{obj}/{existing}", json={"properties": properties})
            return UpsertResult(existing, created=False)
        return UpsertResult(res.json()["id"], created=True)

    async def upsert_company(self, properties: dict) -> UpsertResult:
        return await self._upsert("companies", "domain", properties)

    async def upsert_contact(self, properties: dict, company_id: Optional[str] = None) -> UpsertResult:
        result = await self._upsert("contacts", "email", properties)
        if company_id:
            await self._request(
                "PUT", f"/crm/v4/objects/contacts/{result.id}/associations/default/companies/{company_id}"
            )
        return result
