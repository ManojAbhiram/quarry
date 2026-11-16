"""Authenticated account connections. No upstream calls occur on save or disconnect."""
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.core.security_crypto import encrypt_secret, decrypt_secret, mask_secret
from app.db.models import TABLES
from app.services.auth import get_current_user
from app.services import ai_providers, onboarding

router = APIRouter(prefix='/users/me', tags=['connections'])
Provider = Literal['openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'deepseek']


class ConnectionUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: Provider
    api_key: str | None = Field(default=None, min_length=8, max_length=1024)
    primary_model: str | None = Field(default=None, max_length=256)
    fast_model: str | None = Field(default=None, max_length=256)
    revision: str | None = None


class TourUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    state: Literal['in_progress', 'completed', 'dismissed']
    step: int = Field(ge=0, le=5)
    revision: int = Field(ge=0)


def connection_status(user):
    connection = user.get('ai_connection')
    providers = [{'id': key, 'name': value['name'],
                  'metadata_available': key in ai_providers.METADATA_POLICIES or key in ai_providers.PUBLIC_CATALOGUE_POLICIES,
                  'verification_available': key in ai_providers.METADATA_POLICIES,
                  'public_catalogue': key in ai_providers.PUBLIC_CATALOGUE_POLICIES}
                 for key, value in ai_providers.PROVIDERS.items()]
    if not connection:
        return {'has_key': False, 'providers': providers, 'models': [], 'verification': None}
    key = decrypt_secret(connection['key_encrypted'])
    return {key: value for key, value in connection.items() if key != 'key_encrypted'} | {
        'has_key': bool(key), 'masked': mask_secret(key) if key else None, 'providers': providers,
        'ready': bool(key and connection.get('primary_model')),
    }


@router.get('/ai-connection')
async def get_connection(user=Depends(get_current_user)):
    return connection_status(user)


@router.put('/ai-connection')
async def save_connection(body: ConnectionUpdate, user=Depends(get_current_user)):
    def update(doc):
        old = doc.get('ai_connection') or {}
        if body.revision != old.get('revision'):
            raise HTTPException(409, 'Connection changed. Reload settings and try again.')
        if body.api_key is not None:
            key = body.api_key.strip()
            if len(key) < 8 or any(c.isspace() for c in key):
                raise HTTPException(422, 'Enter an API key without spaces.')
            if body.primary_model or body.fast_model:
                raise HTTPException(422, 'Save the key, refresh models, then select your models.')
            connection = {'provider': body.provider, 'key_encrypted': encrypt_secret(key), 'primary_model': None,
                          'fast_model': None, 'models': [], 'discovery_status': 'not_started',
                          'verification': {'state': 'unverified', 'checked_at': None, 'inference_tested': False,
                                           'message': 'Saved securely. Credentials have not been checked.'}}
        else:
            if not old or old.get('provider') != body.provider:
                raise HTTPException(422, 'Enter a key for this provider first.')
            eligible = {m['id'] for m in old.get('models', []) if m['eligible']}
            if body.primary_model not in eligible or (body.fast_model and body.fast_model not in eligible):
                raise HTTPException(422, 'Choose compatible models from this connection’s refreshed catalogue.')
            connection = {**old, 'primary_model': body.primary_model, 'fast_model': body.fast_model or body.primary_model}
        return {'ai_connection': {**connection, 'revision': uuid4().hex}}
    updated = await TABLES['users'].modify(str(user['_id']), update)
    return connection_status(updated)


@router.post('/ai-connection/refresh')
async def refresh_connection(user=Depends(get_current_user)):
    return await _inspect_connection(user, verify_only=False)


@router.post('/ai-connection/verify')
async def verify_connection(user=Depends(get_current_user)):
    return await _inspect_connection(user, verify_only=True)


async def _inspect_connection(user, *, verify_only):
    old = user.get('ai_connection')
    if not old:
        raise HTTPException(409, 'Save a provider key first.')
    metadata = await ai_providers.inspect(old['provider'], decrypt_secret(old['key_encrypted']), verify_only=verify_only)

    def update(doc):
        active = doc.get('ai_connection')
        if not active or active['revision'] != old['revision']:
            raise HTTPException(409, 'Connection changed during refresh. Reload settings.')
        if verify_only:
            return {'ai_connection': {**active, 'verification': metadata['verification'], 'revision': uuid4().hex}}
        eligible = {m['id'] for m in metadata['models'] if m['eligible']}
        primary = active.get('primary_model') if active.get('primary_model') in eligible else None
        fast = active.get('fast_model') if active.get('fast_model') in eligible else None
        # Transient failure does not erase the last successful catalogue or selections.
        if metadata['discovery_status'] == 'unavailable':
            metadata.pop('models')
            primary, fast = active.get('primary_model'), active.get('fast_model')
        return {'ai_connection': {**active, **metadata, 'primary_model': primary, 'fast_model': fast, 'revision': uuid4().hex}}
    updated = await TABLES['users'].modify(str(user['_id']), update)
    return connection_status(updated)


@router.delete('/ai-connection')
async def disconnect(user=Depends(get_current_user)):
    updated = await TABLES['users'].update(str(user['_id']), {'ai_connection': None})
    return connection_status(updated)


@router.get('/onboarding')
async def get_onboarding(user=Depends(get_current_user)):
    return onboarding.tour_for(user)


@router.put('/onboarding')
async def update_onboarding(body: TourUpdate, user=Depends(get_current_user)):
    return await onboarding.progress(str(user['_id']), body.state, body.step, body.revision)
