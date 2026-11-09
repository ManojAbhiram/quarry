"""Mock payment provider for local development and demos: no network, no keys.

Enabled only when PAYMENT_PROVIDER=mock. It takes "payment" instantly (`settles_immediately`), so a top-up is credited
as soon as the session is created. It cannot sell subscriptions and never accepts webhooks.
"""
import uuid

from app.billing.providers.base import (
    CheckoutSession,
    InvalidSignature,
    NormalizedEvent,
    PaymentProvider,
    ProviderNotConfigured,
    env,
)


class MockProvider(PaymentProvider):
    name = "mock"
    settles_immediately = True
    supports_topup = True

    def is_configured(self) -> bool:
        return env("PAYMENT_PROVIDER").lower() == "mock"

    async def create_checkout_session(self, **kwargs):
        raise ProviderNotConfigured("The mock provider only supports credit top-ups")

    async def create_topup_session(self, *, success_url, **kwargs):
        return CheckoutSession(id=f"mock_{uuid.uuid4().hex[:12]}", url=success_url, provider=self.name)

    def verify_webhook(self, payload: bytes, headers: dict) -> None:
        raise InvalidSignature("The mock provider has no webhooks")

    def parse_event(self, payload: bytes, headers: dict) -> NormalizedEvent:
        return NormalizedEvent("", "ignored")
