"""Pluggable email verification: local checks, optional SMTP probe, optional paid providers (bring your own key)."""
from app.verification.service import VerifierConfig, verify, verify_many
from app.verification.types import STATUSES, VerificationResult

__all__ = ["VerifierConfig", "verify", "verify_many", "VerificationResult", "STATUSES"]
