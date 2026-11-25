from app.db.models import TABLES
from app.services import request_intake_service


PAYLOAD = {
    "product_name": "Solar scheduling",
    "product_category": "Scheduling",
    "one_liner": "Scheduling for installers",
    "deployment_model": "SaaS",
    "primary_value_prop": "Coordinate installation crews",
    "pricing_model": "Seat",
    "existing_competitors": "",
    "deal_size_acv": "",
    "target_geographies": "US",
    "product_description": "A scheduling application",
}


async def test_generate_icp_only_accesses_an_owned_request(api, signup, monkeypatch):
    owner, _ = await signup("icp-owner@example.com")
    other, _ = await signup("icp-other@example.com")
    draft = await api.post("/api/requests", headers=owner, json={"name": "Owned draft"})
    assert draft.status_code == 201
    request_id = draft.json()["id"]

    async def generate(_payload):
        return {
            "firmographic": "Solar installers", "technographic": "Scheduling software",
            "team_structure": "Installation managers", "buying_signals": "New operations team",
            "compliance": "None specified", "deployment_pref": "Cloud",
        }

    monkeypatch.setattr(request_intake_service, "generate_structured_icp", generate)
    path = "/api/requests/generate-icp"
    for candidate in (request_id, "missing"):
        response = await api.post(path, params={"request_id": candidate}, headers=other, json=PAYLOAD)
        assert response.status_code == 404
        assert not await TABLES["icp_profiles"].get(request_id=candidate)

    own_response = await api.post(path, params={"request_id": request_id}, headers=owner, json=PAYLOAD)
    assert own_response.status_code == 200
    assert (await TABLES["icp_profiles"].get(request_id=request_id))["firmographic"]["value"] == "Solar installers"
