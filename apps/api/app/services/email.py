from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import aiosmtplib

from app.core.config import settings
from app.core.logger import logger


async def send_password_reset_email(to_email: str, reset_token: str) -> None:
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={reset_token}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Reset Your Password — Quarry"
    msg["From"] = settings.SMTP_FROM
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

    await aiosmtplib.send(
        msg,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USERNAME,
        password=settings.SMTP_PASSWORD,
        start_tls=True,
    )
    logger.info(f"Password reset email sent to {to_email}")
