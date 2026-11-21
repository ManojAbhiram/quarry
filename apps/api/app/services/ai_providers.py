"""Direct provider protocols. Metadata never performs inference or follows redirects.

Billing approval is deliberately separate from the existence of a metadata endpoint.
See docs/superpowers/plans/2026-11-16-user-api-connections.md.
"""
from datetime import datetime, timezone
from urllib.parse import quote

import httpx
import re

PROVIDERS = {
    'openai': {'name': 'OpenAI', 'base': 'https://api.openai.com/v1'},
    'anthropic': {'name': 'Anthropic / Claude', 'base': 'https://api.anthropic.com/v1'},
    'gemini': {'name': 'Google Gemini', 'base': 'https://generativelanguage.googleapis.com/v1beta'},
    'groq': {'name': 'Groq', 'base': 'https://api.groq.com/openai/v1'},
    'openrouter': {'name': 'OpenRouter', 'base': 'https://openrouter.ai/api/v1'},
    'deepseek': {'name': 'DeepSeek', 'base': 'https://api.deepseek.com'},
}

# Empty until endpoint-specific non-billable documentation has been reviewed.
# A GET method, a price table for tokens, or ModelPort support is not that evidence.
METADATA_POLICIES: dict[str, str] = {}

# Separate from authenticated metadata: this reviewed provider-documented route
# accepts anonymous requests, so discovery never needs the user's billing key.
# This is an account-credit isolation policy, not a promise about vendor pricing.
# Evidence and review date: docs/provider-metadata-policy.md (2026-11-16).
PUBLIC_CATALOGUE_POLICIES = {
    'openrouter': 'https://openrouter.ai/docs/guides/overview/models',
}

# Exact references establish chat protocol compatibility only for returned IDs.
# Unknown IDs remain visible and disabled. This is never a fallback catalogue.
TEXT_REFERENCES = {
    'openai': {'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano'},
    'groq': {'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'},
    'deepseek': {'deepseek-chat', 'deepseek-reasoner'},
    'anthropic': set(), 'gemini': {'models/gemini-2.5-pro', 'models/gemini-2.5-flash', 'models/gemini-2.5-flash-lite'}, 'openrouter': set(),
}


class ProviderError(Exception):
    def __init__(self, state: str):
        self.state = state
        super().__init__({
            'rejected_credentials': 'The provider rejected these credentials.',
            'insufficient_permissions': 'The provider denied permission for this operation.',
            'rate_limited': 'The provider is throttling requests. Try again later.',
            'temporarily_unavailable': 'The provider is temporarily unavailable.',
            'invalid_response': 'The provider returned an unsupported response.',
        }.get(state, 'The provider could not complete this request.'))


def headers(provider: str, key: str) -> dict:
    if provider == 'anthropic':
        return {'x-api-key': key, 'anthropic-version': '2023-06-01'}
    if provider == 'gemini':
        return {'x-goog-api-key': key}
    return {'Authorization': f'Bearer {key}'}


async def _request(client, method, url, *, anonymous=False, **kwargs):
    try:
        if anonymous:
            # Also strip inherited client auth/cookies; never upgrade an anonymous
            # catalogue request to an authenticated request after an error.
            request = client.build_request(method, url, **kwargs)
            for name in ('authorization', 'cookie', 'x-api-key', 'x-goog-api-key', 'proxy-authorization'):
                request.headers.pop(name, None)
            response = await client.send(request, auth=None, follow_redirects=False)
        else:
            response = await client.request(method, url, follow_redirects=False, **kwargs)
        if not 200 <= response.status_code < 300:
            state = {401: 'rejected_credentials', 403: 'insufficient_permissions', 429: 'rate_limited'}.get(
                response.status_code, 'temporarily_unavailable')
            raise ProviderError(state)
        if len(response.content) > 16 * 1024 * 1024:
            raise ProviderError('invalid_response')
        return response.json()
    except (httpx.HTTPError, ValueError):
        # Never surface a URL, request header or provider body (may echo a secret).
        raise ProviderError('temporarily_unavailable') from None


