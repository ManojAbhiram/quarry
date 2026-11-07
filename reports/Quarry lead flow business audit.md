# Quarry works end to end but is not launch-ready

Quarry's happy path runs from sign-up to ICP wizard to background pipeline to results to CSV/XLSX/PDF download, and the core idea is sound. It is not yet good enough by B2B lead-generation standards to put in front of paying customers or real third-party contact data. Two areas are **blocking**: security (a header-based authentication bypass, missing ownership checks, no rate limiting) and legal/compliance (account deletion leaves third-party PII behind, and there is no suppression, opt-out or notice mechanism). Product flow, data quality and pipeline reliability **need work**. Most of the worst security items are small code fixes, so a fix-now tranche can remove the sharpest risks within days. Evidence is uneven. The flow, security and reliability findings come from a code-only audit that never ran the app. The compliance points are research notes, not legal advice, and are mostly law-firm summaries. The data-quality numbers are almost all vendor claims. This report separates what the code proves from what the outside evidence only suggests.

## Verdicts by area

| Area | Verdict | Why, in one line |
|---|---|---|
| Security | Blocking | Auth bypass via `X-User-Id`, cross-user lead access, client-writable status, no throttling, tokens in localStorage and URLs |
| Legal and compliance | Blocking for commercial launch (not legal advice) | Incomplete erasure, no suppression or opt-out, no source notice, likely data-broker status |
| Reliability | Needs work (blocking beyond a handful of users) | In-process jobs, no cancel, retry or restart recovery, no limits, no failure reasons |
| Product flow and UX | Needs work | Fake outreach button, key discovered at the last step, no cost or progress visibility |
| Data quality | Needs work | MX-only verification at pipeline time, ICP threshold never applied, no measured accuracy |

## What is already fine

