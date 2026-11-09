"""PaymentProvider interface plus the provider-neutral event model the webhook handler works on."""
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


class ProviderNotConfigured(RuntimeError):
    pass


class InvalidSignature(ValueError):
    pass


def env(name: str, default: str = "") -> str:
    """Read config at call time (not import time) so tests and deployments can change it freely."""
    return os.getenv(name, default)


@dataclass
class CheckoutSession:
    id: str
    url: str
    provider: str


@dataclass
class NormalizedEvent:
    """What the billing service needs from any provider webhook.

    kind: subscription_updated | subscription_canceled | invoice_paid | invoice_failed | topup_paid | ignored
    """

    event_id: str
    kind: str
    scope_id: Optional[str] = None
    plan: Optional[str] = None
    status: Optional[str] = None  # active | trialing | past_due | canceled
    customer_id: Optional[str] = None
    subscription_id: Optional[str] = None
    period_end: Optional[int] = None  # unix seconds
    invoice: dict = field(default_factory=dict)  # id, amount (minor units), currency, status, url
    topup: dict = field(default_factory=dict)  # credits, target ("requests"|"enrichment"), user_id (kind="topup_paid")


class PaymentProvider(ABC):
    name: str
    # True for providers that take payment synchronously (the mock): credits are applied right after the session is
    # created instead of waiting for a webhook.
    settles_immediately: bool = False
    supports_topup: bool = False

    async def create_topup_session(
        self, *, scope_id: str, user_id: str, credits: int, price_usd: int, target: str, customer_email: str,
        success_url: str, cancel_url: str,
    ) -> CheckoutSession:
        """One-off purchase of `credits`. Providers that cannot do this keep the default."""
        raise ProviderNotConfigured(f"{self.name} does not support credit top-ups")

    @abstractmethod
    def is_configured(self) -> bool: ...

    @abstractmethod
    async def create_checkout_session(
        self, *, scope_id: str, plan: str, customer_email: str, success_url: str, cancel_url: str
    ) -> CheckoutSession:
        """Start a hosted checkout for `plan`; `scope_id` is round-tripped so webhooks can find the workspace."""

    @abstractmethod
    def verify_webhook(self, payload: bytes, headers: dict) -> None:
        """Raise InvalidSignature unless the payload is authentic (and fresh, where the provider supports it)."""

    @abstractmethod
    def parse_event(self, payload: bytes, headers: dict) -> NormalizedEvent:
        """Translate a verified payload into a NormalizedEvent (kind='ignored' for events we don't act on)."""
