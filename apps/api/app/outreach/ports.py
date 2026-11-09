"""Interfaces for every network edge of outreach (SMTP, IMAP, DNS). Tests swap in fakes via `ports.<name> = Fake()`.

Mailbox credentials are passed as a plain `MailboxCreds` (already decrypted) so the adapters hold no DB knowledge.
"""
from __future__ import annotations

import asyncio
import imaplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Protocol

import aiosmtplib


class SendError(Exception):
    """Sending failed. `permanent` True means the recipient/server rejected it for good (5xx)."""

    def __init__(self, message: str, permanent: bool = False):
        super().__init__(message)
        self.permanent = permanent


@dataclass
class MailboxCreds:
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    imap_host: str = ""
    imap_port: int = 993
    imap_username: str = ""
    imap_password: str = ""


class SmtpSender(Protocol):
    async def send(self, creds: MailboxCreds, message: EmailMessage) -> None: ...


class ImapPoller(Protocol):
    async def fetch_new(self, creds: MailboxCreds, after_uid: int) -> list[tuple[int, bytes]]:
        """Return (uid, raw RFC822 bytes) for INBOX messages with uid > after_uid, ascending."""


class DnsResolver(Protocol):
    async def txt(self, name: str) -> list[str]:
        """TXT strings for `name`; an empty list when none/NXDOMAIN."""


class RealSmtp:
    async def send(self, creds: MailboxCreds, message: EmailMessage) -> None:
        use_ssl = creds.smtp_port == 465
        try:
            await aiosmtplib.send(
                message,
                hostname=creds.smtp_host,
                port=creds.smtp_port,
                username=creds.smtp_username,
                password=creds.smtp_password.replace(" ", ""),
                use_tls=use_ssl,
                start_tls=not use_ssl,
                timeout=20,
            )
        except aiosmtplib.SMTPRecipientsRefused as exc:
            raise SendError(str(exc), permanent=True) from exc
        except aiosmtplib.SMTPResponseException as exc:
            raise SendError(str(exc), permanent=500 <= exc.code < 600 and exc.code not in (535, 530)) from exc
        except (aiosmtplib.SMTPException, OSError, asyncio.TimeoutError) as exc:
            raise SendError(str(exc), permanent=False) from exc


class RealImap:
    async def fetch_new(self, creds: MailboxCreds, after_uid: int) -> list[tuple[int, bytes]]:
        return await asyncio.to_thread(self._fetch, creds, after_uid)

    @staticmethod
    def _fetch(creds: MailboxCreds, after_uid: int) -> list[tuple[int, bytes]]:
        out: list[tuple[int, bytes]] = []
        conn = imaplib.IMAP4_SSL(creds.imap_host, creds.imap_port, ssl_context=ssl.create_default_context(), timeout=30)
        try:
            conn.login(creds.imap_username or creds.smtp_username, (creds.imap_password or creds.smtp_password).replace(" ", ""))
            conn.select("INBOX", readonly=True)
            typ, data = conn.uid("SEARCH", None, f"UID {after_uid + 1}:*")
            if typ != "OK" or not data or not data[0]:
                return out
            for raw_uid in data[0].split():
                uid = int(raw_uid)
                if uid <= after_uid:  # IMAP returns the last message for "N:*" even when N is beyond the end
                    continue
                typ, parts = conn.uid("FETCH", str(uid), "(RFC822)")
                if typ == "OK" and parts and isinstance(parts[0], tuple):
                    out.append((uid, parts[0][1]))
        finally:
            try:
                conn.logout()
            except Exception:  # noqa: BLE001
                pass
        return out


class RealDns:
    async def txt(self, name: str) -> list[str]:
        import dns.asyncresolver
        import dns.exception
        import dns.resolver

        try:
            answer = await dns.asyncresolver.resolve(name, "TXT", lifetime=5)
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.resolver.NoNameservers, dns.exception.Timeout):
            return []
        return ["".join(part.decode() for part in rr.strings) for rr in answer]


class Ports:
    def __init__(self) -> None:
        self.smtp: SmtpSender = RealSmtp()
        self.imap: ImapPoller = RealImap()
        self.dns: DnsResolver = RealDns()


ports = Ports()

__all__ = ["ports", "MailboxCreds", "SendError", "Ports"]
