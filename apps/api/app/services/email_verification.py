"""
Email verification service (compatibility layer)
================================================
The checks live in `app.verification` (local syntax/MX/disposable/role checks, optional SMTP probe with catch-all
detection, optional paid providers). This module keeps the older entry points and the SMTP helper used by tests.

Results carry `status` (verified | likely | risky | invalid), `reason`, `method`, `checked_at`, plus the legacy
`verified` bool and `confidence` (high | medium | low).
"""

from __future__ import annotations

import re
import smtplib
import socket

import dns.resolver  # dnspython – already in pyproject.toml

from app.core.url_guard import UnsafeURLError, resolve_public
from app.verification import VerifierConfig, verify, verify_many

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

PROBE_FROM = "verify@quarry.ai"


def _is_valid_syntax(email: str) -> bool:
    return bool(_EMAIL_RE.match(email.strip()))


def _get_mx_records(domain: str) -> list[str]:
    """Return sorted MX hostnames for *domain*, lowest priority first."""
    try:
        answers = dns.resolver.resolve(domain, "MX", lifetime=5)
        records = sorted(answers, key=lambda r: r.preference)
        return [str(r.exchange).rstrip(".") for r in records]
    except Exception:
        return []


def _smtp_verify(mx_host: str, email: str, timeout: int = 5) -> tuple[bool, str]:
    """
    Probe *mx_host* with an SMTP RCPT-TO command.

    Returns (accepted: bool, reason: str).
    Many servers will always return 250 or refuse the connection entirely —
    so the result is best-effort.
    """
    try:
        # An MX record can point at loopback or a private host. Resolve and check it, then
        # connect to the checked address so the name cannot resolve differently a second time.
        mx_ip = resolve_public(mx_host, 25)[0]
    except UnsafeURLError as exc:
        return False, f"SMTP target refused: {exc}"
    try:
        with smtplib.SMTP(timeout=timeout) as smtp:
            smtp.connect(mx_ip, 25)
            smtp.ehlo("quarry.ai")
            smtp.mail(PROBE_FROM)
            code, _ = smtp.rcpt(email)
            return code < 400, f"SMTP RCPT returned {code}"
    except smtplib.SMTPRecipientsRefused:
        return False, "SMTP recipient refused"
    except smtplib.SMTPConnectError:
        return False, "SMTP connect error"
    except (socket.timeout, OSError) as exc:
        return False, f"Network error: {exc}"
    except Exception as exc:
        return False, f"SMTP error: {exc}"


# ---------------------------------------------------------------------------
# Public API (thin wrappers over app.verification, kept for existing callers)
# ---------------------------------------------------------------------------

async def verify_email(email: str, smtp_probe: bool | None = None, config: VerifierConfig | None = None) -> dict:
    """Verify one address. Returns the status result as a dict (new `status`/`checked_at` plus the legacy keys).

    `config` carries the user's provider and SMTP preference; `smtp_probe` overrides only the probe flag.
    """
    config = config or VerifierConfig()
    if smtp_probe is not None:
        config = VerifierConfig(smtp_probe=smtp_probe, provider=config.provider)
    return (await verify(email, config)).to_dict()


async def verify_emails_batch(
    emails: list[str],
    concurrency: int = 5,
    smtp_probe: bool | None = None,
    config: VerifierConfig | None = None,
) -> list[dict]:
    """Verify multiple emails concurrently, up to *concurrency* at a time."""
    config = config or VerifierConfig()
    if smtp_probe is not None:
        config = VerifierConfig(smtp_probe=smtp_probe, provider=config.provider)
    return [r.to_dict() for r in await verify_many(emails, config, concurrency)]
