"""Provider keys and the email enrichment waterfall."""
from __future__ import annotations

from app.core.security_crypto import decrypt_secret, encrypt_secret, mask_secret
from app.db.models import TABLES
from app.p3.config import p3_settings
from app.waterfall.providers import PROVIDER_ORDER, REGISTRY, Person

_keys = TABLES["provider_keys"]
_dms = TABLES["decision_makers"]
_leads = TABLES["leads"]


async def set_key(user_id: str, provider: str, key: str) -> dict:
    if provider not in REGISTRY or not REGISTRY[provider].needs_key:
        raise ValueError("unknown provider")
    await _keys.upsert({"user_id": user_id, "provider": provider}, {"key_enc": encrypt_secret(key.strip())})
    return {"provider": provider, "masked": mask_secret(key.strip())}


async def delete_key(user_id: str, provider: str) -> bool:
    doc = await _keys.get(user_id=user_id, provider=provider)
    return bool(doc and await _keys.delete(doc["_id"]))


async def list_keys(user_id: str) -> list[dict]:
    rows = {r["provider"]: r for r in await _keys.find(_keys.model.user_id == user_id)}
    return [{"provider": n,
             "byo_key": mask_secret(decrypt_secret(rows[n]["key_enc"])) if n in rows else None,
             "platform_key": bool(p3_settings.platform_key(n))}
            for n, p in REGISTRY.items() if p.needs_key]


async def _resolve_key(user_id: str, provider: str) -> str:
    row = await _keys.get(user_id=user_id, provider=provider)
    if row:
        key = decrypt_secret(row["key_enc"])
        if key:
            return key
    return p3_settings.platform_key(provider)


# ------------------------------------------------------------------ waterfall
async def run_waterfall(user_id: str, person: Person, order: tuple[str, ...] | list[str] | None = None) -> dict:
    """Try providers in order; stop at the first email."""
    tried: list[dict] = []
    for name in order or PROVIDER_ORDER:
        prov = REGISTRY.get(name)
        if not prov:
            continue
        key = ""
        if prov.needs_key:
            key = await _resolve_key(user_id, name)
            if not key:
                tried.append({"provider": name, "status": "skipped_no_key"})
                continue
        try:
            found = await prov.find_email(person, key)
        except Exception as exc:  # noqa: BLE001 - a failing provider must not stop the waterfall
            tried.append({"provider": name, "status": "error", "error": str(exc)[:120]})
            continue
        if not found:
            tried.append({"provider": name, "status": "miss"})
            continue
        tried.append({"provider": name, "status": "hit"})
        return {"found": True, "email": found.email, "confidence": found.confidence, "provider": name,
                "tried": tried}
    return {"found": False, "email": None, "provider": None, "tried": tried}


async def enrich_lead(user_id: str, lead_id: str) -> dict:
    """Fill missing decision-maker emails for one lead via the waterfall."""
    from app.watch.signals import domain_of

    lead = await _leads.get(_id=lead_id, user_id=user_id)
    if not lead:
        raise LookupError("lead not found")
    domain, company = domain_of(lead.get("url") or ""), lead.get("title") or ""
    results = []
    for dm in await _dms.find(_dms.model.lead_id == lead_id):
        if dm.get("email"):
            continue
        res = await run_waterfall(user_id, Person(name=dm.get("name") or "", domain=domain, company=company,
                                                  linkedin_url=dm.get("linkedin_url") or ""))
        if res["found"]:
            await _dms.update(dm["_id"], {"email": res["email"], "email_source": res["provider"]})
        results.append({"decision_maker": dm.get("name"), **res})
    return {"lead_id": lead_id, "results": results}
