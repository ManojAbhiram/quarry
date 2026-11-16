# Personal API connections rollout

## Account flow

1. Open Account. Save a Serper key to enable requested searches. Saving stores it encrypted and leaves it unverified; it never performs a search.
2. Choose an AI provider and save its key. Replacing the provider/key clears model selections, discovery results and verification.
3. For OpenRouter, refresh models using its documented anonymous public catalogue; your saved key is not sent. Credential inspection remains unsupported and performs no call. The other providers' protected metadata operations stay deferred, never falling back to generation or search.
4. Search the discovered catalogue and choose an eligible primary model and optional fast model. Unknown-capability entries are disabled. Fast defaults to primary. Public catalogue access does not authenticate your key or establish model entitlement, account preferences or remaining credits.
5. Save model choices. Explicit research/extraction requests use the selected provider directly and may consume provider credits. There are no automatic inference retries or cross-provider fallbacks.
6. Disconnect to remove the stored credential, catalogue and selections. Already dispatched requests may finish; queued/background work reloads the owner's current configuration.

Keys are encrypted using the existing application SECRET_KEY. No plaintext keys are stored in browser persistence, queued job payloads or environment variables. Keep SECRET_KEY stable and back up the database before production changes.

## Reviewed metadata boundary

`app/services/ai_providers.py` keeps authenticated `METADATA_POLICIES` empty. OpenRouter has a separate `PUBLIC_CATALOGUE_POLICIES` entry for its documented headerless model-list endpoint. That request cannot use the saved connection key's credits because the transport never sends the key, authentication or cookies. This is a technical account-credit isolation conclusion, not an explicit vendor guarantee that all metadata calls are free.

**OpenRouter setup can now finish and explicit AI work can use its selected models.** No test generation is required; the key may still be rejected during an explicitly requested AI task. Verify credentials is disabled with an explanation, and the verification API performs no call or catalogue reset. New connections default to the provider with enabled discovery. Other providers clearly explain that model setup is deferred.

Enable protected metadata only after reviewing its specific endpoint's billing documentation and recording the evidence, or after explicit product-owner approval to relax the restriction. See [provider metadata policy](provider-metadata-policy.md) for sources, exact enabled/disabled routes and the distinction between public discovery and credential verification. Tests injecting protected policies are isolated fixtures, not production approval.

The supported fixed API bases are OpenAI `/v1`, Anthropic `/v1`, Gemini `/v1beta`, Groq `/openai/v1`, OpenRouter `/api/v1` and DeepSeek's root API. Anthropic and Gemini use native protocols. Custom URLs and arbitrary headers are not accepted. Metadata unknowns remain unknown; exact compatibility references only apply to IDs actually returned by discovery. References are deliberately small and need maintenance as providers evolve.

## First-signup tour

New password and Google user records get explicit eligibility. Existing records, normal login and Google account linking never create or reset it. Six stops introduce workspace activity, requests, lead lists, outreach/watch, connections and workspace management. Progress uses account-owned revision checks; completed/dismissed states cannot be reopened by stale tabs.

Refresh can restore an active session. A later session offers Resume. Closing or skipping dismisses the automatic introduction. Finishing does not configure services or create a request; the final Create a request action only opens the normal form. No provider discovery, search, export, outreach or billing action runs during the tour. Persistence errors keep a locally closed tour closed for that session and offer retry. Local session markers contain no credentials and are scoped by account ID.

## ModelPort assessment

[ModelPort](https://github.com/ManojAbhiram/ModelPort) is useful prior art for explicit provider contracts, capability provenance, public versus authenticated catalogues, protected metadata verification, fixed destinations and offline transport tests. Its [types](https://github.com/ManojAbhiram/ModelPort/blob/main/packages/core/src/types.ts) and [provider contracts](https://github.com/ManojAbhiram/ModelPort/blob/main/docs/PROVIDERS.md) informed this design; no source code was copied.

Its SDK is a TypeScript local single-user workbench with process-memory connections and per-attempt approvals. Quarry needs Python adapters, durable encrypted account settings and existing authenticated job ownership, so embedding that runtime would introduce a service boundary without supplying these requirements. Its provider coverage also does not establish metadata billing guarantees. Quarry does not adopt the workbench's media operations, arbitrary local endpoints or per-generation approval ceremony.

## Validation boundaries

Use mocked transports for the six inference contracts, metadata errors/pagination, capability eligibility, encryption, account isolation, stale refreshes, disconnects and worker scope. UI tests cover password entry, deferred setup, disabled unknown models, tour completion/resume/dismissal and failed persistence. Live account entitlements, credits and provider protocol compatibility are not established by these offline checks.

Optional Claude batch scoring also requires the user's Anthropic connection and selected fast/primary model. The feature flag controls availability, not credentials; batch collection is restricted to batches submitted by that Quarry account. Previous batches created with an operator key are not automatically imported.
