# Quarry Test Strategy and Quality Assurance

[Documentation index](../README.md)

| | |
|---|---|
| **Document** | What is tested, how, and what is still unverified |
| **Document revision** | 1.1 |
| **Last reviewed** | 2026-11-18 |

---

# 1. Quality goals

1. No regression in the core flow: describe an ICP, get leads, export.
2. Prevent cross-tenant access and unsafe outbound fetches.
3. Failures are visible to the user with a reason, never silent.
4. Every external service can be faked, so tests are fast, deterministic and independent of provider accounts.

# 2. Test pyramid

| Level | Tooling | Execution | What it covers |
|---|---|---|---|
| Backend unit and integration | pytest | CI and local runs | Pipeline, jobs, scoring, exports, LLM failure paths, auth and CSRF, ownership, SSRF, migrations, provider usage, outreach, watch, waterfall, compliance |
| Frontend component and page | Vitest and Testing Library | CI and local runs | Pages, dialogs, forms, states, accessibility behaviors |
| Static analysis | ruff, eslint | CI and local runs | Style and common defects |
| Build | `vite build` | CI and local runs | The production bundle compiles |
| Browser QA | Manual and scripted passes | Two passes recorded | Real flows in a browser; findings logged in `TODOS.md` |
| End-to-end against live services | None automated | n/a | **Gap**, see section 6 |

# 3. How the suite is built

* `tests/conftest.py` seeds throwaway environment variables, so no real credentials are ever used.
* The `db` fixture gives every test a fresh SQLite file.
* **All external calls are mocked or faked**: LLM, Serper, page fetches, SMTP, IMAP, CRM, enrichment
  providers. Each integration sits behind a port (an HTTP client protocol or a `CrmConnector`), and
  tests inject a fake.
* The frontend mocks the API module and asserts on roles, labels and visible states, not implementation details.
* CI (`.github/workflows/ci.yml`) runs on pull requests and configured push events: ruff, pytest, eslint, vitest and the web build.

# 4. Coverage map

| Area | Evidence (test modules) |
|---|---|
| Authentication, cookies, CSRF, refresh rotation | `test_auth_cookies.py`, `tests/db/test_identity.py` |
| Ownership and request hardening | `test_flow_hardening.py`, `tests/db/test_hardening.py`, `test_dependencies.py` |
| Pipeline end to end | `test_pipeline.py` |
| LLM failure handling and retry | `test_llm_failures.py` |
| Scoring and exports | `test_scoring_and_export.py` |
| Durable jobs: retry, backoff, cancel, recovery | `test_jobs.py` |
| SSRF guard, DNS pinning, redirects, MX | `test_url_guard.py`, `_pinning`, `_mx`, `_careers`, `_tech_stack`, `_other_fetchers` |
| Database layer and migrations | `tests/db/*` including `test_migrations.py` |
| Email verification statuses, provenance, region, cost and usage, compliance | `tests/phase2/*` |
| Outreach logic, footer, flow, mailbox connection, watch, waterfall, integrations | `tests/p3/*` |
| Teams, request creation, CRM, invite email, background work | `tests/growth/*` |
| Deployment environment | `test_deployment_env.py` |
| Personal AI and Serper keys, encryption, revisions, disconnect | `test_user_connections.py` |
| Six direct provider protocols, anonymous discovery, capability eligibility | `test_user_connections.py` |
| Concurrent user scopes, background reload and cleanup, missing connections | `test_connection_entrypoints.py` |
| New-account introduction, eligibility, terminal progress | `test_user_connections.py` |
| Account connection and introduction UI | `AIConnectionSettings.test.jsx`, `Profile.test.jsx`, `WelcomeTour.test.jsx`, `AuthContext.test.jsx` |
| Frontend pages and dialogs | `*.test.jsx` beside each page, including mailbox test connection and regression tests |

Test totals change as coverage grows. Use the current pytest and Vitest output or CI artifacts for counts and pass/fail status; historical totals in implementation records are not a current quality signal. Mocked transports establish application contracts, not live provider compatibility, account entitlement, or remaining credits.

