async def test_payment_routes_are_unavailable_with_provider_keys_configured(api, signup, monkeypatch):
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    monkeypatch.setenv("STRIPE_PRICE_PRO", "price_pro_fake")
    monkeypatch.setenv("PAYMENT_PROVIDER", "stripe")
    headers, _ = await signup("retired-billing@x.com")
    for route, payload in (
        ("checkout", {"plan": "pro"}),
        ("topup", {"credits": 100, "target": "requests"}),
        ("webhooks/stripe", {}),
    ):
        response = await api.post(f"/api/billing/{route}", json=payload, headers=headers)
        assert response.status_code == 404
