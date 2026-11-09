"""Per-field provenance: where each enriched value came from and when it was retrieved.

A provenance map looks like {"email": {"source_url": "https://acme.com/contact", "retrieved_at": "...", "method": "page_scrape"}}.
Only fields that have a value and a known source URL are recorded: an unknown source is left out rather than guessed.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

# field -> (method, which item keys to try for the source URL, in order)
_LEAD_FIELDS: dict[str, tuple[str, tuple[str, ...]]] = {
    "company_name": ("page_scrape", ("page_url", "source_url", "website")),
    "email": ("page_scrape", ("page_url", "source_url", "website")),
    "contact_email": ("page_scrape", ("page_url", "source_url", "website")),
    "phone": ("page_scrape", ("page_url", "source_url", "website")),
    "contact_phone": ("page_scrape", ("page_url", "source_url", "website")),
    "contact_name": ("page_scrape", ("page_url", "source_url", "website")),
    "contact_title": ("page_scrape", ("page_url", "source_url", "website")),
    "description": ("page_scrape", ("page_url", "source_url", "website")),
    "buying_signals": ("page_scrape", ("page_url", "source_url", "website")),
    "industry": ("linkedin_search", ("linkedin_url", "page_url", "source_url")),
    "employee_size_estimate": ("linkedin_search", ("linkedin_url", "page_url", "source_url")),
    "headquarters": ("linkedin_search", ("linkedin_url", "page_url", "source_url")),
    "location": ("linkedin_search", ("linkedin_url", "page_url", "source_url")),
    "founded_year": ("linkedin_search", ("linkedin_url", "page_url", "source_url")),
    "funding_stage": ("market_signals", ("crunchbase_url", "linkedin_url", "page_url")),
    "growth": ("market_signals", ("crunchbase_url", "linkedin_url", "page_url")),
    "tech_stack": ("site_probe", ("website", "source_url", "page_url")),
}

_EMPTY = (None, "", [], {}, "null", "None")


def _has_value(v: Any) -> bool:
    return not (v in _EMPTY if isinstance(v, (str, type(None), list, dict)) else False)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_lead_provenance(item: Mapping[str, Any], retrieved_at: str | None = None) -> dict[str, dict]:
    """Provenance for the enriched fields of one lead (a pipeline item)."""
    stamp = retrieved_at or _now_iso()
    out: dict[str, dict] = {}
    for field, (method, url_keys) in _LEAD_FIELDS.items():
        if not _has_value(item.get(field)):
            continue
        url = next((str(item[k]) for k in url_keys if _has_value(item.get(k)) and str(item[k]).startswith("http")), None)
        if url:
            out[field] = {"source_url": url, "retrieved_at": stamp, "method": method}
    return out


def build_contact_provenance(dm: Mapping[str, Any], fallback_url: str | None = None, retrieved_at: str | None = None) -> dict[str, dict]:
    """Provenance for a decision maker. Name, title and LinkedIn URL come from the profile result; the email from the
    page it was found on (`email_source_url`) or, failing that, the company page."""
    stamp = retrieved_at or _now_iso()
    out: dict[str, dict] = {}
    profile = dm.get("linkedin_url") or dm.get("url")
    if profile and str(profile).startswith("http"):
        for field in ("name", "title", "linkedin_url"):
            if _has_value(dm.get(field)) or (field == "linkedin_url"):
                out[field] = {"source_url": str(profile), "retrieved_at": stamp, "method": "linkedin_search"}
    if _has_value(dm.get("email")):
        src = dm.get("email_source_url") or fallback_url
        if src and str(src).startswith("http"):
            out["email"] = {"source_url": str(src), "retrieved_at": stamp, "method": "page_scrape"}
    return out


def summarize(provenance: Mapping[str, Mapping] | None) -> str:
    """One line for exports: 'email: https://... (2026-01-02); phone: ...'."""
    parts = []
    for field, p in (provenance or {}).items():
        when = str(p.get("retrieved_at") or "")[:10]
        parts.append(f"{field}: {p.get('source_url')}" + (f" ({when})" if when else ""))
    return "; ".join(parts)
