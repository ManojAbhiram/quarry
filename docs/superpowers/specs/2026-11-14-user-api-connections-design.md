# User API connections and first-signup onboarding

> **Historical record.** Retained for design context. Descriptions, proposed steps, and validation results below reflect the original work and may differ from the current implementation. Use the [documentation index](../../README.md) for current product behavior.

Status: historical design proposal; see Personal API Connections for implemented behavior. The six direct providers are selected; a short full-application tour is selected; detailed tour behavior below remains a design proposal. No product implementation is included in this document update.

## Intent
Users supply their own LLM and Serper credentials through Profile. Application calls must never silently use operator credentials from .env. Newly registered users receive a first-time introduction that explains connections, model selection and the lead-generation workflow.

## Current findings
- LLM completions in apps/api/app/services/llm.py use LiteLLM with global model and fallback settings.
- Serper already has authenticated save, validate, masked-status and delete endpoints and encrypted user storage.
- Serper service still falls back to settings.SERPER_API_KEY; config requires that key at startup.
- Request intake and several pipeline entry points already load user Serper credentials.

## Approaches
1. Direct provider integrations (selected by the user): reuse encrypted user settings and call each provider directly through its official SDK or documented HTTP API. Quarry owns authentication, discovery, capability mapping and response normalization.
2. LiteLLM adapters: reduce integration code, but add an abstraction dependency; not selected.
3. A hosted gateway: adds another service and credential-routing dependency; not selected.

## Selected direct-provider implementation

| Provider | Fetch models from provider | Connection method |
|---|---|---|
| OpenAI | Yes | Direct official SDK or HTTP API |
| Anthropic / Claude | Yes | Direct native Messages API and Models API |
| Google Gemini | Yes | Direct native generateContent and Models API |
| Groq | Yes | Direct Groq SDK or documented HTTP API |
| OpenRouter | Yes | Direct OpenRouter HTTP API |
| DeepSeek | Yes | Direct DeepSeek HTTP API |

OpenAI-compatible request shapes at Groq, OpenRouter or DeepSeek do not imply routing through OpenAI: send credentials and requests directly to the selected provider's official origin. A shared HTTP transport is acceptable; provider authentication, capability handling and errors stay explicit.

Each adapter implements model discovery, metadata-only credential verification where supported, and text generation. Normalize generation output into the existing Quarry text/JSON helpers so extraction and enrichment callers retain their contracts. Pass the selected user's credentials explicitly and map primary/fast workload roles to their saved model selections. Implement JSON output, token limits and system prompts according to each provider's supported protocol rather than assuming identical parameters. Remove the LiteLLM dependency only after auditing all imports and migrating every runtime caller.

Verification and discovery remain separate operations. Preserve the no-cost verification restrictions in Connection behavior; direct integration does not by itself establish a provider billing guarantee.

## Shared connection requirements
- Profile provides provider, primary model, optional fast model, password-style API key entry, metadata-only credential verification, model refresh, save and disconnect. Preserve existing Serper controls with the verification changes below.
- Implement direct provider adapters for exactly OpenAI, Anthropic / Claude, Google Gemini, Groq, OpenRouter and DeepSeek. Replace LiteLLM in the LLM call path; do not route these connections through LiteLLM or an intermediary gateway. Use provider-returned model identifiers.
- Store secrets encrypted server-side using existing crypto helpers. Return connection metadata and masked keys only. Never persist keys in browser storage or modify process environment per user.
- Bind credentials to authenticated user/request scope; reload and bind the owner credentials in background work. Audit every LLM/Serper entry point, including scoring and enrichment.
- Explicitly pass selected credentials/model to calls; remove global provider fallbacks and fail with actionable setup messages when credentials are missing.
- Serper no longer requires an operator key at startup and never falls back to it.
- Use fixed official API origins for the six supported providers. Custom endpoints and additional providers are future extensions; they require endpoint validation against internal/private destinations, URL credentials and unsafe redirects before release.
- Preserve graceful JSON parsing for providers without native JSON-object support. Sanitize provider errors to avoid leaking credentials.
- Verify user isolation, missing-key failures, disconnect behavior, credential encryption/masking, background execution and provider routing with mocked transports; verify frontend settings behavior and build.

