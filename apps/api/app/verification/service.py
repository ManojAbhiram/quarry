"""Compose the local checks, the optional SMTP probe and an optional paid provider into one status.

Order: syntax -> disposable -> MX -> (provider, if configured) -> (SMTP probe, if enabled) -> role-account downgrade.
A provider's answer is authoritative when it gives one; if it errors we fall back to the free checks and say so.
"""
from __future__ import annotations

import asyncio
from contextvars import ContextVar
from dataclasses import dataclass

from app.core.logger import logger
from app.core.security_crypto import decrypt_secret
from app.verification import local, smtp
from app.verification.providers import Provider, ProviderError, get_provider
from app.verification.types import VerificationResult


@dataclass
class VerifierConfig:
    """How to verify for one user. The default is the free local checks only."""

    smtp_probe: bool = False
    provider: Provider | None = None

    @classmethod
    def from_user(cls, user: dict | None) -> "VerifierConfig":
        user = user or {}
        key = decrypt_secret(user.get("verifier_api_key_encrypted") or "")
        return cls(
            smtp_probe=bool(user.get("verifier_smtp_probe")),
            provider=get_provider(user.get("verifier_provider"), key),
        )


# The verifier settings of the user whose pipeline is running, set by the pipeline entry point (like the Serper key).
current_verifier: ContextVar["VerifierConfig | None"] = ContextVar("current_verifier", default=None)


def _role_downgrade(status: str, reason: str, local_part: str) -> tuple[str, str]:
    if status in ("verified", "likely") and local.is_role_account(local_part):
        return "risky", f"{reason}; role account '{local_part}@' reaches a shared inbox"
    return status, reason


async def verify(email: str, config: VerifierConfig | None = None) -> VerificationResult:
    config = config or VerifierConfig()
    email = (email or "").strip()
    if not local.is_valid_syntax(email):
        return VerificationResult(email, "invalid", "Invalid email syntax", "syntax_check")

    local_part, domain = local.split_email(email)
    if local.is_disposable(domain):
        return VerificationResult(email, "risky", f"'{domain}' is a disposable email provider", "disposable")

    loop = asyncio.get_running_loop()
    mx_hosts = await loop.run_in_executor(None, local.get_mx_records, domain)
    if not mx_hosts:
        return VerificationResult(email, "invalid", f"No MX records for domain '{domain}'", "dns_mx")

    provider_note = ""
    if config.provider is not None:
        try:
            pr = await config.provider.verify(email)
            status, reason = _role_downgrade(pr.status, pr.reason, local_part)
            return VerificationResult(
                email, status, reason, f"provider:{config.provider.name}",  # type: ignore[arg-type]
                catch_all=pr.catch_all, provider=config.provider.name,
            )
        except ProviderError as exc:
            logger.warning("Email provider %s failed, using local checks: %s", config.provider.name, exc)
            provider_note = f" ({exc}; used free checks instead)"

    status = "likely"
    reason = f"MX record found for '{domain}'; mailbox not probed"
    method = "dns_mx"
    catch_all: bool | None = None

    if config.smtp_probe:
        try:
            outcome = await asyncio.wait_for(loop.run_in_executor(None, smtp.probe, mx_hosts[0], email), timeout=20)
        except asyncio.TimeoutError:
            outcome = smtp.SmtpOutcome(None, None, "SMTP probe timed out")
        catch_all = outcome.catch_all
        method = "smtp_rcpt"
        if outcome.accepted is False:
            status, reason = "invalid", outcome.reason
        elif outcome.accepted and outcome.catch_all:
            status, reason = "risky", f"{outcome.reason}; cannot confirm the mailbox exists"
        elif outcome.accepted:
            status, reason = "verified", outcome.reason
        else:
            status, reason = "likely", f"MX record found for '{domain}'; {outcome.reason}"

    status, reason = _role_downgrade(status, reason, local_part)
    return VerificationResult(email, status, reason + provider_note, method, catch_all=catch_all)  # type: ignore[arg-type]


async def verify_many(emails: list[str], config: VerifierConfig | None = None, concurrency: int = 8) -> list[VerificationResult]:
    sem = asyncio.Semaphore(concurrency)

    async def one(e: str) -> VerificationResult:
        async with sem:
            return await verify(e, config)

    return list(await asyncio.gather(*(one(e) for e in emails)))
