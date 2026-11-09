"""Provider lookup. Tests replace entries with `set_provider` / `reset_providers`."""
from app.billing.providers.base import PaymentProvider, env
from app.billing.providers.mock import MockProvider
from app.billing.providers.razorpay import RazorpayProvider
from app.billing.providers.stripe import StripeProvider

_overrides: dict[str, PaymentProvider] = {}


def get_provider(name: str) -> PaymentProvider:
    if name in _overrides:
        return _overrides[name]
    if name == "stripe":
        return StripeProvider()
    if name == "razorpay":
        return RazorpayProvider()
    if name == "mock":
        return MockProvider()
    raise KeyError(name)


def default_provider_name() -> str:
    return env("PAYMENT_PROVIDER", "stripe").lower()


def available_providers() -> list[str]:
    return [n for n in ("stripe", "razorpay") if get_provider(n).is_configured()]


def topup_providers() -> list[str]:
    """Configured providers that can sell credit top-ups (the mock only when PAYMENT_PROVIDER=mock)."""
    found = []
    for n in ("stripe", "razorpay", "mock"):
        p = get_provider(n)
        if p.supports_topup and p.is_configured():
            found.append(n)
    return found


def set_provider(name: str, provider: PaymentProvider) -> None:
    _overrides[name] = provider


def reset_providers() -> None:
    _overrides.clear()
