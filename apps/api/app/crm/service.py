"""CRM connection storage and the push-to-CRM workflow (provider-agnostic, driven by a CrmConnector)."""
import os
from datetime import datetime
from typing import Callable, Optional

from app.core.logger import logger
from app.core.security_crypto import decrypt_secret, encrypt_secret
from app.crm.base import CrmConnector, CrmError
from app.crm.hubspot import HubSpotConnector
from app.crm.mapping import DEFAULT_MAPPING, build_company, build_contacts, lead_domain, validate_mapping
from app.db.growth_models import CrmConnection, CrmSync
from app.db.models import TABLES

PROVIDERS = ("hubspot",)


# -- connections ---------------------------------------------------------------------------------------------------

async def get_connection(scope_id: str, provider: str) -> Optional[dict]:
    return await TABLES["crm_connections"].get(scope_id=scope_id, provider=provider)


async def list_connections(scope_id: str) -> list[dict]:
    return await TABLES["crm_connections"].find(CrmConnection.scope_id == scope_id)


async def save_connection(scope_id: str, provider: str, *, access_token: str, refresh_token: Optional[str],
                          auth_type: str, info: dict) -> dict:
    fields = {
        "auth_type": auth_type, "token_enc": encrypt_secret(access_token),
        "refresh_enc": encrypt_secret(refresh_token) if refresh_token else None,
        "info": info, "status": "connected", "connected_at": datetime.utcnow(),
    }
    cid = await TABLES["crm_connections"].upsert({"scope_id": scope_id, "provider": provider}, fields)
    conn = await TABLES["crm_connections"].get(_id=cid)
    if not conn.get("mapping"):
        conn = await TABLES["crm_connections"].update(cid, {"mapping": DEFAULT_MAPPING})
    return conn


async def delete_connection(conn: dict) -> None:
    await TABLES["crm_sync"].delete_where(CrmSync.connection_id == conn["_id"])
    await TABLES["crm_connections"].delete(conn["_id"])


async def set_mapping(conn: dict, raw: dict) -> dict:
    cleaned = validate_mapping(raw)  # raises MappingError
    return await TABLES["crm_connections"].update(conn["_id"], {"mapping": cleaned})


def public_connection(conn: Optional[dict], provider: str) -> dict:
    if not conn:
        return {"provider": provider, "connected": False}
    return {
        "provider": provider, "connected": True, "auth_type": conn.get("auth_type"), "info": conn.get("info") or {},
        "connected_at": conn["connected_at"].isoformat() if conn.get("connected_at") else None,
        "mapping": conn.get("mapping") or DEFAULT_MAPPING,
    }


# -- connector factory (tests replace this) ---------------------------------------------------------------------------

def _hubspot_factory(conn: dict) -> CrmConnector:
    async def persist(access: str, refresh: Optional[str]):
        fields = {"token_enc": encrypt_secret(access)}
        if refresh:
            fields["refresh_enc"] = encrypt_secret(refresh)
        await TABLES["crm_connections"].update(conn["_id"], fields)

    return HubSpotConnector(
        decrypt_secret(conn.get("token_enc") or ""),
        refresh_token=decrypt_secret(conn.get("refresh_enc") or "") or None,
        client_id=os.getenv("HUBSPOT_CLIENT_ID", ""),
        client_secret=os.getenv("HUBSPOT_CLIENT_SECRET", ""),
        on_token_refresh=persist,
    )


CONNECTOR_FACTORIES: dict[str, Callable[[dict], CrmConnector]] = {"hubspot": _hubspot_factory}


def make_connector(conn: dict) -> CrmConnector:
    return CONNECTOR_FACTORIES[conn["provider"]](conn)


# -- pushing leads ------------------------------------------------------------------------------------------------------

async def sync_rows(conn_id: str, lead_ids: Optional[list[str]] = None) -> dict[str, dict]:
    conds = [CrmSync.connection_id == conn_id]
    if lead_ids is not None:
        conds.append(CrmSync.lead_id.in_(lead_ids))
    return {r["lead_id"]: r for r in await TABLES["crm_sync"].find(*conds)}


