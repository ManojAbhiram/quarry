"""The SMTP email probe must not connect to a private MX address, and must connect to the
address it checked (not re-resolve the name). Network-free: DNS and smtplib are patched."""

import smtplib
import socket

import pytest

from app.services import email_verification

PUBLIC_IP = "93.184.216.34"


def fake_dns(mapping):
    def _getaddrinfo(host, port, *args, **kwargs):
        ips = mapping.get(host, host)  # a literal IP resolves to itself
        ips = [ips] if isinstance(ips, str) else ips
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port or 0)) for ip in ips]

    return _getaddrinfo


class FakeSMTP:
    connects: list = []

    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def connect(self, host, port):
        FakeSMTP.connects.append((host, port))

    def ehlo(self, *args):
        return 250, b""

    def mail(self, *args):
        return 250, b""

    def rcpt(self, *args):
        return 250, b""


@pytest.fixture(autouse=True)
def fake_smtp(monkeypatch):
    FakeSMTP.connects = []
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    return FakeSMTP


@pytest.mark.parametrize("private_ip", ["127.0.0.1", "10.0.0.5", "169.254.169.254"])
def test_smtp_probe_refuses_an_mx_that_resolves_to_a_private_address(monkeypatch, fake_smtp, private_ip):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"mx.evil.example": private_ip}))
    accepted, reason = email_verification._smtp_verify("mx.evil.example", "someone@evil.example")
    assert accepted is False
    assert "non-public" in reason
    assert fake_smtp.connects == []


def test_smtp_probe_connects_to_the_checked_ip_not_the_hostname(monkeypatch, fake_smtp):
    monkeypatch.setattr(socket, "getaddrinfo", fake_dns({"mx.good.example": PUBLIC_IP}))
    accepted, _ = email_verification._smtp_verify("mx.good.example", "someone@good.example")
    assert accepted is True
    assert fake_smtp.connects == [(PUBLIC_IP, 25)]
