"""Infer the data-protection region of a lead from its domain, country or location text.

This is a heuristic to prompt a human to check the rules, not legal advice. Regions: EU, UK, CA, IN, or None when
nothing points anywhere we have a note for. `generic` TLDs (.com, .io) tell us nothing, so we fall back to the
location text.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

EU_TLDS = {
    "at", "be", "bg", "hr", "cy", "cz", "dk", "ee", "fi", "fr", "de", "gr", "hu", "ie", "it", "lv", "lt", "lu",
    "mt", "nl", "pl", "pt", "ro", "sk", "si", "es", "se", "eu",
}
EU_COUNTRIES = {
    "austria", "belgium", "bulgaria", "croatia", "cyprus", "czech republic", "czechia", "denmark", "estonia",
    "finland", "france", "germany", "greece", "hungary", "ireland", "italy", "latvia", "lithuania", "luxembourg",
    "malta", "netherlands", "poland", "portugal", "romania", "slovakia", "slovenia", "spain", "sweden",
    "european union",
}
UK_COUNTRIES = {"united kingdom", "uk", "england", "scotland", "wales", "northern ireland", "great britain"}
CA_COUNTRIES = {"canada"}
IN_COUNTRIES = {"india"}

NOTES = {
    "EU": "EU/EEA: GDPR applies. You need a lawful basis (usually legitimate interest), must honour opt-out and erasure requests, and should identify the source of the data.",
    "UK": "UK: UK GDPR and PECR apply. Corporate emails are lighter-touch than personal ones, but opt-out and erasure requests must be honoured.",
    "CA": "Canada: CASL requires consent (express or implied) before commercial emails, plus a working unsubscribe. PIPEDA governs personal data.",
    "IN": "India: the DPDP Act 2023 applies. Process personal data for a lawful purpose, honour withdrawal and erasure requests.",
}

def _tld(host: str) -> str:
    return host.rsplit(".", 1)[-1] if "." in host else ""


def _host(value: str | None) -> str:
    if not value:
        return ""
    value = value.strip().lower()
    if "@" in value and "//" not in value:
        value = value.rsplit("@", 1)[-1]
    parsed = urlparse(value if "//" in value else "//" + value)
    return (parsed.hostname or "").removeprefix("www.")


def _from_tld(host: str) -> str | None:
    if not host:
        return None
    last = _tld(host)
    if last in ("uk", "gb"):
        return "UK"
    if last == "ca":
        return "CA"
    if last == "in":
        return "IN"
    if last in EU_TLDS:
        return "EU"
    return None


def _from_text(text: str | None) -> str | None:
    if not text:
        return None
    t = text.lower()
    # match whole words/phrases so 'india' does not match 'indiana'
    for region, names in (("UK", UK_COUNTRIES), ("CA", CA_COUNTRIES), ("IN", IN_COUNTRIES), ("EU", EU_COUNTRIES)):
        for name in names:
            if re.search(rf"(?<![a-z]){re.escape(name)}(?![a-z])", t):
                return region
    return None


def infer_region(url_or_domain: str | None = None, country: str | None = None, location: str | None = None,
                 email: str | None = None) -> dict:
    """{"region": "EU"|"UK"|"CA"|"IN"|None, "note": str|None, "basis": "country"|"location"|"domain"|None}.

    Stated country/location wins over the domain: a .de domain is weaker evidence than 'Toronto, Canada'.
    """
    for basis, value in (("country", country), ("location", location)):
        region = _from_text(value)
        if region:
            return {"region": region, "note": NOTES[region], "basis": basis}
    for value in (url_or_domain, email):
        region = _from_tld(_host(value))
        if region:
            return {"region": region, "note": NOTES[region], "basis": "domain"}
    return {"region": None, "note": None, "basis": None}
