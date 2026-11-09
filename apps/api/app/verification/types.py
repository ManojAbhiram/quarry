"""Shared types for email verification."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

Status = Literal["verified", "likely", "risky", "invalid"]
STATUSES: tuple[str, ...] = ("verified", "likely", "risky", "invalid")

# How the new status maps onto the older (verified, confidence) pair that stored leads and old clients still use.
_LEGACY = {
    "verified": (True, "high"),
    "likely": (True, "medium"),
    "risky": (True, "low"),
    "invalid": (False, "low"),
}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class VerificationResult:
    email: str
    status: Status
    reason: str
    method: str  # which check decided: syntax_check | dns_mx | disposable | role | smtp_rcpt | provider:<name>
    checked_at: str = field(default_factory=utcnow_iso)
    catch_all: bool | None = None  # True when the domain accepts any mailbox; None when not tested
    provider: str | None = None

    def to_dict(self) -> dict:
        verified, confidence = _LEGACY[self.status]
        return {
            "email": self.email,
            "status": self.status,
            "email_status": self.status,
            "reason": self.reason,
            "method": self.method,
            "checked_at": self.checked_at,
            "catch_all": self.catch_all,
            "provider": self.provider,
            # legacy fields
            "verified": verified,
            "confidence": confidence,
        }

    def lead_fields(self) -> dict:
        """The fields to persist on a lead or decision maker document."""
        verified, confidence = _LEGACY[self.status]
        return {
            "email_status": self.status,
            "email_checked_at": self.checked_at,
            "email_status_reason": self.reason,
            "email_catch_all": self.catch_all,
            "email_verified": verified,
            "email_confidence": confidence,
            "email_verify_method": self.method,
            "email_verify_reason": self.reason,
        }
