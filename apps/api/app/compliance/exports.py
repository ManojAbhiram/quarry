"""Helpers every export shares: the source notice and suppression filtering."""
from __future__ import annotations

from datetime import date

from app.suppression import SuppressionMatcher, load_matcher


def source_notice() -> str:
    return (
        "Source notice: this data was compiled by Quarry from public web pages and search results; the page each value "
        "came from is listed in the Field Sources column. It may include personal data. Before contacting anyone, check "
        "the rules that apply to them (GDPR, UK GDPR and PECR, CASL, India DPDP Act, CAN-SPAM), honour opt-out and "
        f"erasure requests, and do not contact suppressed addresses. Exported {date.today().isoformat()}."
    )


async def matcher_for(owner_id: str) -> SuppressionMatcher:
    return await load_matcher(str(owner_id))


def lead_is_suppressed(matcher: SuppressionMatcher, lead: dict) -> bool:
    """A lead is dropped when its contact email or its company website is suppressed."""
    return matcher.matches(lead.get("email") or lead.get("contact_email")) or matcher.matches(lead.get("url") or lead.get("website"))


def contact_is_suppressed(matcher: SuppressionMatcher, contact: dict) -> bool:
    return matcher.matches(contact.get("email"))