def normalize_model(provider: str, raw: dict) -> dict | None:
    identifier = raw.get('id') or raw.get('name')
    if not isinstance(identifier, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,255}', identifier):
        return None
    if raw.get('active') is False or raw.get('status') in ('retired', 'inactive'):
        return None
    architecture = raw.get('architecture') or {}
    inputs = raw.get('input_modalities') or architecture.get('input_modalities')
    outputs = raw.get('output_modalities') or architecture.get('output_modalities')
    if (inputs is not None and (not isinstance(inputs, list) or 'text' not in inputs)) or (outputs is not None and (not isinstance(outputs, list) or 'text' not in outputs)):
        return None
    operations = raw.get('supportedGenerationMethods') or raw.get('supported_operations')
    source = 'unknown'
    eligible = False
    if inputs is not None and outputs is not None:
        if 'text' not in inputs or 'text' not in outputs:
            return None
        eligible, source = True, 'provider'
    elif provider == 'anthropic' and raw.get('type') == 'model':
        # Native Models API enumerates Claude models for the native Messages API.
        inputs, outputs, eligible, source = ['text'], ['text'], True, 'provider'
    elif identifier in TEXT_REFERENCES[provider]:
        inputs, outputs, eligible, source = ['text'], ['text'], True, 'reference'
    if provider == 'gemini' and operations is not None and 'generateContent' not in operations:
        return None
    if provider in ('openai', 'groq') and identifier not in TEXT_REFERENCES[provider] and not (raw.get('capabilities') or {}).get('completion_chat'):
        eligible, source = False, 'unknown'
    if provider == 'gemini' and (not operations or 'generateContent' not in operations):
        eligible, source = False, 'unknown'
    if operations is not None and provider != 'gemini' and not set(operations).intersection({'text', 'chat', 'chat.completions', 'messages'}):
        return None
    if provider == 'openrouter' and (identifier in ('openrouter/auto', 'openrouter/free') or identifier.endswith(':online')):
        return None
    return {
        'id': identifier, 'display_name': raw.get('displayName') or raw.get('display_name') or raw.get('name') or identifier,
        'provider': provider, 'input_modalities': inputs, 'output_modalities': outputs,
        'supported_operations': ['text'] if eligible else [], 'eligible': eligible,
        'capability_source': source, 'context_limit': raw.get('context_length') or raw.get('context_window') or raw.get('inputTokenLimit'),
        'output_limit': raw.get('max_output_tokens') or raw.get('outputTokenLimit'),
        'json_support': None, 'lifecycle': raw.get('status', 'unknown'),
        'price': raw.get('pricing'), 'access': 'unconfirmed',
    }