Quarry has more going for it than a prototype usually does. The user brings their own Serper key, so search cost lands on the customer and not the operator. The key is encrypted at rest, masked on read and validated with a live call when saved, which matches the table-stakes pattern OWASP describes ([OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)). Whether the master key sits outside the database was not verified. Requests, lists and leads are scoped by user ID, refresh tokens are stored hashed, and unhandled errors return a generic 500. External calls have timeouts (30 s Serper, 15 s scrape, 30 s LLM), the LLM layer has fallback models and a text-mode retry, and leads are de-duplicated within a request by canonical host (`services/leads.py`, `core/` code audit). Competitors also push "paste your own keys" (Clay supports bring-your-own API keys, per [Clay University](https://university.clay.com/docs/clay-credit-conservation)), so the BYOK model is defensible and not a weakness in itself. The ICP-to-results flow is the right shape for the category, which has converged on define ICP, build list, enrich, review, hand off ([11x Amplemarket review](https://www.11x.ai/guides/amplemarket-review), competitor-authored). The target of a first result within minutes is an inference, not a cited benchmark, since no prospecting-specific time-to-value figure exists.

## Security holes: fix these before anyone else's data is in the system

These are code facts from the audit, not outside opinion, and they are listed here separately from legal exposure.

The most serious is an **authentication bypass**. The server-sent-events dependency accepts an `X-User-Id` header and authenticates as that user without a token (`api/leads.py:54-59`). The audit reads it as a leftover dev shortcut. Impact is limited to status and lead-count data and needs a known user UUID, but the pattern should not exist. Second, **cross-user access**: adding leads to a list checks list ownership but not lead ownership, and list export fetches leads by ID with no user filter (`db/lead_lists.py:101`, `db/leads.py:150`). UUIDs make exploitation need a leaked ID, but OWASP treats object-level authorization as the top API risk and says unguessable IDs are defence in depth, not the control ([OWASP API Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10)). Third, `PUT /requests/{id}` accepts any string as `status`, so a client can mark a run Completed or Failed. Fourth, there is **no rate limiting anywhere**, including login, and login messages reveal whether an email exists. OWASP expects throttling and uniform responses on login and reset flows ([OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)). Fifth, tokens live in localStorage and the access token is also sent in the SSE query string, which leaks into proxy and server logs. OWASP guidance says not to keep JWTs in localStorage ([OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)). Moving to HttpOnly cookies is a larger change that also needs CSRF handling, so it belongs in "next". Sixth, the full enriched lead payload is logged at INFO, which writes scraped third-party PII into logs. Seventh, `get_serper_key()` silently falls back to the operator's global key when the per-request context is unset, so any missed code path spends the operator's quota. The audit did not trace every caller, so the extent is unknown.

Two further items were not examined. The notes recommend a single `safe_fetch()` that blocks private and metadata IP ranges for scraped URLs ([OWASP SSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)), but the audit did not read `scraper.py`, so whether Quarry has SSRF protection is unknown. The same applies to prompt-injection handling for scraped pages. Both are open questions to check, not findings.

## Legal exposure: real, but the evidence is secondary

The notes state plainly that they are not legal advice and that few primary texts were read. With that caveat, three exposures are strong enough to act on.

First, **erasure**. `DELETE /users/me` removes the user, their requests and sessions, but leaves leads, decision-maker names, emails and LinkedIn URLs, lists, enrichments, competitor and ICP data and the organization (`api/users.py:80-85`). Deleting a request removes only the request row. A shared `companies` table is also global across users. There is no retention policy beyond cache and session expiry. Lead subjects are third parties who never signed up, so this is the largest compliance gap, and orphaned PII persisting after the owner leaves is hard to defend. The notes' security checklist makes cascading deletion a table-stakes control.

Second, **transparency and opt-out**. Regulators have fined data providers for missing source notices and unlawful onward sharing: the CNIL fined Caloga EUR 80,000 in 2025 ([CNIL](https://www.cnil.fr/en/data-brokers-caloga-fined-eu80000)), and the ICO's Experian case required notices to roughly 5.3 million people despite a "disproportionate effort" argument ([Pinsent Masons](https://www.pinsentmasons.com/out-law/analysis/experian-data-brokers-ico-enforcement-digital-advertising)). The CJEU ruled in October 2024 that purely commercial interests can qualify as a legitimate interest, which supports B2B prospecting, but the three-part test still applies ([Cornerstone Barristers](https://cornerstonebarristers.com/the-court-of-justice-of-the-european-union-decides-that-commercial-interests-can-constitute-a-legitimate-interest-under-article-61f-gdpr/)). Quarry has no suppression list, no do-not-contact ledger and no public opt-out channel. The audit did not check for a privacy notice or terms of service, so their absence is not established. Competitors treat per-record provenance, Art. 14 notices and a propagating opt-out as normal, though that comes from vendor material ([Cognism help](https://help.cognism.com/hc/en-gb/articles/34166025179666), [ZoomInfo notices PDF](https://atlas.zoominfo.com/cws/uploads/2023/06/Notifications-and-Privacy-Management-1.pdf)).

Third, **US data-broker status**. California's B2B exemption expired on 1 January 2023 ([Foley](https://www.foley.com/en/insights/publications/2022/09/ccpa-b2b-employment-information-exceptions-ending)). California brokers must process deletion requests through the DROP system every 45 days from 1 August 2026, and the first enforcement action was announced on 13 August 2026 ([CPPA](https://privacy.ca.gov/drop-for-data-brokers/), [Governor's office](https://www.gov.ca.gov/2026/08/13/icymi-california-takes-historic-action-against-data-brokers/)). Whether Quarry counts as a broker is **uncertain**. The notes' own inference is that a shared, retained, resold database makes it likely and a private per-customer processing mode is less exposed, and that was not tested. Quarry's global `companies` table pushes toward broker status. This needs a lawyer.

Smaller exposures follow. CAN-SPAM has no B2B exemption and carries penalties of up to USD 53,088 per email ([FTC](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)), but that binds the customers who send, and Quarry sends nothing. CASL and UK PECR distinctions (sole traders versus companies) argue for country and subscriber-type flags later ([ICO](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/)). India's DPDP duties are mostly not enforceable until about May 2027, per law-firm commentary ([AZB](https://www.azbpartners.com/?p=87799)), and the notes found nothing on business contact data specifically. On scraping, hiQ and Proxycurl lost on contract and fake-account facts, not on public-page scraping ([ZwillGen](https://www.zwillgen.com/alternative-data/hiq-v-linkedin-wrapped-up-web-scraping-lessons-learned/), [LinkedIn](https://news.linkedin.com/2025/LinkedInWinsLegalBattleToProtectMemberData)). Quarry pulls LinkedIn-derived data from search results, not logged-in sessions, which looks lower risk, but the notes call this unresolved. SMTP probing has no regulator guidance either way.

A separate honesty problem sits outside the privacy laws. The login page advertises "Automated outreach sequencing" and "Sequences sent", and the "Add to Outreach Sequence" button shows a success message while calling no API (`RequestDetails.jsx:3244`). That is a misleading product claim. The notes did not research the legal consequences, so treat it as a trust and consumer-protection risk, and the fix is cheap.

## Product flow, reliability and data quality

On flow, the largest gap is the last mile. Users get a file download, with no CRM push, no sequencing and no suppression. Leading products treat native HubSpot/Salesforce sync and CSV as table stakes ([Apollo KB](https://knowledge.apollo.io/hc/en-us/articles/4412668783117-Bi-Directional-Sync-Overview)). Whether a small tool must match them is a business choice, not a defect. The sharper UX problems are fixable. The Serper-key requirement surfaces only at the last wizard step, after the most effortful input. Blank wizard fields silently inject "Generic Product", "India" geography and "$20K-$50K ARR". The dashboard's "Total leads" counts requests. A run that fails shows no reason, because per-query Serper errors (invalid, exhausted or rate-limited key) are swallowed into empty results. A run can also finish "Completed" with zero enriched leads. Industry practice is a small test run first, a cost estimate, live counters and no charge for empty results ([Clay pricing](https://www.clay.com/blog/introducing-clays-new-pricing), [Cleanlist help](https://help.cleanlist.ai/en/articles/14660947-running-a-bulk-enrichment)). Quarry has no sample run, no estimate, no stage progress and no cancel. These benchmarks come from competitor and community sources, so they show direction, not a measured standard.

On reliability, jobs run as in-process FastAPI `BackgroundTasks`, which the FastAPI docs say suit small tasks ([FastAPI](https://fastapi.tiangolo.com/tutorial/background-tasks/)). There is no job table, overall timeout, retry or restart recovery, so a restart leaves a request Pending forever. Deleting a Pending request lets the task keep inserting leads for it. `num_leads` has no maximum and nothing limits concurrent pipelines per user, so one user clicking launch repeatedly multiplies load on a single SQLite writer (WAL allows one writer at a time, per [SQLite](https://www.sqlite.org/wal.html)). For a handful of design-partner users this is tolerable. For open sign-up it is not.

On data quality, the pipeline's email check is MX-only. Full SMTP probing is on demand, and cloud hosts often block port 25 (unverified). The notes show why this matters: catch-all domains are plausibly 15-35% of B2B addresses, and a plain SMTP check cannot confirm a mailbox there. These figures are vendor-sourced and **not neutral** ([Kustiq](https://kustiq.com/blog/b2b-catch-all-email-benchmark), [Anymail Finder](https://anymailfinder.com/blog/email-verifier-benchmark)). Verifier accuracy claims range from the high 90s to about 60-70% depending on test difficulty ([Hunter](https://hunter.io/email-verification-guide/best-email-verifiers)), with no neutral benchmark. The safe conclusion is to show honest labels such as Verified, Likely, Risky and Invalid, with a checked-at date, and to measure outcomes. The ~2% bounce bar is vendor guidance, not a mailbox-provider rule. Google publishes only a spam-complaint limit of 0.10% ([Google](https://support.google.com/a/answer/81126)). Quarry's ICP score threshold (60) and the filter that uses it exist but are never called, so low-fit leads pass. Direct-company runs get no match score at all. Intent analysis is keyed to list position, not lead ID, so reordering could misattribute scores. The decay figure of about 20-30% per year is repeated vendor content with original studies not located ([Landbase](https://www.landbase.com/blog/data-decay-rate-statistics)). It argues for timestamps and re-verification, not for any particular number. Academic evidence that schema-valid LLM output can still be wrong is real but comes from generic extraction and PDF tests ([ExtractBench](https://www.arxiv.org/pdf/2602.12247)). Quarry's actual extraction error rate is unmeasured.

## Prioritised change list

| Tier | Change | Basis |
|---|---|---|
| **Fix now** (small, safe, high impact) | Remove the `X-User-Id` SSE bypass | Code fact |
| | Check lead ownership in add-to-list and list export; filter by `user_id` | Code fact |
| | Make `status` server-controlled (ignore or validate in `PUT /requests`) | Code fact |
| | Remove or disable the fake "Add to Outreach Sequence" success toast; edit login-page claims | Code fact |
| | Stop logging full enriched lead payloads at INFO | Code fact |
| | Add basic rate limiting on login, register, reset and verify endpoints; make login errors uniform | OWASP guidance |
| | Store a failure reason (bad key vs no results vs error) and show it; surface Serper 401/403/429 explicitly | Code fact |
| | On startup, mark orphaned Pending requests Failed; cap `num_leads`; stop pipelines for deleted requests | Code fact |
| | Fix `total_leads` stat, drop hard-coded India/"Generic Product" defaults (ask instead), apply or remove the unused ICP threshold | Code fact |
| | Fall back to the global Serper key only where intended; trace every `fetch_leads_from_serper` caller | Code fact, extent unverified |
| | Delete the dead Campaign* pages and `clarifyIntake` after confirming no dynamic imports | Code fact |
| **Next** (larger) | Full cascade deletion for requests and accounts, with a retention schedule | Compliance, needs legal input |
| | Global suppression and do-not-contact ledger, checked before enrichment and export; public opt-out and privacy notice; per-field source URL and timestamp | Compliance, vendor practice |
| | Legal review of data-broker status (CA, VT, TX, OR), legitimate-interest assessment, DPA and subprocessor list | Not legal advice; unresolved |
| | Durable job table, separate worker, cancel/retry/resume, per-user concurrency and quota limits, cost estimate and sample-run step | Engineering judgement |
| | Move tokens to HttpOnly refresh cookie plus in-memory access token, with CSRF; short access lifetime; drop the SSE query token | OWASP guidance |
| | `safe_fetch()` with SSRF protection and scraper size limits, if the audit of `scraper.py` shows it is missing | Unverified |
| | Honest email labels (Verified, Likely, Risky, Invalid) with a checked-at date; a second verification route for catch-all and unknown | Vendor-sourced |
| | Move key-entry earlier in onboarding; add a sample or demo run | Inference |
| | Pipeline tests, structured logs and job-level observability | Code fact, judgement |
| **Later or if the business needs it** | CRM sync (HubSpot, Salesforce), sequencing, webhooks | Competitor table stakes; business choice |
| | Real organizations: invites, roles, shared lists | Needed only for team selling |
| | Postgres, multi-worker scale | Needed with multiple hosts or frequent lock errors |
| | Country and subscriber-type flags, DNC screening, DROP integration | Depends on markets served |
| | Score calibration against outcomes, review queue, waterfall enrichment | No neutral evidence of lift |
| | MFA, SSO, SOC 2 or ISO 27001, pen test | When buyers ask |

Prioritisation within "Fix now" follows exposure: the authentication and authorization items first, then the logging and fake-button items, then failure visibility. The tiering reflects engineering judgement. The notes mark the security tiers as such, and the compliance ordering needs a lawyer's confirmation.

## Conclusion

The cheapest findings carry the most weight. The three worst security issues are each a few lines of code, and the fake outreach button and false marketing copy cost almost nothing to remove. That means Quarry can move from "not safe to expose" to "safe for a small pilot" quickly. Launch-readiness then turns on one expensive, non-code question: whether Quarry is a data broker holding a shared database of third-party contacts. If it is, deletion, suppression, notices and registrations are mandatory work. If it is repositioned as a per-customer processing tool, much of that burden shrinks. That is a business and legal decision, and the notes do not settle it.

The evidence is weakest exactly where decisions are most tempting. The bounce, catch-all, decay and waterfall numbers are vendor claims. Pricing and onboarding benchmarks are competitor-authored, and the compliance material is secondary. The code findings are solid but come from reading, not running, the app. The right next step is to measure Quarry's own outcomes (bounce by label, field-level precision on a labelled sample, job success rate) and have counsel review the compliance items, so the next audit rests on Quarry's data and not on vendors'.


## Implementation status (2026-11-08)

The "fix now" tranche was implemented on branch `fix/flow-hardening`, each item backed by a test that failed first.
The code audit only read the code, so each claim was re-checked against the running app before changing anything.

| Item | Result |
|---|---|
| `X-User-Id` bypass on the progress stream | **Confirmed** (the stream answered 200 with only that header) and removed; it now answers 401 |
| Lead ownership on lists and list export | **Confirmed** (another user's lead showed in a list) and fixed in add-to-list, list view and export |
| Client-writable request `status` | **Confirmed** and fixed: the server ignores a client-supplied status |
| Login reveals whether an email exists | **Confirmed** and fixed: one message for every failed login |
| No rate limiting | Added to login, register, forgot/reset password and Google callback (default 10 per minute per address and endpoint, configurable); returns 429 with `Retry-After` |
| Full enriched leads logged at INFO | Removed |
| Failures with no reason; bad Serper key looked like "no results" | Fixed: Serper 401/403/429 and other failures are stored as a readable `failure_reason` and shown in the request list and on the details page |
| Orphaned Pending requests after a restart | Marked Failed on startup with a reason |
| `num_leads` unbounded | Capped at 1-200 |
| Pipeline kept writing for a deleted request | The pipeline checks the request still exists before saving |
| Fake "Add to Outreach Sequence" success toast | The button is disabled and labelled "coming soon" |
| Login page claims (outreach sequencing, invented usage numbers) | Replaced with accurate statements; the sample card is labelled "Example result" |
| Dead Campaign pages and unused `clarifyIntake` | Removed (about 4,000 lines) |
| Cascading deletion (listed under "next") | Done early: deleting a request or an account now removes its leads, decision makers, enrichments, ICP/intake data, lists and memberships; the shared `companies` table holds company facts, not people, and is kept |

Corrections to this report found while verifying:

- The dashboard card labelled "Total Generations" counts requests on purpose, so that is not a bug.
- The silent "Generic Product", "India" and "$20K-$50K ARR" defaults existed only in the unrouted `NewCampaign` page, which has been deleted. The live wizard does not have them.

Not done, and why: the unused ICP score threshold was left as is, because applying it would silently drop leads and is a product decision;
the fallback to the operator's Serper key now logs a warning each time it happens instead of being removed, because not every caller was traced;
the "next" and "later" tiers (suppression list and opt-out, notices, durable job queue, token storage, SSRF review, legal review) are untouched.