## Limits
Initial support covers the six listed direct providers. Custom endpoints, Mistral, Azure OpenAI, Bedrock, Vertex AI and other providers are outside this implementation scope; add them through explicit adapters later. No live paid calls using user credentials during implementation without explicit authorization.

## Connection behavior

### Provider breadth
Use direct provider SDKs or documented HTTP APIs for inference, authentication and discovery; LiteLLM is not part of the proposed runtime. Build a Quarry-owned registry separating inference protocol, authentication, model discovery, capability normalization and verification policy. Register the six providers in the table above; future providers require an explicit adapter. Azure/Bedrock/Vertex cannot be represented honestly by a universal API-key field: deployment, region, project or identity credentials may be required. Do not expose arbitrary SDK keyword arguments or arbitrary headers to clients.

### User model selection
Discover models from the provider on connection and on explicit refresh; handle pagination. Store exact provider-returned identifiers. Users select a primary model and optionally a fast model for the existing primary/mini workload split. Default fast to primary. No hidden cross-provider fallback. Clear selections on connection changes and invalidate verification when credentials or endpoint change.

Normalize: id, display name, source provider, input/output modalities, supported operations, context/output limits, JSON capabilities, lifecycle status, and optional published price. Unknown metadata stays unknown. Display every eligible discovered model in a searchable picker; do not maintain a fixed list of model names. A public catalogue is not an account entitlement list. Prefer account-filtered discovery when available; mark access unconfirmed otherwise. Cache only per connection/user, never share authenticated catalogues between users.

Eligibility: accept text input AND generate text using a protocol supported by Quarry. Multimodal models accepting text remain eligible. Exclude embedding-only, reranking, moderation-only, image/video/audio generation and speech-only models. Prefer structured outputs and adequate context for extraction/classification/summarization. Metadata supports compatibility assessment, not a guarantee of model quality. When metadata is sparse, show capability unknown rather than claiming compatibility based only on model names. Proposed conservative rule: display such models disabled until reliable provider metadata or a reviewed provider capability mapping establishes text-generation compatibility; do not run a paid probe to classify them. For the initial six providers, populate selections from provider discovery. Manual model IDs for custom servers are a future extension, not an initial fallback to a hardcoded catalogue.

### Verification with no inference spend
The documented non-billable endpoint policy also applies to automatic model discovery and every onboarding metadata call. If its billing behavior is not established, do not call it automatically; explain that discovery is unavailable and allow setup to be deferred.

Verification never calls completion, messages, responses, embedding, generation, search or batch-creation endpoints, even with max_tokens=0 or 1. No automatic paid fallback. Only provider adapters with a reviewed, documented non-billable metadata/authentication route may advertise cost-free verification; GET alone is not evidence that an endpoint is free. Custom providers with unknown billing policies remain unverified. The consulted API reference pages establish metadata operations, but do not consistently give explicit billing guarantees; verify provider billing documentation before enabling a zero-cost claim.

Separate credential status, discovery status and model compatibility. States: authenticated, rejected credentials, insufficient permissions, temporarily unavailable, verification unsupported. A timeout/429/403 must not be flattened into invalid key. Public catalogues cannot authenticate a connection. Authenticated metadata success does not prove inference permission, remaining credit, regional availability or output quality. UI should say 'Credentials accepted; no generation performed' rather than 'Model tested'. Persist a verification timestamp tied to the connection configuration; no plaintext secrets in responses or logs.

### Provider evidence
- Anthropic GET /v1/models lists models, supports pagination and uses provider authentication: https://platform.claude.com/docs/en/api/models/list
- Gemini GET /v1beta/models exposes supported functionality and token limits. Filter supportedGenerationMethods for generateContent and use modality information when available; method support alone is insufficient to exclude every image/audio model: https://ai.google.dev/api/models
- Groq publishes authenticated model discovery at https://api.groq.com/openai/v1/models; active list includes non-chat workloads, so discovery requires capability filtering: https://console.groq.com/docs/models
- DeepSeek GET /models supplies available models and optional capability metadata: https://api-docs.deepseek.com/api/list-models/
- OpenRouter GET /api/v1/key authenticates the current key separately from its models catalogue: https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
- OpenRouter model metadata supports modality filtering and also documents an account-preference-filtered model listing: https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties
- LiteLLM was evaluated as an alternative and is not selected for the new runtime.

