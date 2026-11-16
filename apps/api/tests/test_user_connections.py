"""Offline contracts: no test may use a real provider credential or transport."""
import asyncio
import json

import httpx
import pytest

from app.services import ai_providers as providers
from app.services import connections
from app.db import users


@pytest.mark.parametrize('provider,origin,path', [
    ('openai', 'api.openai.com', '/v1/chat/completions'),
    ('anthropic', 'api.anthropic.com', '/v1/messages'),
    ('gemini', 'generativelanguage.googleapis.com', '/v1beta/models/example:generateContent'),
    ('groq', 'api.groq.com', '/openai/v1/chat/completions'),
    ('openrouter', 'openrouter.ai', '/api/v1/chat/completions'),
    ('deepseek', 'api.deepseek.com', '/chat/completions'),
])
async def test_generation_uses_selected_provider_native_contract(provider, origin, path):
    def respond(request):
        assert request.url.host == origin and request.url.path == path
        assert 'secret-key' not in str(request.url)
        body = json.loads(request.content)
        if provider == 'anthropic':
            assert body['system'] == 'system' and body['max_tokens'] == 99
            assert request.headers['x-api-key'] == 'secret-key'
            return httpx.Response(200, json={'content': [{'type': 'text', 'text': 'answer'}]})
        if provider == 'gemini':
            assert body['systemInstruction']['parts'][0]['text'] == 'system'
            assert body['generationConfig']['maxOutputTokens'] == 99
            return httpx.Response(200, json={'candidates': [{'content': {'parts': [{'text': 'answer'}]}}]})
        assert body['model'] == 'example'
        if provider == 'openrouter':
            assert body['provider']['allow_fallbacks'] is False
        return httpx.Response(200, json={'choices': [{'message': {'content': 'answer'}}]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        assert await providers.generate(provider, 'secret-key', 'example', 'system', 'user', 99, 0.2, 30, client=client) == 'answer'


async def test_strict_metadata_policy_does_not_contact_provider():
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: pytest.fail('metadata billing not reviewed'))) as client:
        result = await providers.inspect('openai', 'secret-key', client=client)
    assert result['verification']['state'] == 'verification_unsupported'
    assert result['models'] == [] and result['discovery_status'] == 'unavailable'


def test_unknown_capabilities_disabled_and_explicit_nontext_excluded():
    assert providers.normalize_model('openai', {'id': 'unknown-new-model'})['eligible'] is False
    assert providers.normalize_model('openrouter', {'id': 'image', 'architecture': {'input_modalities': ['text'], 'output_modalities': ['image']}}) is None
    model = providers.normalize_model('openrouter', {'id': 'vendor/text', 'architecture': {'input_modalities': ['text', 'image'], 'output_modalities': ['text']}})
    assert model['eligible'] and model['access'] == 'unconfirmed'


async def test_missing_connection_never_uses_operator_key():
    token = connections.current_connection.set(None)
    try:
        with pytest.raises(connections.ConnectionRequired):
            await connections.complete('primary', 'system', 'user', 80, 0.2, 10)
    finally:
        connections.current_connection.reset(token)


async def test_owner_credentials_and_model_roles_isolated(db, monkeypatch):
    from app.core.security_crypto import encrypt_secret
    for name in ('alice', 'bob'):
        await users.insert_user({'_id': name, 'ai_connection': {'provider': 'groq', 'key_encrypted': encrypt_secret(name), 'primary_model': name + '-primary', 'fast_model': name + '-fast'}})

    async def generate(provider, key, model, *args, **kw):
        await asyncio.sleep(0)
        return f'{key}:{model}'

    monkeypatch.setattr(providers, 'generate', generate)

    async def run(owner):
        async with connections.owner_scope(owner):
            return await connections.complete('fast', 's', 'u', 10, 0.2, 10)

    assert await asyncio.gather(run('alice'), run('bob')) == ['alice:alice-fast', 'bob:bob-fast']
    assert connections.current_connection.get() is None


async def test_tour_terminal_state_and_legacy_not_enrolled(db):
    from app.services.onboarding import new_tour, progress
    uid, _ = await users.insert_user({'onboarding': new_tour()})
    first = await progress(uid, 'in_progress', 0, 0)
    assert first['revision'] == 1
    completed = await progress(uid, 'completed', 5, 1)
    assert completed['state'] == 'completed'
    stale = await progress(uid, 'in_progress', 1, 1)
    assert stale == completed
    old, _ = await users.insert_user({'email': 'legacy@example.com'})
    assert (await progress(old, 'in_progress', 0, 0))['state'] == 'ineligible'


async def test_stale_explicit_dismissal_wins_over_nonterminal_progress(db):
    from app.services.onboarding import new_tour, progress
    uid, _ = await users.insert_user({'onboarding': new_tour()})
    await progress(uid, 'in_progress', 0, 0)
    await progress(uid, 'in_progress', 2, 1)
    dismissed = await progress(uid, 'dismissed', 1, 1)
    assert dismissed['state'] == 'dismissed' and dismissed['revision'] == 3


