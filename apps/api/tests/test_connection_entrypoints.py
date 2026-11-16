"""Exercise credential scopes at authenticated/worker and HTTP transport boundaries."""
import asyncio

import httpx

from app.core.security_crypto import encrypt_secret
from app.db import users
from app.services import ai_providers, connections, serper


async def add_owner(owner):
    return await users.insert_user({
        '_id': owner, 'email': owner + '@example.com', 'name': owner,
        'serper_api_key_encrypted': encrypt_secret(owner + '-search'),
        'ai_connection': {'provider': 'groq', 'key_encrypted': encrypt_secret(owner), 'primary_model': owner + '-model'},
    })


async def test_concurrent_authenticated_calls_bind_both_owner_keys_and_reset(db, monkeypatch):
    from app.main import app
    from app.services.auth import create_access_token
    for owner in ('alice', 'bob'):
        await add_owner(owner)

    async def generate(provider, key, model, *args):
        await asyncio.sleep(0)
        assert model == key + '-model'
        assert serper.get_serper_key() == key + '-search'
        return key
    monkeypatch.setattr(ai_providers, 'generate', generate)

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as api:
        async def call(owner):
            response = await api.post('/api/requests/suggest-chip', json={'chip_type': 'pain_points'},
                                      headers={'Authorization': 'Bearer ' + create_access_token(owner)})
            assert response.status_code == 200, response.text
            assert response.json()['suggestion'] == owner
            assert connections.current_connection.get() is None
            assert serper.current_serper_key.get() is None
        await asyncio.gather(call('alice'), call('bob'))


async def test_worker_uses_owner_keys_and_restores_inherited_context_on_failure(db):
    from app import jobs
    await add_owner('worker-owner')
    seen = []
    async def handler(payload):
        seen.append((connections.current_connection.get()['api_key'], serper.get_serper_key()))
        raise jobs.PermanentJobError('Deliberate scope cleanup check')
    jobs.register_handler('test.connection_scope', handler)
    job_id = await jobs.enqueue('test.connection_scope', {}, owner_id='worker-owner')
    inherited = {'api_key': 'inherited-user'}
    ai_token = connections.current_connection.set(inherited)
    search_token = serper.current_serper_key.set('inherited-search')
    try:
        await jobs._execute(await jobs.get_job(job_id))
        assert seen == [('worker-owner', 'worker-owner-search')]
        assert connections.current_connection.get() is inherited
        assert serper.get_serper_key() == 'inherited-search'
        assert (await jobs.get_job(job_id))['status'] == jobs.FAILED
    finally:
        connections.current_connection.reset(ai_token)
        serper.current_serper_key.reset(search_token)


async def test_failed_refresh_preserves_selected_catalogue_and_advances_revision(db, monkeypatch):
    from app.api.connections import refresh_connection
    uid, doc = await add_owner('refresh-owner')
    model = {'id': 'refresh-owner-model', 'eligible': True}
    saved = {**doc['ai_connection'], 'models': [model], 'fast_model': model['id'], 'revision': 'before'}
    await users.update_user(uid, {'ai_connection': saved})
    async def unavailable(*args, **kwargs):
        return {'models': [], 'discovery_status': 'unavailable', 'verification': {'state': 'temporarily_unavailable'}}
    monkeypatch.setattr(ai_providers, 'inspect', unavailable)
    result = await refresh_connection(await users.get_user_by_id(uid))
    assert result['models'] == [model]
    assert result['primary_model'] == result['fast_model'] == model['id']
    assert result['ready'] and result['revision'] != 'before'


async def test_batch_transport_uses_owner_key_and_encodes_batch_path(monkeypatch):
    from app.waterfall import claude_scoring
    calls = []
    def respond(request):
        assert request.headers['x-api-key'] == 'batch-owner-key'
        assert request.url.host == 'api.anthropic.com' and not request.url.query
        calls.append((request.method, request.url.raw_path))
        if request.method == 'POST':
            return httpx.Response(200, json={'id': 'batch/part'})
        if request.url.raw_path.endswith(b'/results'):
            return httpx.Response(200, text='{"custom_id":"lead"}\n')
        return httpx.Response(200, json={'processing_status': 'ended'})
    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    monkeypatch.setenv('CLAUDE_BATCH_SCORING', 'true')
    monkeypatch.setattr(claude_scoring.ports, 'client', None)
    token = connections.current_connection.set({'provider': 'anthropic', 'api_key': 'batch-owner-key', 'primary_model': 'owner-model'})
    try:
        client = claude_scoring._client()
        batch_id = await client.create([])
        assert (await client.status(batch_id))['processing_status'] == 'ended'
        assert await client.results(batch_id) == [{'custom_id': 'lead'}]
        assert calls == [('POST', b'/v1/messages/batches'), ('GET', b'/v1/messages/batches/batch%2Fpart'),
                         ('GET', b'/v1/messages/batches/batch%2Fpart/results')]
    finally:
        connections.current_connection.reset(token)