### Serper consequence
Current validate_serper_key performs a real search. That can consume search credits. Do not describe the existing verification as free. No documented no-charge Serper verification route was established in this research. Proposed behavior: save Serper keys without a test search and mark them unverified until the first explicitly requested search succeeds, unless a documented free account/auth endpoint is established. Apply this consistently in Profile and onboarding.

### Required verification tests
Assert verification invokes only approved metadata endpoints and never inference/search, handles all pages and provider errors, does not authenticate via a public catalogue, preserves unknown capabilities, excludes unsuitable workloads, scopes discovery/credentials to the owner, invalidates stale status after edits, and propagates selected primary/fast models into requests and background jobs. Use mocked provider responses; no real paid calls.




## First-signup tour

### Confirmed intent
Automatically introduce Quarry after a user creates an account, only on their first signup. Do not automatically show the tour to existing accounts or restart it on normal login.

### Selected direction
A brief full-application tour, selected by the user. API connections are one part of the introduction, not its main purpose. Aim for about 60-90 seconds of reading across six compact stops. Do not require users to fill forms, connect services or create data to advance.

Alternatives considered: a guided API setup would help configure services but would not cover the whole product; a separate stop for every screen would be too long. Group related features into six stops and link to deeper settings after the tour.

### Proposed flow
| Stop | What the user learns | UI anchor |
|---|---|---|
| 1. Your workspace | Requests tracks discovery runs; Dashboard shows workspace activity and results. | Requests and Dashboard navigation |
| 2. Find companies and people | New request supports an ideal customer profile or a supplied company list. Request details show progress, companies, decision makers and enrichment. | New request action and Requests navigation |
| 3. Organize your leads | Review results, save leads into Lead lists, and export when ready. | Lead lists navigation |
| 4. Follow up and monitor | Outreach is where follow-up work lives; Watch monitors saved targets and signals. | Outreach and Watch navigation |
| 5. Connect your tools | Integrations and CRM integrations connect external tools. Account/Profile holds the user's Serper and LLM keys and model choices. These must be configured before work that needs them. | Integrations, CRM integrations and Account navigation |
| 6. Manage your workspace | Team manages membership, Billing shows plan and usage, and Compliance provides privacy controls. Finish with Explore Quarry or Create a request. | Team, Billing and Compliance navigation |

Keep each stop to one or two short sentences. Highlight grouped navigation anchors without forcing navigation through every page. Explain request results without requiring an existing request or inventing production data. Adapt descriptions to actual shipped features and permissions; hide inaccessible sections rather than promising access.

No setup forms or model fetching run as part of the tour. An optional Open settings action ends the tour and opens the normal settings flow; it does not make setup part of tour completion. Never launch generation, search, outreach, monitoring, exports or billing changes automatically. Creating a request after finishing remains an explicit user action.

### Meaning of first time
Proposed persistence is per user account, stored server-side, independent of browser storage and organization membership.

- Initialize tour eligibility explicitly only when a new user record is created after rollout, including new Google accounts. Returning Google users and account linking must not reset it.
- Missing onboarding state on existing accounts means ineligible; never infer newness from empty requests or absent keys.
- Keep eligibility separate from connection readiness. Removing a key later does not restart onboarding.
- Proposed states: eligible, in_progress, completed, dismissed. Store a tour version and last step alongside timestamps.
- Begin once automatically. Refresh can restore an active tour; an interrupted tour on a later session offers a quiet Resume action rather than relaunching automatically.
- Skip tour or closing the tour permanently dismisses its automatic appearance. Next advances the explanation without requiring setup. Finishing the explanation completes the tour even when connections are not configured.
- Completion and dismissal are terminal for automatic display. Version changes must not re-enroll users automatically. A future Help action may replay it only when explicitly requested.
- Authenticated, owner-scoped progress updates must be idempotent; stale tabs cannot overwrite completed/dismissed state with an earlier step. Synchronize tabs where feasible and suppress stale overlays after checking server state.
- If persistence fails, keep the tour closed locally for the active session, offer a retry, and do not claim the dismissal was saved across devices. No provider keys belong in progress state.