async def test_serper_save_does_not_search(db, monkeypatch):
    from app.api import users as endpoint
    from app.schemas.users import SerperKeyUpdate
    uid, doc = await users.insert_user({'email': 'key@example.com'})
    monkeypatch.setattr(httpx.AsyncClient, 'post', lambda *a, **k: pytest.fail('Saving must not search'))
    status = await endpoint.set_serper_key(SerperKeyUpdate(serper_api_key='secret-serper-key'), doc)
    assert status.has_key
    stored = await users.get_user_by_id(uid)
    assert stored['serper_api_key_encrypted'] != 'secret-serper-key'


@pytest.mark.parametrize('code,state', [(401, 'rejected_credentials'), (403, 'insufficient_permissions'), (429, 'rate_limited'), (503, 'temporarily_unavailable')])
async def test_metadata_distinguishes_errors_without_echoing_keys(code, state, monkeypatch):
    monkeypatch.setitem(providers.METADATA_POLICIES, 'anthropic', 'test-reviewed-policy')
    def respond(request):
        assert request.method == 'GET' and request.url.path == '/v1/models'
        return httpx.Response(code, json={'error': 'echo-secret-key'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await providers.inspect('anthropic', 'echo-secret-key', client=client)
    assert result['verification']['state'] == state
    assert 'echo-secret-key' not in json.dumps(result)


async def test_anthropic_pagination_and_deduplication(monkeypatch):
    monkeypatch.setitem(providers.METADATA_POLICIES, 'anthropic', 'test-reviewed-policy')
    def respond(request):
        after = request.url.params.get('after_id')
        assert request.method == 'GET' and request.headers['x-api-key'] == 'test-key'
        return httpx.Response(200, json={'data': [{'id': 'claude-example' if not after else 'claude-next', 'type': 'model'}],
                                        'has_more': not after, 'last_id': 'claude-example'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await providers.inspect('anthropic', 'test-key', client=client)
    assert [m['id'] for m in result['models']] == ['claude-example', 'claude-next']
    assert all(m['eligible'] for m in result['models'])


async def test_openrouter_public_catalogue_does_not_authenticate(monkeypatch):
    monkeypatch.setitem(providers.METADATA_POLICIES, 'openrouter', 'test-reviewed-policy')
    def respond(request):
        assert request.url.path == '/api/v1/key'
        return httpx.Response(401)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await providers.inspect('openrouter', 'test-key', client=client)
    assert result['verification']['state'] == 'rejected_credentials' and not result['models']


@pytest.fixture
async def account_api(db):
    from app.main import app
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        yield client


async def register(client, email='new@example.com'):
    result = await client.post('/api/auth/register', json={'email': email, 'password': 'Passw0rd!x', 'name': 'New', 'org_name': 'Example', 'org_domain': email.split('@')[0] + '.test'})
    assert result.status_code == 201, result.text
    return result.json(), {'Authorization': 'Bearer ' + result.json()['access_token']}


async def test_connection_lifecycle_encrypted_isolated_and_no_guessed_models(account_api, monkeypatch):
    alice, a = await register(account_api, 'alice@example.com')
    bob, b = await register(account_api, 'bob@example.com')
    base = '/api/users/me/ai-connection'
    saved = await account_api.put(base, headers=a, json={'provider': 'openai', 'api_key': 'alice-secret-key'})
    assert saved.status_code == 200, saved.text
    assert 'alice-secret-key' not in saved.text and 'key_encrypted' not in saved.text
    stored = await users.get_user_by_id(alice['user']['id'])
    assert stored['ai_connection']['key_encrypted'] != 'alice-secret-key'
    assert (await account_api.get(base, headers=b)).json()['has_key'] is False
    revision = saved.json()['revision']
    guessed = await account_api.put(base, headers=a, json={'provider': 'openai', 'primary_model': 'guessed', 'revision': revision})
    assert guessed.status_code == 422
    async def metadata(*args, **kwargs):
        return {'models': [{'id': 'discovered', 'eligible': True}], 'verification': {'state': 'authenticated'}, 'discovery_status': 'available'}
    monkeypatch.setattr(providers, 'inspect', metadata)
    refreshed = (await account_api.post(base + '/refresh', headers=a)).json()
    chosen = await account_api.put(base, headers=a, json={'provider': 'openai', 'primary_model': 'discovered', 'revision': refreshed['revision']})
    assert chosen.status_code == 200 and chosen.json()['fast_model'] == 'discovered'
    replaced = await account_api.put(base, headers=a, json={'provider': 'groq', 'api_key': 'replacement-secret', 'revision': chosen.json()['revision']})
    assert replaced.json()['models'] == [] and replaced.json()['primary_model'] is None
    stale = await account_api.put(base, headers=a, json={'provider': 'openai', 'primary_model': 'discovered', 'revision': revision})
    assert stale.status_code == 409
    assert (await account_api.delete(base, headers=a)).json()['has_key'] is False


async def test_signup_and_google_enroll_once_legacy_and_linking_do_not(account_api):
    from app.services.users import find_or_create_google_user
    created, auth = await register(account_api)
    assert created['user']['onboarding']['state'] == 'eligible'
    started = (await account_api.put('/api/users/me/onboarding', headers=auth, json={'state': 'in_progress', 'step': 0, 'revision': 0})).json()
    dismissed = (await account_api.put('/api/users/me/onboarding', headers=auth, json={'state': 'dismissed', 'step': 2, 'revision': started['revision']})).json()
    assert dismissed['state'] == 'dismissed'
    uid, linked = await find_or_create_google_user('google-1', 'new@example.com', 'Linked')
    assert linked['onboarding']['state'] == 'dismissed'
    uid, google = await find_or_create_google_user('google-2', 'google@example.com', 'Google')
    assert google['onboarding']['state'] == 'eligible'
    await users.update_user(uid, {'onboarding': {**google['onboarding'], 'state': 'completed'}})
    _, returning = await find_or_create_google_user('google-2', 'google@example.com', 'Google')
    assert returning['onboarding']['state'] == 'completed'


async def test_stale_metadata_cannot_restore_disconnected_secret(account_api, monkeypatch):
    _, auth = await register(account_api)
    base = '/api/users/me/ai-connection'
    await account_api.put(base, headers=auth, json={'provider': 'openai', 'api_key': 'secret-test-key'})
    async def metadata(*args, **kwargs):
        await account_api.delete(base, headers=auth)
        return {'models': [], 'verification': {'state': 'authenticated'}, 'discovery_status': 'empty'}
    monkeypatch.setattr(providers, 'inspect', metadata)
    assert (await account_api.post(base + '/refresh', headers=auth)).status_code == 409
    assert (await account_api.get(base, headers=auth)).json()['has_key'] is False


async def test_validation_never_echoes_secret(account_api):
    _, auth = await register(account_api)
    response = await account_api.put('/api/users/me/ai-connection', headers=auth,
                                     json={'provider': 'openai', 'api_key': 's3cr3t!'})
    assert response.status_code == 422 and 's3cr3t!' not in response.text


async def test_background_owner_reloaded_after_disconnect(db):
    from app.core.security_crypto import encrypt_secret
    uid, doc = await users.insert_user({'ai_connection': {'provider': 'groq', 'key_encrypted': encrypt_secret('old-key'), 'primary_model': 'chat'}})
    inherited = connections.current_connection.set(connections.connection_from_user(doc))
    try:
        await users.update_user(uid, {'ai_connection': None})
        @connections.bind_owner
        async def background(user_id):
            return await connections.complete('primary', 's', 'u', 10, 0.2, 10)
        with pytest.raises(connections.ConnectionRequired):
            await background(uid)
        assert connections.current_connection.get()['api_key'] == 'old-key'
    finally:
        connections.current_connection.reset(inherited)


async def test_background_pipeline_missing_ai_fails_before_search(db, monkeypatch):
    from app.db.models import TABLES
    from app.services import leads
    uid, _ = await users.insert_user({'name': 'No connection'})
    rid = await TABLES['requests'].insert({'user_id': uid, 'status': 'Pending'})
    async def pipeline(*args):
        pytest.fail('Missing AI setup must stop before pipeline search')
    monkeypatch.setattr(leads, 'run_lead_pipeline', pipeline)
    await leads.run_pipeline_background(rid, {}, uid)
    row = await TABLES['requests'].get(_id=rid)
    assert row['status'] == 'Failed' and 'Account' in row['failure_reason']


def test_explicit_nontext_metadata_overrides_reference():
    assert providers.normalize_model('openai', {'id': 'gpt-4o', 'input_modalities': ['audio']}) is None


async def test_gemini_pages_and_repeated_cursor_failure(monkeypatch):
    monkeypatch.setitem(providers.METADATA_POLICIES, 'gemini', 'test-reviewed-policy')
    def respond(request):
        return httpx.Response(200, json={'models': [{'name': 'models/new', 'supportedGenerationMethods': ['generateContent']}], 'nextPageToken': 'same'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = await providers.inspect('gemini', 'test-key', client=client)
    assert result['discovery_status'] == 'unavailable'


def test_batch_scoring_never_uses_operator_credentials(monkeypatch):
    from app.waterfall import claude_scoring
    monkeypatch.setenv('CLAUDE_BATCH_SCORING', 'true')
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'operator-secret')
    token = connections.current_connection.set(None)
    try:
        with pytest.raises(claude_scoring.Disabled):
            claude_scoring._client()
    finally:
        connections.current_connection.reset(token)


def test_batch_scoring_uses_selected_model():
    from app.waterfall import claude_scoring
    token = connections.current_connection.set({'provider': 'anthropic', 'api_key': 'owner-key', 'primary_model': 'primary', 'fast_model': 'owner-fast'})
    try:
        requests = claude_scoring.build_requests([{'_id': 'lead'}], 'ICP')
        assert requests[0]['params']['model'] == 'owner-fast'
    finally:
        connections.current_connection.reset(token)
