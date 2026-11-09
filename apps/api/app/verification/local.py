"""Local checks that need no third party: syntax, disposable domains, role accounts and DNS MX."""
from __future__ import annotations

import re

import dns.resolver  # dnspython

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-']+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}$")

# Mailbox names that reach a team or a shared inbox, not a person. Risky to mail and convert worse.
ROLE_LOCALS = frozenset(
    {
        "admin", "administrator", "info", "contact", "sales", "support", "help", "hello", "office", "billing",
        "accounts", "accounting", "hr", "jobs", "careers", "press", "media", "marketing", "team", "enquiries",
        "inquiries", "webmaster", "postmaster", "abuse", "noreply", "no-reply", "donotreply", "privacy", "legal",
        "security", "service", "feedback", "mail", "orders", "booking", "reception",
    }
)

# A short list of well-known throwaway providers. Not exhaustive; paid providers cover the long tail.
DISPOSABLE_DOMAINS = frozenset(
    {
        "mailinator.com", "guerrillamail.com", "guerrillamail.net", "10minutemail.com", "10minutemail.net",
        "tempmail.com", "temp-mail.org", "throwawaymail.com", "yopmail.com", "trashmail.com", "getnada.com",
        "sharklasers.com", "maildrop.cc", "dispostable.com", "fakeinbox.com", "mintemail.com", "mohmal.com",
        "mailnesia.com", "spamgourmet.com", "tempinbox.com", "emailondeck.com", "moakt.com", "tmpmail.org",
    }
)


def is_valid_syntax(email: str) -> bool:
    email = (email or "").strip()
    return bool(email) and len(email) <= 254 and bool(_EMAIL_RE.match(email)) and ".." not in email


def split_email(email: str) -> tuple[str, str]:
    local, _, domain = (email or "").strip().rpartition("@")
    return local.lower(), domain.lower()


def is_disposable(domain: str) -> bool:
    domain = (domain or "").lower()
    return domain in DISPOSABLE_DOMAINS or any(domain.endswith("." + d) for d in DISPOSABLE_DOMAINS)


def is_role_account(local: str) -> bool:
    return (local or "").lower() in ROLE_LOCALS


def get_mx_records(domain: str) -> list[str]:
    """MX hostnames for `domain`, lowest preference first. Empty when there are none or the lookup fails."""
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=5)
        return [str(r.exchange).rstrip(".") for r in sorted(answers, key=lambda r: r.preference)]
    except Exception:
        return []
