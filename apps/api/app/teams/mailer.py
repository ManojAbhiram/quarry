from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape

from app.services.email import _deliver


async def send_invite_email(to_email: str, org_name: str, inviter: str, link: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{inviter} invited you to {org_name} on Quarry"
    msg["To"] = to_email
    msg.attach(MIMEText(f"{inviter} invited you to join {org_name} on Quarry.\n\nAccept: {link}\n\nThis link expires in 7 days.", "plain"))
    html = (
        f"<p>{escape(inviter)} invited you to join <b>{escape(org_name)}</b> on Quarry.</p>"
        f'<p><a href="{escape(link)}">Accept the invitation</a></p><p>This link expires in 7 days.</p>'
    )
    msg.attach(MIMEText(html, "html"))
    await _deliver(msg)