async def _record(conn_id: str, lead_id: str, fields: dict, attempts: int) -> None:
    await TABLES["crm_sync"].upsert(
        {"connection_id": conn_id, "lead_id": lead_id},
        {**fields, "attempts": attempts, "last_attempt_at": datetime.utcnow()},
    )


IN_PROGRESS = ("queued", "syncing")


async def mark_queued(conn_id: str, lead_ids: list[str], *, only_failed: bool = False) -> None:
    """Show leads as waiting for a background push. With only_failed, already-synced leads keep their status."""
    existing = await sync_rows(conn_id, lead_ids)
    for lid in lead_ids:
        prev = existing.get(lid)
        if only_failed and prev and prev.get("status") == "synced":
            continue
        await TABLES["crm_sync"].upsert({"connection_id": conn_id, "lead_id": lid}, {"status": "queued", "error": None})


async def fail_unfinished(conn_id: Optional[str], lead_ids: list[str], message: str) -> None:
    """Turn any lead still queued/syncing into a retryable failure (a push that died or skipped it)."""
    if not conn_id:
        return
    for lid, row in (await sync_rows(conn_id, lead_ids)).items():
        if row.get("status") in IN_PROGRESS:
            await TABLES["crm_sync"].upsert(
                {"connection_id": conn_id, "lead_id": lid},
                {"status": "failed", "error": message, "retryable": True, "last_attempt_at": datetime.utcnow()},
            )


async def push_leads(conn: dict, connector: CrmConnector, leads: list[dict], dms_by_lead: dict[str, list[dict]],
                     *, only_failed: bool = False) -> dict:
    """Upsert each lead's company (and contacts) in the CRM. One lead failing never stops the batch.

    Companies are cached per domain within the run so leads sharing a domain create/update a single CRM company.
    """
    mapping = conn.get("mapping") or DEFAULT_MAPPING
    existing = await sync_rows(conn["_id"], [x["_id"] for x in leads])
    company_by_domain: dict[str, str] = {}
    results = []
    for lead in leads:
        lid = lead["_id"]
        prev = existing.get(lid)
        if only_failed and prev and prev.get("status") == "synced":
            results.append({"lead_id": lid, "status": "skipped"})
            continue
        attempts = (prev.get("attempts", 0) if prev else 0) + 1
        await TABLES["crm_sync"].upsert({"connection_id": conn["_id"], "lead_id": lid}, {"status": "syncing"})
        domain = lead_domain(lead)
        company_props = build_company(lead, mapping)
        if not company_props:
            await _record(conn["_id"], lid, {"status": "failed", "error": "Lead has no website domain", "retryable": False}, attempts)
            results.append({"lead_id": lid, "status": "failed", "error": "Lead has no website domain"})
            continue
        try:
            if domain not in company_by_domain:
                company = await connector.upsert_company(company_props)
                company_by_domain[domain] = company.id
            company_id = company_by_domain[domain]
            contact_ids = []
            for props in build_contacts(lead, dms_by_lead.get(lid, []), mapping):
                contact_ids.append((await connector.upsert_contact(props, company_id)).id)
            await _record(conn["_id"], lid, {"status": "synced", "company_id": company_id, "contact_ids": contact_ids,
                                             "error": None, "retryable": False}, attempts)
            results.append({"lead_id": lid, "status": "synced", "company_id": company_id, "contacts": len(contact_ids)})
        except CrmError as exc:
            logger.warning("CRM sync failed for lead %s: %s", lid, exc.message)
            await _record(conn["_id"], lid, {"status": "failed", "error": exc.message, "retryable": exc.retryable}, attempts)
            results.append({"lead_id": lid, "status": "failed", "error": exc.message, "retryable": exc.retryable})
    summary = {s: sum(1 for r in results if r["status"] == s) for s in ("synced", "failed", "skipped")}
    return {"summary": summary, "results": results}
