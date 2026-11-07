"""
Symmetric encryption helpers for secrets stored at rest (e.g. per-user API keys).

Uses Fernet (AES-128-CBC + HMAC) with a key deterministically derived from the
app's SECRET_KEY, so no extra key management is required. If SECRET_KEY changes,
previously-encrypted values can no longer be decrypted (they'll read as empty).
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _fernet() -> Fernet:
    # Fernet needs a 32-byte url-safe base64 key; derive it from SECRET_KEY.
    digest = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a plaintext secret into a url-safe token string."""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    """Decrypt a token produced by encrypt_secret. Returns "" if it can't be read."""
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError, TypeError):
        return ""


def mask_secret(plaintext: str) -> str:
    """Return a display-safe masked version, e.g. '••••••••a1b2'."""
    if not plaintext:
        return ""
    last4 = plaintext[-4:] if len(plaintext) >= 4 else plaintext
    return "••••••••" + last4
