"""Optional SMTP RCPT probe with catch-all detection.

Many networks block outbound port 25 and many servers accept every recipient, so this is a best-effort signal that
callers must opt in to. A server that accepts a mailbox that cannot exist (a random local part) is a catch-all, and
its acceptance of the real address then proves nothing.
"""
from __future__ import annotations

import secrets
import smtplib
import socket
from dataclasses import dataclass

from app.core.url_guard import UnsafeURLError, resolve_public

PROBE_FROM = "verify@quarry.ai"


@dataclass
class SmtpOutcome:
    accepted: bool | None  # True accepted, False refused (definitively), None inconclusive
    catch_all: bool | None
    reason: str


def _rcpt(mx_ip: str, addresses: list[str], timeout: int) -> list[tuple[int, str]]:
    """RCPT each address in one session. Returns [(smtp code, message)]."""
    codes: list[tuple[int, str]] = []
    with smtplib.SMTP(timeout=timeout) as conn:
        conn.connect(mx_ip, 25)
        conn.ehlo("quarry.ai")
        conn.mail(PROBE_FROM)
        for addr in addresses:
            code, msg = conn.rcpt(addr)
            codes.append((code, msg.decode(errors="replace") if isinstance(msg, bytes) else str(msg)))
    return codes


def probe(mx_host: str, email: str, timeout: int = 5) -> SmtpOutcome:
    """Blocking probe (run it in an executor). Never raises."""
    try:
        # An MX record can point at loopback or a private host: resolve and check it, then connect to the checked address.
        mx_ip = resolve_public(mx_host, 25)[0]
    except UnsafeURLError as exc:
        return SmtpOutcome(None, None, f"SMTP target refused: {exc}")
    domain = email.rsplit("@", 1)[-1]
    bogus = f"qry-{secrets.token_hex(6)}@{domain}"
    try:
        (code, _msg), (bogus_code, _bm) = _rcpt(mx_ip, [email, bogus], timeout)
    except smtplib.SMTPRecipientsRefused:
        return SmtpOutcome(False, False, "SMTP recipient refused")
    except (smtplib.SMTPException, socket.timeout, OSError) as exc:
        return SmtpOutcome(None, None, f"SMTP probe inconclusive: {exc}")
    except Exception as exc:  # defensive: a probe must never break a run
        return SmtpOutcome(None, None, f"SMTP error: {exc}")

    catch_all = bogus_code < 400
    if code < 300:
        return SmtpOutcome(True, catch_all, f"SMTP RCPT returned {code}" + ("; domain accepts any mailbox" if catch_all else ""))
    if 500 <= code < 600:
        return SmtpOutcome(False, catch_all, f"SMTP RCPT returned {code}")
    return SmtpOutcome(None, catch_all, f"SMTP RCPT returned {code} (temporary)")