async def inspect(provider: str, key: str, *, client=None, verify_only=False) -> dict:
    if provider not in PROVIDERS:
        raise ValueError('Unsupported provider')
    result = {
        'verification': {'state': 'verification_unsupported', 'checked_at': None,
                         'message': 'Non-billable metadata policy has not been established. No provider call performed.',
                         'inference_tested': False},
        'discovery_status': 'unavailable', 'models': [], 'catalog_warning': None,
    }
    authenticated_metadata = provider in METADATA_POLICIES
    public_catalogue = provider in PUBLIC_CATALOGUE_POLICIES
    if public_catalogue and not authenticated_metadata:
        result['verification']['message'] = (
            'Credential verification is unavailable. Public catalogue requests do not send your API key; '
            'no generation performed.'
        )
    if not authenticated_metadata and (verify_only or not public_catalogue):
        return result
    if client is None:
        async with httpx.AsyncClient(timeout=30) as transport:
            return await inspect(provider, key, client=transport, verify_only=verify_only)
    base = PROVIDERS[provider]['base']
    auth = headers(provider, key)
    try:
        if provider == 'openrouter' and authenticated_metadata:
            identity = await _request(client, 'GET', base + '/key', headers=auth)
            if not isinstance(identity.get('data'), dict):
                raise ProviderError('invalid_response')
            if verify_only:
                result['verification'] = {
                    'state': 'authenticated', 'checked_at': datetime.now(timezone.utc).isoformat(),
                    'message': 'Credentials accepted; no generation performed. Model access and credits remain unconfirmed.',
                    'inference_tested': False,
                }
                return result
        models, seen, cursor = [], set(), None
        for _ in range(10):
            params = {}
            if provider == 'gemini':
                params = {'pageSize': 100, **({'pageToken': cursor} if cursor else {})}
            elif provider == 'anthropic':
                params = {'limit': 100, **({'after_id': cursor} if cursor else {})}
            elif provider == 'openrouter':
                params = {'output_modalities': 'text'}
            data = await _request(client, 'GET', base + '/models', headers={} if public_catalogue else auth,
                                  params=params, anonymous=public_catalogue)
            entries = data.get('models' if provider == 'gemini' else 'data')
            if not isinstance(entries, list):
                raise ProviderError('invalid_response')
            for entry in entries[:1000 - len(models)]:
                if isinstance(entry, dict):
                    model = normalize_model(provider, entry)
                    if model and model['id'] not in {m['id'] for m in models}:
                        models.append(model)
            next_cursor = data.get('nextPageToken') if provider == 'gemini' else data.get('last_id') if data.get('has_more') else None
            if not next_cursor:
                break
            if not isinstance(next_cursor, str) or len(next_cursor) > 512 or next_cursor in seen or key in next_cursor:
                raise ProviderError('invalid_response')
            seen.add(next_cursor)
            cursor = next_cursor
        else:
            result['catalog_warning'] = 'Catalogue truncated at ten pages. Refresh cannot reveal further pages.'
        result.update(models=models, discovery_status='available' if models else 'empty')
        if authenticated_metadata:
            result['verification'] = {
                'state': 'authenticated', 'checked_at': datetime.now(timezone.utc).isoformat(),
                'message': 'Credentials accepted; no generation performed. Model access and credits remain unconfirmed.',
                'inference_tested': False,
            }
        else:
            result['verification']['message'] = (
                'Public model catalogue loaded without sending your API key. '
                'Credentials have not been checked; no generation performed.'
            )
    except ProviderError as exc:
        if authenticated_metadata:
            result['verification'].update(state=exc.state, message=str(exc))
        else:
            result['catalog_warning'] = (
                'Public catalogue requests are rate limited. Try again later.' if exc.state == 'rate_limited'
                else 'The public model catalogue is unavailable. No credentials were sent. Try again later.'
            )
        result['discovery_status'] = 'unavailable'
    except (TypeError, AttributeError, KeyError):
        if authenticated_metadata:
            result['verification'].update(state='temporarily_unavailable', message='Unsupported metadata response. Try again later.')
        else:
            result['catalog_warning'] = 'Unsupported public catalogue response. Credentials have not been checked.'
    return result


async def generate(provider, key, model, system, prompt, max_tokens, temperature, timeout, *, client=None):
    if client is None:
        async with httpx.AsyncClient(timeout=timeout) as transport:
            return await generate(provider, key, model, system, prompt, max_tokens, temperature, timeout, client=transport)
    base = PROVIDERS[provider]['base']
    if provider == 'anthropic':
        path = '/messages'
        body = {'model': model, 'system': system, 'messages': [{'role': 'user', 'content': prompt}], 'max_tokens': max_tokens, 'temperature': temperature}
    elif provider == 'gemini':
        identifier = model.removeprefix('models/')
        path = '/models/' + quote(identifier, safe='') + ':generateContent'
        body = {'systemInstruction': {'parts': [{'text': system}]}, 'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
                'generationConfig': {'maxOutputTokens': max_tokens, 'temperature': temperature}}
    else:
        path = '/chat/completions'
        body = {'model': model, 'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}],
                'max_completion_tokens' if provider == 'openai' else 'max_tokens': max_tokens, 'temperature': temperature}
        if provider == 'openrouter':
            body.update(modalities=['text'], provider={'allow_fallbacks': False})
    data = await _request(client, 'POST', base + path, headers=headers(provider, key), json=body)
    try:
        if provider == 'anthropic':
            return ''.join(block['text'] for block in data['content'] if block.get('type') == 'text')
        if provider == 'gemini':
            return ''.join(part.get('text', '') for part in data['candidates'][0]['content']['parts'] if not part.get('thought'))
        return data['choices'][0]['message']['content'] or ''
    except (KeyError, IndexError, TypeError):
        raise ProviderError('invalid_response') from None