# 5. Defect history and lessons

Browser QA passes found issues that mocked tests did not. Each was fixed and, where possible, covered by a test.

| Finding | Lesson |
|---|---|
| A development database had a schema mismatch that caused HTTP 500 responses | `create_all` never alters tables: added the versioned migration runner and a unique-table-name test |
| A mailbox with an unreachable host saved without any check | Added "Test connection" before saving |
| Team invite blocked the request about 4 seconds while SMTP was tried | Send in the background and return an `email_status` |
| Error toasts covered the primary button of the form above | Toasts moved to the top |
| Dialog action buttons scrolled out of view on short screens | Sticky dialog footer |

# 6. Known gaps (not yet verified)

| Gap | Risk | Plan |
|---|---|---|
| Real-service coverage: the full pipeline with a live Serper key, request details and the lead drawer with real leads, email verification providers, outbound SMTP and IMAP, HubSpot, the live cost estimate and sample run | Mocks can drift from real provider behavior | A scripted smoke run per integration before hosting; record results |
| Shared requests and lists with two members in one workspace | The "Shared with" sections were only checked with one member | Two-account test, automated if possible |
| LLM extraction accuracy | Hallucinated or wrong contacts | Build a labelled set of 100 to 200 leads; track precision and bounce rate |
| Run duration and cost under load | Unknown capacity | Time real runs; record p50 and p95 |
| No browser end-to-end suite | UI regressions between releases | Add Playwright smoke tests for sign-up, launch, results, export |
| No load or soak test | Single-writer behavior under concurrency | A small concurrent-launch test |
| No external security test or dependency scan | Unknown vulnerabilities | `pip-audit`, `npm audit` in CI; pen test before hosting |
| Accessibility audit | Contrast of accents and status chips unchecked | Run an automated and manual audit across the seven palettes |

# 7. Release gate

A change may merge when:

1. `ruff` and `eslint` are clean.
2. `pytest` and `vitest` pass in CI.
3. `vite build` succeeds.
4. A schema change ships with a migration and a migration test.
5. A bug fix ships with a regression test that fails without the fix.
6. User-facing changes have been checked in a browser at desktop and phone width.

# 8. Manual test checklist (pre-release)

| Flow | Steps | Expected |
|---|---|---|
| Sign-up and login | Register, log out, log in, Google sign-in | Cookies set; protected pages load; logout clears them |
| Personal connections | Save Serper and OpenRouter keys; refresh catalogue; select/save models; replace/disconnect | No search or inference on save; catalogue is anonymous; key replacement clears selections; unsupported verification preserves them |
| Introduction | New password/Google signup, skip/finish, refresh, later resume, legacy login, stale tab | Six stops; account-owned progress; no automatic search, generation, request creation, or re-enrollment |
| Launch a run | Configure personal keys/models, then wizard, estimate, launch | 202, live progress, results appear, status Completed |
| Failure visible | Use a bad Serper key | Request Failed with a reason; partial leads kept |
| Enrichment retry | Force an LLM failure, press Retry | Lead updates in place |
| Export | CSV, XLSX, PDF from a request and a list | Files open; source-notice line present; suppressed contacts absent |
| Suppression | Add an address, enroll and export | Skipped at send and export |
| Outreach | Connect and test a mailbox, preflight, sequence, enroll, reply | Sends inside the window and cap; reply stops the contact |
| Unsubscribe | Open the footer link | Suppression entry and audit record created |
| Usage | Launch a run and open Account | Monthly runs, calls and estimated provider cost are shown |
| Team | Invite, accept, change role, share a list | Role limits enforced; teammate sees shared items |
| CRM | Connect HubSpot, push a list | 202 job; per-lead sync status updates |
| Erasure | Erase a person | Removed everywhere; audit entry written |
| Responsive | 1280x720 and phone width | No clipped actions; dialogs keep their footer visible |
