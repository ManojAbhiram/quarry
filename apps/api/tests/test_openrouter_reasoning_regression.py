import json

import httpx

from app.services import ai_providers


# Regression: ISSUE-002 - reasoning exhausted the selected model's JSON output budget.
# Found by /qa on 2026-11-25.
async def test_openrouter_haiku_returns_search_queries_within_the_output_budget():
    expected = {"queries": ["commercial solar installers"]}

    def respond(request):
        body = json.loads(request.content)
        skips_optional_reasoning = body.get("reasoning") == {"effort": "none"}
        content = json.dumps(expected) if skips_optional_reasoning else '{"queries": ['
        finish_reason = "stop" if skips_optional_reasoning else "length"
        return httpx.Response(200, json={
            "choices": [{"message": {"content": content}, "finish_reason": finish_reason}],
        })

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await ai_providers.generate(
            "openrouter", "test-key", "anthropic/claude-haiku-5.5", "Return JSON", "Find solar installers",
            1000, 0.0, 20, client=client,
        )

    assert json.loads(result) == expected



async def test_generated_icp_fits_a_full_six_section_response(monkeypatch):
    from app.services import llm

    sections = (
        "firmographic", "technographic", "team_structure",
        "buying_signals", "compliance", "deployment_pref",
    )
    expected = {
        key: {"value": f"Commercial solar validation for {key}", "confidence": "High Confidence", "warning": None}
        for key in sections
    }
    content = json.dumps(expected)

    async def complete(model, system, prompt, max_tokens, temperature, timeout):
        return content if max_tokens >= 2000 else content[:len(content) // 2]

    monkeypatch.setattr(llm, "complete", complete)
    result = await llm.generate_structured_icp({"product_name": "Solar scheduling"})

    assert result == expected
