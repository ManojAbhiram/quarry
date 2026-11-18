# User API Connections Implementation Plan

> **Historical record.** Retained for design context. Descriptions, proposed steps, and validation results below reflect the original work and may differ from the current implementation. Use the [documentation index](../../README.md) for current product behavior.


**Goal:** Implement encrypted per-user direct AI connections and a first-signup application tour.

**Architecture:** Python HTTP adapters own six fixed provider origins, metadata normalization, and generation. Request and durable-worker scopes bind the owner's credentials; user JSON records store encrypted connections and atomic tour progress. React Profile hosts settings; Layout hosts the tour.

**Tech Stack:** FastAPI, httpx, SQLAlchemy document storage, React, Vitest, pytest.

**Spec:** [Personal connections design](../specs/2026-11-14-user-api-connections-design.md)

## Reference and decisions

ModelPort's types and provider contracts separate discovery, credential acceptance, and capability evidence. Reuse these concepts, not its local single-user TypeScript runtime or per-inference approval workflow. No external code is copied. Reviewed https://github.com/ManojAbhiram/ModelPort/blob/main/packages/core/src/types.ts and https://github.com/ManojAbhiram/ModelPort/blob/main/docs/PROVIDERS.md on 2026-11-16.

Metadata billing guarantees are not established by ModelPort. Default metadata policy remains blocked until a reviewed non-billable policy exists or the user authorizes relaxing that design restriction. Unsupported verification makes no upstream call. Save without model selections permits deferred setup, never generation with guessed IDs.

## Tasks

- [x] 1. Add regression tests for metadata safety, provider protocol serialization, capability filtering, encryption/ownership, and tour eligibility/terminal updates. Run with `apps/api/.venv/Scripts/python.exe -m pytest` (from apps/api use `.venv/Scripts/python.exe`). Confirm failures before implementation.
- [x] 2. Create `app/services/ai_providers.py` for provider registry, normalized model metadata, paginated discovery and sanitized direct text generation; create `app/services/connections.py` for connection loading and context binding. All protocols use explicit keys and fixed origins; native Anthropic/Gemini requests remain native. Unknown capabilities are disabled, exact reviewed capability references apply only to discovered IDs.
- [x] 3. Create authenticated `/users/me/ai-connection` endpoints in `app/api/connections.py`: safe status, encrypted save, metadata refresh, verify, disconnect. Persist configuration revision to reject stale metadata updates; model choices must belong to that connection's discovered eligible catalogue.
- [x] 4. Migrate LLM callers to primary/fast roles; remove LiteLLM retries/fallbacks/dependency. Bind users in auth and workers; refresh owner credentials for background work and clear context in finally. Remove Serper operator fallback and save-time search. Prove missing connections fail before outbound calls.
- [x] 5. Add new-account tour state to password and Google creation; legacy users stay ineligible. Add authenticated progress endpoint using transactional modify and revisions; completed/dismissed states cannot regress. Expose only safe state in UserOut.
- [x] 6. Build `pages/profile/AIConnectionSettings.jsx` with provider/password inputs, searchable primary/fast selectors, separate metadata status, refresh/verify/save/disconnect, stale-response protection and deferred setup. Add `components/onboarding/WelcomeTour.jsx` with six grouped stops, focus containment/restoration, Escape, no automatic provider calls, refresh restoration, quiet resume and cross-tab synchronization. Reuse theme and navigation anchors.
- [x] 7. Run backend suite, frontend suite, lint and build; review diff and document evidence, provider metadata limits, and any remaining gaps. No paid calls, deploy, push or unrelated commits.

## Review focus

Credentials never leave fixed origins or appear in responses/errors; public catalogues do not authenticate. Unknown models never become selectable by name heuristics. Disconnect and edits invalidate stale discovery. New Google accounts enroll once; legacy/linking/login never enroll. Stale tabs cannot reopen a terminal tour. Worker owner identity overrides inherited request context.

## Execution record

### Follow-up: public discovery (2026-11-16)

