"""Field mapping between Quarry lead data and CRM properties.

A mapping is {"company": {quarry_field: crm_property}, "contact": {quarry_field: crm_property}}. `domain` (company)
and `email` (contact) are the dedupe keys and are always mapped to the CRM properties of the same name.
"""
import re
from typing import Optional

from app.core.utils import extract_canonical_domain

COMPANY_FIELDS = {
    "name": "Company name",
    "domain": "Website domain (dedupe key)",
    "website": "Website URL",
    "phone": "Phone",
    "snippet": "Description / buying signals",
    "match_score": "Quarry match score",
}
CONTACT_FIELDS = {
    "email": "Email (dedupe key)",
    "first_name": "First name",
    "last_name": "Last name",
    "job_title": "Job title",
    "phone": "Phone",
    "linkedin_url": "LinkedIn URL",
}

DEFAULT_MAPPING = {
    "company": {"name": "name", "domain": "domain", "phone": "phone", "snippet": "description"},
    "contact": {"email": "email", "first_name": "firstname", "last_name": "lastname", "job_title": "jobtitle",
                "phone": "phone"},
}
_FORCED = {"company": ("domain", "domain"), "contact": ("email", "email")}
_PROP = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class MappingError(ValueError):
    pass


def validate_mapping(raw: dict) -> dict:
    """Return a cleaned mapping or raise MappingError. Unknown Quarry fields and bad property names are rejected."""
    allowed = {"company": COMPANY_FIELDS, "contact": CONTACT_FIELDS}
    out: dict = {}
    for kind, fields in allowed.items():
        section = (raw or {}).get(kind, {})
        if not isinstance(section, dict):
            raise MappingError(f"'{kind}' mapping must be an object")
        cleaned = {}
        for src, dest in section.items():
            if src not in fields:
                raise MappingError(f"Unknown {kind} field '{src}'")
            if not isinstance(dest, str) or not _PROP.match(dest):
                raise MappingError(f"Invalid CRM property name for {kind}.{src}: use lowercase letters, digits and _")
            cleaned[src] = dest
        key_src, key_dest = _FORCED[kind]
        if cleaned.get(key_src, key_dest) != key_dest:
            raise MappingError(f"{kind}.{key_src} is the dedupe key and must map to '{key_dest}'")
        cleaned[key_src] = key_dest
        out[kind] = cleaned
    return out


def lead_domain(lead: dict) -> str:
    return extract_canonical_domain(lead.get("url") or "")


def build_company(lead: dict, mapping: dict) -> Optional[dict]:
    domain = lead_domain(lead)
    if not domain:
        return None
    source = {
        "name": lead.get("title") or domain, "domain": domain, "website": lead.get("url"), "phone": lead.get("phone"),
        "snippet": lead.get("snippet"), "match_score": lead.get("match_score"),
    }
    return _apply(source, mapping["company"])


def build_contacts(lead: dict, decision_makers: list[dict], mapping: dict) -> list[dict]:
    """One contact per distinct email: the lead's own contact email plus any decision makers with an email."""
    people = []
    if lead.get("email"):
        people.append({"email": lead["email"], "phone": lead.get("phone")})
    for dm in decision_makers:
        first, _, last = (dm.get("name") or "").strip().partition(" ")
        people.append({"email": dm.get("email"), "first_name": first or None, "last_name": last or None,
                       "job_title": dm.get("title"), "linkedin_url": dm.get("linkedin_url")})
    seen, out = set(), []
    for p in people:
        email = (p.get("email") or "").strip().lower()
        if not email or "@" not in email or email in seen:
            continue
        seen.add(email)
        out.append(_apply({**p, "email": email}, mapping["contact"]))
    return out


def _apply(source: dict, mapping: dict) -> dict:
    props = {}
    for src, dest in mapping.items():
        val = source.get(src)
        if val not in (None, ""):
            props[dest] = str(val) if not isinstance(val, str) else val
    return props