### Interaction and accessibility
Keep the tour short and skippable, with Back, Next, progress indication and descriptive actions. Reuse the app's typography, spacing, controls and light/dark themes. Restore focus after closing, support keyboard navigation and Escape, respect reduced motion, and make dialogs readable on mobile. Wait for routes and target elements before highlighting; use an inline explanation when a target does not exist rather than trapping the user behind an overlay. Preserve unsaved form input during navigation where practical; never persist plaintext keys in browser storage.

### Existing integration points
- Signup currently authenticates and navigates to the app; the default authenticated destination is /lead-requests.
- GoogleCallback loads /users/me before navigating to /lead-requests; new-account eligibility must originate on the server, not in the callback URL.
- AuthContext restores users from /users/me. Expose safe onboarding state through the user response or an authenticated onboarding endpoint.
- The authenticated Layout is the proposed tour host. Route-specific steps must not interfere with login, password reset, OAuth callbacks or invite acceptance.
- Profile owns the existing Serper form. NewRequest/CreateLeadRequest and request details supply workflow destinations. Audit actual account creation paths before implementation.

## Acceptance criteria

### Connections
- All six providers receive calls directly; LiteLLM and operator provider-key fallbacks are absent from migrated runtime paths.
- Each user sees provider-fetched model choices and their own masked connection status only.
- Primary and fast selections reach text/JSON helpers, enrichment, scoring, scheduled work and background jobs under the owning user's credentials.
- Ineligible models are excluded using capability evidence; unknown capabilities and uncertain access remain visible as unknown.
- Verification never performs generation, embeddings, search or batch creation. A provider without an established non-billable verification route reports verification unsupported.
- Test pagination, empty catalogues, expired keys, permissions, throttling, outages, disconnects and stale verification. Mock provider requests; no live paid verification tests.

### Tour
- A newly created password or Google account is eligible exactly once; returning and legacy accounts are not enrolled.
- Completion/dismissal persists across logout, browser changes and devices once acknowledged by the server.
- Refresh, interrupted sessions, stale tabs and failed persistence follow the documented rules.
- All six stops work without keys or existing data. Completing the tour does not falsely mark connections ready.
- The short tour covers every visible application area through grouped navigation highlights; API setup is only one part. No forms or provider discovery requests run during the tour.
- The tour never spends provider credits, submits a lead request or starts a search automatically.
- Verify focus behavior, keyboard controls, reduced motion, mobile layout and missing route targets, plus frontend checks/build.

## Design status
The user selected a short full-application tour. The six-stop grouping, target reading time and interaction details are proposed for final design review. API integration requirements remain separate from tour completion.

## Implementation resolution: anonymous public discovery (2026-11-16)

OpenRouter documents headerless GET requests to `/api/v1/models`. Its public catalogue is enabled separately from authenticated metadata: Quarry strips credentials/cookies, disables redirects and never retries with the saved key. This removes exposure of the connected account's billing key during discovery; it is a technical credit-isolation conclusion, not a claim of an explicit vendor billing guarantee. See [reviewed sources and endpoint policy](../../provider-metadata-policy.md).

Public catalogue success leaves credential verification unsupported and model entitlement/account preferences unconfirmed. Users can still select discovered eligible primary/fast models, save them, and explicitly request AI work. Verify-only performs no request or catalogue reset. OpenAI, Anthropic, Gemini, Groq, DeepSeek and OpenRouter protected metadata remain disabled until billing evidence or explicit approval changes that restriction. No setup action performs inference or search.

## Delivery boundary (original design stage)
This document defines the design. Product code, schema changes and provider calls have not been implemented as part of this update. After design approval, write the implementation plan. The explanatory tour can ship independently; connection copy must describe only the settings available in that release.
