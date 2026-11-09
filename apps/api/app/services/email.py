from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.core.config import settings
from app.core.logger import logger


class SmtpNotConfigured(RuntimeError):
    pass


async def _deliver(msg: MIMEMultipart) -> None:
    """Send via SMTP. Port 465 uses implicit TLS; anything else uses STARTTLS."""
    username = settings.SMTP_USERNAME.strip()
    # Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are not part of it.
    password = settings.SMTP_PASSWORD.replace(" ", "")
    if not (username and password):
        raise SmtpNotConfigured("SMTP_USERNAME and SMTP_PASSWORD must be set in .env")
    if "From" not in msg:
        msg["From"] = settings.SMTP_FROM or username
    use_ssl = settings.SMTP_PORT == 465
    await aiosmtplib.send(
        msg,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=username,
        password=password,
        use_tls=use_ssl,
        start_tls=not use_ssl,
        timeout=20,
    )


async def send_password_reset_email(to_email: str, reset_token: str) -> None:
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Reset Your Password — Quarry"
    msg["From"] = settings.SMTP_FROM or settings.SMTP_USERNAME
    msg["To"] = to_email

    plain = (
        f"You requested a password reset for your Quarry account.\n\n"
        f"Click the link below to reset your password:\n{reset_url}\n\n"
        f"This link expires in {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes.\n"
        f"If you didn't request this, you can safely ignore this email."
    )
    html = f"""
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
  <h2 style="color:#1e1e2e">Reset your password</h2>
  <p>You requested a password reset for your Quarry account.</p>
  <a href="{reset_url}"
     style="display:inline-block;background:#4F46E5;color:#fff;padding:12px 28px;
            border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
    Reset Password
  </a>
  <p style="color:#6b7280;font-size:13px">
    Or copy this link into your browser:<br>
    <span style="word-break:break-all">{reset_url}</span>
  </p>
  <p style="color:#6b7280;font-size:13px">
    This link expires in {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes.
    If you didn't request a reset, you can safely ignore this email.
  </p>
</body>
</html>
"""

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))

    await _deliver(msg)
    logger.info(f"Password reset email sent to {to_email}")


if __name__ == "__main__":
    # Smoke test:  python -m app.services.email you@example.com
    import asyncio
    import sys

    async def _main(to: str) -> None:
        m = MIMEText("SMTP is configured correctly.", "plain")
        m["Subject"] = "Quarry SMTP test"
        m["To"] = to
        await _deliver(m)
        print(f"Sent test email to {to}")

    asyncio.run(_main(sys.argv[1]))
