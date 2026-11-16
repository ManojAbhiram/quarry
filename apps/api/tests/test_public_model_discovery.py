"""Public discovery is useful without authenticating or transmitting the saved key."""
import json

import httpx
import pytest

from app.services import ai_providers as providers


PUBLIC_MODELS = {'data': [
    {'id': 'vendor/text', 'name': 'Text model', 'architecture': {'input_modalities': ['text', 'image'], 'output_modalities': ['text']},
     'context_length': 128000, 'top_provider': {'max_completion_tokens': 4096}, 'supported_parameters': ['response_format'],
     'pricing': {'prompt': '0.000001', 'completion': '0.000002'}},
    {'id': 'vendor/embedding', 'architecture': {'input_modalities': ['text'], 'output_modalities': ['embeddings']}},
    {'id': 'vendor/image', 'architecture': {'input_modalities': ['text'], 'output_modalities': ['image']}},
    {'id': 'vendor/unknown'},
]}


async def test_default_openrouter_discovery_is_anonymous_and_keeps_credentials_unverified():
    paths = []
    def respond(request):
        paths.append(request.url.path)
        assert request.method == 'GET'
        assert request.url.host == 'openrouter.ai' and request.url.path == '/api/v1/models'
        assert 'authorization' not in request.headers and 'cookie' not in request.headers
        assert 'sentinel-saved-secret' not in str(request.url) and not request.content
        return httpx.Response(200, json=PUBLIC_MODELS)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await providers.inspect('openrouter', 'sentinel-saved-secret', client=client)
    assert paths == ['/api/v1/models']
    assert result['discovery_status'] == 'available'
    assert result['verification']['state'] == 'verification_unsupported'
    assert result['verification']['checked_at'] is None
    assert result['verification']['inference_tested'] is False
    assert 'sentinel-saved-secret' not in json.dumps(result)
    assert [m['id'] for m in result['models']] == ['vendor/text', 'vendor/unknown']
    assert result['models'][0]['eligible'] and result['models'][0]['access'] == 'unconfirmed'


async def test_unsupported_verification_does_not_fetch_catalogue_or_contact_identity():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail('Verification must make no call'))) as client:
        result = await providers.inspect('openrouter', 'sentinel-key', client=client, verify_only=True)
    assert result['verification']['state'] == 'verification_unsupported'


@pytest.mark.parametrize('status', [401, 403, 429, 503, 302])
async def test_public_catalogue_failure_never_falls_back_to_sending_credentials(status):
    calls = []
    def respond(request):
        calls.append(request)
        assert 'authorization' not in request.headers
        return httpx.Response(status, headers={'Location': 'https://other.example/'}, json={'error': 'unavailable'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await providers.inspect('openrouter', 'saved-key', client=client)
    assert len(calls) == 1
    assert result['discovery_status'] == 'unavailable'
    assert result['verification']['state'] == 'verification_unsupported'


async def test_user_can_refresh_select_save_and_verify_without_losing_public_models(account_api, monkeypatch):
    from tests.test_user_connections import register
    _, auth = await register(account_api)
    base = '/api/users/me/ai-connection'
    saved = await account_api.put(base, headers=auth, json={'provider': 'openrouter', 'api_key': 'sentinel-user-key'})
    assert saved.status_code == 200
    choices = {p['id']: p for p in saved.json()['providers']}
    assert choices['openrouter']['metadata_available']
    assert not choices['openai']['metadata_available']
    original = providers.inspect
    def respond(request):
        assert request.url.path == '/api/v1/models' and request.method == 'GET'
        assert 'authorization' not in request.headers
        return httpx.Response(200, json=PUBLIC_MODELS)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        async def inspect(*args, **kwargs):
            return await original(*args, **kwargs, client=client)
        monkeypatch.setattr(providers, 'inspect', inspect)
        refreshed = (await account_api.post(base + '/refresh', headers=auth)).json()
        assert refreshed['discovery_status'] == 'available'
        selected = await account_api.put(base, headers=auth, json={'provider': 'openrouter', 'primary_model': 'vendor/text', 'revision': refreshed['revision']})
        assert selected.status_code == 200 and selected.json()['ready']
        checked = (await account_api.post(base + '/verify', headers=auth)).json()
        assert checked['verification']['state'] == 'verification_unsupported'
        assert checked['primary_model'] == checked['fast_model'] == 'vendor/text'
        assert checked['discovery_status'] == 'available' and checked['ready']


@pytest.fixture
async def account_api(db):
    from app.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        yield client


async def test_anonymous_discovery_strips_inherited_client_credentials_and_cookies():
    def respond(request):
        for header in ('authorization', 'cookie', 'x-api-key', 'x-goog-api-key'):
            assert header not in request.headers
        return httpx.Response(200, json=PUBLIC_MODELS)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond), auth=('inherited', 'password'),
                                headers={'X-API-Key': 'inherited-key'}, cookies={'session': 'inherited-cookie'}) as client:
        result = await providers.inspect('openrouter', 'saved-key', client=client)
    assert result['discovery_status'] == 'available'