The metadata blocker is resolved for OpenRouter using a documented anonymous model catalogue, separately allowlisted from protected metadata. Its official Models guide includes headerless curl examples. The transport strips inherited auth and cookies, disables redirects, and never retries with credentials. The saved connection key cannot be used to bill these catalogue requests because it is never sent. This is a technical account-credit isolation conclusion, not an unsupported vendor billing guarantee. Protected metadata and credential verification remain disabled for all six providers; the other five providers remain deferred.

Verification and discovery now have separate API actions. Verify-only makes no upstream call under unsupported policy and preserves the existing catalogue/model selections. The UI defaults new connections to a provider with discovery available and explains unsupported providers and verification. No automatic generation, search or key use was added. The exposed user credential was never used or stored.

Offline regression tests cover anonymous discovery, failure-without-auth-fallback, inherited auth/cookie stripping, and the full account save/refresh/select/save/verify flow. An anonymous public smoke check retrieved 447 eligible text models without any API key; that is catalogue reachability evidence, not user credential/entitlement or inference verification. See docs/provider-metadata-policy.md for reviewed sources.

Follow-up verification: 38 focused backend tests passed; the complete backend suite finished with 514 passed, 1 skipped and the same existing missing-timezone-data failure in `test_next_window_slot_waits_for_weekday_and_open_hours`. The complete frontend suite passed all 409 tests. Production build and Ruff passed; frontend lint passed with the same 12 existing warnings. The focused independent review found no important bugs. Authenticated metadata remains deferred because the optional question about relaxing its billing restriction has no answer; no paid inference or user credential was used.

Commit/push verification: added the missing Windows `tzdata` dependency to pyproject, consistent with the existing requirements.txt entry, and refreshed uv.lock. The previously failing timezone regression passes. Full backend suite: 515 passed, 1 skipped; full frontend suite: 409 passed. Four additional tests pass for concurrent authenticated AI/Serper scopes, worker cleanup after failure, refresh failure preserving selections, and the real batch HTTP transport using owner credentials and encoded identifiers. Ruff, frontend lint (12 existing warnings), build and whitespace checks pass. Source/security and plan/docs reviews found no blockers. This record does not establish a production deployment.

### Initial implementation record

Implemented in the existing workspace at the user's request; no commits, push, migration of operator secrets, live provider calls or deployments. The original untracked spec is preserved unchanged.

Ruling: keep metadata policies disabled while billing guarantees remain undocumented. The asynchronous question about permitting metadata-only calls has not been answered. This blocks model discovery/selection for new connections and is explicitly shown in Account and documented in README and docs/user-api-connections.md. The code implementation is reviewable; a fully usable AI-provider rollout remains incomplete until this restriction is resolved.

Ruling: prompt JSON and parse gracefully, with a single inference attempt. Native JSON support is unknown for unreviewed models, so do not request an unsupported parameter or retry a potentially billed generation.

Final review found stale terminal tour updates and logout/refresh confusion. Regression tests reproduced both before fixes. Explicit terminal choices now supersede newer nonterminal progress, terminal records cannot reopen, stale automatic-start responses are suppressed, and logout clears only active tour markers. Account changes discard late responses.

Audit also migrated optional Claude batch scoring away from operator credentials/model settings and restricted batch collection to the submitting account. Disconnected background pipelines preflight AI readiness before any search and record an actionable Account-settings message.

Validation: backend full run 504 passed, 1 skipped, 1 failed (tests/p3/test_p3_outreach_logic.py::test_next_window_slot_waits_for_weekday_and_open_hours; local timezone data unavailable). After the final background preflight, the focused connection/pipeline/batch/deployment set passed 60 tests. Frontend full run passed 405 tests; after final tour/auth changes, focused Profile/connection/tour/auth coverage passed 24 tests. Ruff passed; frontend lint had no errors and 12 existing warnings. Production build passed; build reports existing bundle-size, Browserslist and PostCSS warnings. Tests establish mocked contracts, not live provider compatibility or a completed billing-policy review.
