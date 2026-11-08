"""
Email Verification Service
==========================
Verifies email addresses using two techniques:
  1. DNS MX-record lookup (does the domain have a mail server?)
  2. SMTP RCPT-TO probe (does the mailbox exist? – best-effort)

Returns:
  {
      "email": str,
      "verified": bool,
      "confidence": "high" | "medium" | "low",
      "method": str,
      "reason": str,
  }
"""

from __future__ import annotations

import asyncio
import re
import smtplib
import socket
from typing import Optional

import dns.resolver  # dnspython – already in pyproject.toml

from app.core.logger import logger
from app.core.url_guard import UnsafeURLError, resolve_public

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
# Public API
# ---------------------------------------------------------------------------

async def verify_email(email: str, smtp_probe: bool = True) -> dict:
    """
    Asynchronously verify a single email address.

    Parameters:
      • smtp_probe – when False, skip the (slow, often port-25-blocked) SMTP
        RCPT probe and rely on MX-record validation only. Used by the lead
        pipeline for fast, non-blocking bulk verification; the on-demand
        per-lead endpoint keeps the full SMTP probe for higher confidence.

    Confidence levels:
      • high   – MX record found **and** SMTP probe accepted
      • medium – MX record found but SMTP probe inconclusive / skipped
      • low    – syntax OK but no MX record (or syntax invalid)
    """
    email = (email or "").strip()

    if not email or not _is_valid_syntax(email):
        return {
            "email": email,
            "verified": False,
            "confidence": "low",
            "method": "syntax_check",
            "reason": "Invalid email syntax",
        }

    domain = email.split("@")[-1].lower()

    # --- Step 1: MX lookup (run in thread pool to avoid blocking the event loop) ---
    loop = asyncio.get_event_loop()
    mx_hosts: list[str] = await loop.run_in_executor(None, _get_mx_records, domain)

    if not mx_hosts:
        return {
            "email": email,
            "verified": False,
            "confidence": "low",
            "method": "dns_mx",
            "reason": f"No MX records for domain '{domain}'",
        }

    # MX-only mode: a valid MX record means the domain can receive mail. Treat as
    # "likely deliverable" (medium confidence) without the expensive SMTP probe.
    if not smtp_probe:
        return {
            "email": email,
            "verified": True,
            "confidence": "medium",
            "method": "dns_mx",
            "reason": f"MX record found for '{domain}' (SMTP probe skipped)",
        }

    # --- Step 2: SMTP probe (best-effort, non-blocking) ---
    mx_host = mx_hosts[0]
    try:
        accepted, reason = await asyncio.wait_for(
            loop.run_in_executor(None, _smtp_verify, mx_host, email),
            timeout=8,
        )
    except asyncio.TimeoutError:
        accepted, reason = False, "SMTP probe timed out"

    if accepted:
        return {
            "email": email,
            "verified": True,
            "confidence": "high",
            "method": "smtp_rcpt",
            "reason": reason,
        }
    else:
        # SMTP refused but MX exists → medium confidence (mailbox may still be valid
        # if the server uses catch-all or greylisting)
        logger.debug("Email SMTP probe inconclusive for %s: %s", email, reason)
        return {
            "email": email,
            "verified": True,   # treat MX-valid as "likely deliverable"
            "confidence": "medium",
            "method": "dns_mx",
            "reason": f"MX record found for '{domain}'; SMTP probe: {reason}",
        }


async def verify_emails_batch(
    emails: list[str],
    concurrency: int = 5,
    smtp_probe: bool = True,
) -> list[dict]:
    """Verify multiple emails concurrently, up to *concurrency* at a time."""
    sem = asyncio.Semaphore(concurrency)

    async def _limited(email: str) -> dict:
        async with sem:
            return await verify_email(email, smtp_probe=smtp_probe)

    tasks = [_limited(e) for e in emails]
    return await asyncio.gather(*tasks)
