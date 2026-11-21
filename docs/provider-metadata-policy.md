# Provider Metadata Policy

[Documentation index](README.md)

Reviewed on 2026-11-16. This document records exactly which setup calls Quarry enables and why. It is not a blanket assertion that a provider's GET endpoints are free.

## Enabled: OpenRouter anonymous model discovery

OpenRouter's [Models guide](https://openrouter.ai/docs/guides/overview/models) documents headerless requests to `https://openrouter.ai/api/v1/models`, including `output_modalities=text`. Its [model-list reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) describes the returned model metadata. These are catalogue operations, not inference operations.

Quarry permits only this public discovery path without authentication. It never attaches the saved API key, cookies, inherited client authentication, or credentials in query parameters/body. It disables redirects and never retries with authentication after an error. This establishes isolation from the connected account's billing credentials: a public request cannot spend credits using the saved connection key because that key is never transmitted. This is a technical conclusion from the documented anonymous contract and the enforced transport boundary, not an endpoint-specific contractual billing guarantee from OpenRouter.

The initial design's provider-credit restriction remains in place. This public-only path removes the credential exposure needed to spend the user's connected-provider credits; it does not enable authenticated metadata calls on the strength of HTTP method or model token prices. Public catalogue access is not evidence that the entered key is valid, funded, permitted to run a selected model, or compatible with account privacy/provider preferences.

| Operation | Enabled | Credential behavior | Status evidence |
| --- | --- | --- | --- |
| OpenRouter GET `/api/v1/models?output_modalities=text` | Yes, on explicit Refresh models | Anonymous; no saved key, auth headers, or cookies | Public catalogue retrieved; credentials/access unconfirmed |
| OpenRouter GET `/api/v1/key` | No | No request | Verification unsupported |
| OpenRouter account-filtered model discovery | No | No request | Not reviewed for the strict billing rule |
| Any inference, embedding, batch creation or search during setup | No | No request | Never used for verification/discovery |

The [current-key reference](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) and [limits guide](https://openrouter.ai/docs/api/reference/limits) document protected credential inspection. They do not establish an explicit endpoint-specific non-billable guarantee in the material reviewed here, so Quarry does not call `/key` during setup. The API's Verify action returns unsupported without fetching the catalogue or erasing already discovered models/selections. The UI disables unsupported verification and explains the distinction.

## Deferred: protected discovery and verification

| Provider | Reviewed discovery contract | Current outcome |
| --- | --- | --- |
| OpenAI | [GET `/v1/models`](https://developers.openai.com/api/reference/resources/models/methods/list) | Deferred; no documented anonymous discovery or explicit non-billable metadata guarantee established |
| Anthropic | [GET `/v1/models`](https://platform.claude.com/docs/en/api/models/list) | Deferred under the same restriction |
| Google Gemini | [GET `/v1beta/models`](https://ai.google.dev/api/models) | Deferred under the same restriction |
| Groq | [Authenticated model list](https://console.groq.com/docs/models) | Deferred under the same restriction |
| DeepSeek | [GET `/models`](https://api-docs.deepseek.com/api/list-models/) | Deferred under the same restriction |

Provider pricing pages, free inference tiers and success with a model-list request do not independently prove an authenticated metadata billing guarantee. Keys for deferred providers may be saved securely, but model selection remains unavailable. No setup call uses Serper search credits.

To enable protected metadata later, record its endpoint-specific billing evidence in `METADATA_POLICIES`, or obtain explicit product-owner approval to relax this requirement and change the notice accordingly. `PUBLIC_CATALOGUE_POLICIES` is a separate allowlist for documented anonymous discovery. Tests injecting a protected policy are fixtures, not production approval.

## Tests and limits

Offline tests cover successful anonymous discovery, account-owned save/refresh/model selection, unverified credential status, all failure classes without credential fallback, redirects, inherited auth/cookies, and verify-only preservation of catalogue/selections. The public catalogue can be smoke-tested anonymously without any user key; this does not establish live inference compatibility or a user's entitlements. No pasted or stored user credential is used for that check.
