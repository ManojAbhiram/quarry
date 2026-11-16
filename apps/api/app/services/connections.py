"""User-scoped runtime connections; plaintext exists only inside a task's scope."""
from contextlib import asynccontextmanager
from contextvars import ContextVar
from functools import wraps
from inspect import signature

from app.core.security_crypto import decrypt_secret
from app.db.users import get_user_by_id
from app.services import ai_providers

current_connection: ContextVar[dict | None] = ContextVar('ai_connection', default=None)


class ConnectionRequired(RuntimeError):
    pass


def require_connection():
    connection = current_connection.get()
    if not connection or not connection.get('primary_model'):
        raise ConnectionRequired('Connect an AI provider and choose a primary model in Account settings before continuing.')


def bind_owner(function):
    """Reload credentials for in-process background work, even after logout/disconnect."""
    parameters = signature(function)

    @wraps(function)
    async def wrapped(*args, **kwargs):
        owner = parameters.bind(*args, **kwargs).arguments['user_id']
        async with owner_scope(owner):
            return await function(*args, **kwargs)
    return wrapped


def connection_from_user(user):
    stored = (user or {}).get('ai_connection')
    if not stored:
        return None
    key = decrypt_secret(stored.get('key_encrypted') or '')
    if not key:
        return None
    return {**stored, 'api_key': key}


@asynccontextmanager
async def owner_scope(user_id):
    from app.services.serper import current_serper_key
    user = await get_user_by_id(str(user_id)) if user_id else None
    ai_token = current_connection.set(connection_from_user(user))
    encrypted = (user or {}).get('serper_api_key_encrypted')
    search_token = current_serper_key.set(decrypt_secret(encrypted) if encrypted else None)
    try:
        yield
    finally:
        current_serper_key.reset(search_token)
        current_connection.reset(ai_token)


async def complete(role, system, prompt, max_tokens, temperature, timeout):
    connection = current_connection.get()
    if not connection:
        raise ConnectionRequired('Connect an AI provider and select a model in Account settings before continuing.')
    model = connection.get('fast_model') if role == 'fast' else connection.get('primary_model')
    model = model or connection.get('primary_model')
    if not model:
        raise ConnectionRequired('Choose a compatible primary model in Account settings before continuing.')
    return await ai_providers.generate(connection['provider'], connection['api_key'], model, system, prompt, max_tokens, temperature, timeout)
