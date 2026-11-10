| | |
|---|---|
| **Product** | Quarry, AI-assisted B2B lead generation |
| **Document** | Product Requirements Document (PRD) |
| **Version** | 1.0 |
| **Date** | 2026-11-10 |
| **Status** | Feature-complete for roadmap phases 1 to 4, pre-hosting |
| **Owner** | Manoj Abhiram |

> **How to read this document.** Statements about what the product does come from the current code and are marked
> *Built*. Statements about users, market and pricing are *hypotheses*: the concierge-pilot design doc records that no
> customer conversations have happened yet, so nothing here claims demand has been proven. Competitor facts come from
> `reports/Quarry next feature roadmap.md`, which draws on vendor-authored sources and is directional only.

---

# 1. Summary

Quarry turns a plain-language description of an ideal customer into a reviewed list of matching companies, decision
makers and verified email addresses, then helps the user act on that list: score it, watch it for buying signals, send
sequenced outreach, and push it into a CRM. Every lead carries its source and a checked-at date, and every personal
record can be erased or suppressed.

The product bets on **data trust**. Incumbents lose users to inaccurate contacts, opaque credit pricing and
auto-renew lock-in. Quarry's answer is honest email labels (Verified, Likely, Risky, Invalid), per-field provenance,
a cost estimate before any spend, and a compliance layer built in from the start.

## 1.1 One-paragraph pitch

"Describe who you sell to. Quarry searches the live web, builds a scored list of companies and the people who decide,
tells you how sure it is about each email and where each fact came from, and lets you send to them from your own
mailbox or hand them to your CRM, without surprise bills and without leaving a trail of personal data you cannot
delete."

# 2. Problem and opportunity

## 2.1 The problem

People who build B2B prospect lists (agency owners, freelance SDRs, founders doing their own outbound) face four
recurring problems:

1. **Stale or wrong data.** Contact databases go out of date, and bounce rates of 20 to 30% are reported for some
   vendors (vendor-sourced, directional). Bad lists burn sender reputation.
2. **Opaque, expensive pricing.** Credit systems are hard to predict; enterprise databases are quote-only; entry tools
   sit around $50 to $120 per month and agencies at $2,500 and up. There is a gap between them.
3. **Fragmented workflow.** Finding companies, finding people, verifying emails, sending mail and syncing to a CRM
   are usually four or five tools.
4. **Compliance exposure.** CAN-SPAM, CASL, UK PECR, GDPR and India's DPDP Act all touch cold outreach, and most small
   teams have no suppression list, no source record and no way to honour an erasure request.

## 2.2 Why Quarry

| Competitor layer | Examples | Gap Quarry targets |
|---|---|---|
| Contact databases | ZoomInfo, Apollo, Lusha, Seamless.AI | Fresh data found live from the web per ICP; honest accuracy labels |
| Enrichment engines | Clay | Guided, opinionated front end for non-technical sellers |
| Cold-email senders | Instantly, Smartlead, lemlist | Quarry's edge is upstream of the send, but sending is included |
| AI SDR platforms | 11x, Artisan | Transparent per-request pricing, reviewable output, no autonomous sending |

The differentiator is not a single feature. It is the combination of **live discovery, visible provenance, honest
email status, built-in compliance and predictable cost**.

# 3. Goals and non-goals

## 3.1 Goals

| ID | Goal | Measure |
|---|---|---|
| G1 | A first usable lead list within minutes of describing the ICP | Median time from launch to Completed (to be instrumented) |
| G2 | Users can trust the data | Share of exported emails labelled Verified or Likely; bounce rate on a labelled 100 to 200 lead set |
| G3 | No surprise spend | Cost estimate shown before every run; credits and quota visible in the product |
| G4 | Safe by default | Zero cross-tenant data access; SSRF, CSRF and auth controls tested |
| G5 | Compliance is a feature | Suppression honoured before enrichment, export and send; erasure completes end to end |
| G6 | Close the loop | Users can send sequences and sync to a CRM without leaving Quarry |

## 3.2 Non-goals (this release)

* A shared, resold contact database. Quarry processes data per customer; the default is not to build one.
* Autonomous sending without user review.
* Scraping logged-in LinkedIn sessions. LinkedIn-derived data comes from public search results only.
* Gmail or Microsoft OAuth mailbox access (restricted scopes trigger a security assessment). SMTP and IMAP are used
  instead.
* Postgres and horizontal scaling (documented as the next infrastructure step).
* Phone-number data and dialers.
* Native mobile apps and a browser extension.

# 4. Users and personas

> These personas are working hypotheses from the pilot design doc. They must be validated by interviews before they
> drive pricing or positioning.

| Persona | Context | Job to be done | What they care about |
|---|---|---|---|
| **Freelance SDR / lead-list builder** | Builds lists for clients, paid per list | Produce a clean, defensible list fast | Accuracy, speed, CSV export, per-list cost |
| **Agency owner** | Runs outbound for several clients | Repeatable process across clients, team access | Seats and roles, shared lists, CRM push |
| **Founder doing outbound** | Sells their own product, no sales team | Find the 50 right companies and email them this week | Simplicity, sending from own mailbox, low cost |
| **Team admin** (secondary) | Owns a workspace | Control access, spend and compliance | Roles, billing, audit log, suppression |

## 4.1 Roles inside a workspace

| Role | Can do |
|---|---|
| **Owner** | Everything, including billing and ownership of the workspace |
| **Admin** | Manage members, invites, billing top-ups, integrations |
| **Member** | Create requests, lists, sequences; use the product day to day |
| **Viewer** | Read shared requests and lists |

Role order is `owner > admin > member > viewer`; API dependencies enforce a minimum role per endpoint.

# 5. Product scope and requirements

Priority key: **P0** launch-critical, **P1** important, **P2** later. Status: **Built** is implemented and tested; **Partial** means implemented with a known limit; **Open** is not done.

## 5.1 Accounts and access (FR-A)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑A1 | Email and password registration and login | P0 | Built |
| FR‑A2 | Google sign-in via a server-side redirect flow | P1 | Built |
| FR‑A3 | Password reset by email link | P0 | Built |
| FR‑A4 | HttpOnly cookie sessions with rotating refresh tokens and CSRF protection on writes | P0 | Built |
| FR‑A5 | Bearer-token access for API clients | P1 | Built |
| FR‑A6 | Rate limiting on login, register and reset; uniform error messages | P0 | Built |
| FR‑A7 | Delete account and cascade-delete the user's personal data | P0 | Built |

**Acceptance (FR-A4).** A cookie-authenticated POST without a matching `X-CSRF-Token` returns 403. A refresh token
presented as an access token is rejected. Logout deletes the server-side session and clears cookies.

## 5.2 Lead requests: the core flow (FR-R)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑R1 | Guided wizard to define an ICP, optionally seeded from pasted text, URLs or files | P0 | Built |
| FR‑R2 | LLM helpers: generate ICP, check consistency, suggest chips, find competitors | P1 | Built |
| FR‑R3 | Launch a discovery run: queries, search, scrape, extract, score, enrich | P0 | Built |
| FR‑R4 | "Direct companies" run: user supplies a company list or CSV; Quarry enriches it | P1 | Built |
| FR‑R5 | Runs are asynchronous; launching returns a request id at once; progress by polling or server-sent events | P0 | Built |
| FR‑R6 | Runs survive a server restart and can be cancelled | P0 | Built |
| FR‑R7 | A run that fails keeps the partial leads and shows a failure reason | P0 | Built |
| FR‑R8 | Cost and time estimate before launch, and a small sample run | P1 | Built |
| FR‑R9 | Pipeline finds decision makers and competitors in parallel with leads | P1 | Built |
| FR‑R10 | Optional ICP score filter (off by default so nothing is silently discarded) | P2 | Built |
| FR‑R11 | Retry a lead whose AI enrichment failed | P1 | Built |
| FR‑R12 | Request quota check and credit debit are atomic | P0 | Built |

**Acceptance (FR-R7).** If extraction fails for a page, the lead is kept, named from the page title, flagged
`enrichment_failed` with a user-facing reason, and shown with a Retry action. It is never dropped silently.

## 5.3 Lead data, scoring and trust (FR-L)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑L1 | Company profile: industry, size, location, tech stack, infrastructure, funding, news, jobs, social signals | P0 | Built |
| FR‑L2 | Match score 0 to 100 against the ICP | P0 | Built |
| FR‑L3 | Intent score from four pillars (firmographic 25, technographic 20, intent 35, engagement 20) with confidence weights and a 15% per 30 days decay; bands HOT, WARM, NURTURE, WATCH, COLD | P1 | Built |
| FR‑L4 | Four-state email status: Verified, Likely, Risky, Invalid, with reason, method and checked-at timestamp | P0 | Built |
| FR‑L5 | Pluggable verifier with a bring-your-own provider key; catch-all awareness | P1 | Built |
| FR‑L6 | Per-field provenance: source URL and collection date, shown in the UI | P0 | Built |
| FR‑L7 | Region flag per lead (EU, UK, CA, IN) with a compliance note | P1 | Built |
| FR‑L8 | Waterfall email enrichment across scrape, Hunter, Snov and People Data Labs, charged per success | P1 | Built |
| FR‑L9 | Batch AI scoring job | P2 | Built |
| FR‑L10 | Competitor discovery and comparison for the user's own product | P2 | Built |

## 5.4 Lists, export and sharing (FR-X)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑X1 | Star, exclude and validate companies; add to named lead lists | P0 | Built |
| FR‑X2 | Export companies, competitors, decision makers and lists as CSV, XLSX or PDF | P0 | Built |
| FR‑X3 | CSV carries a source-notice line and opt-out instruction | P1 | Built |
| FR‑X4 | Share requests and lists with a workspace (read access for teammates) | P1 | Built |
| FR‑X5 | Suppressed contacts never appear in an export | P0 | Built |

## 5.5 Outreach (FR-O)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑O1 | Connect a mailbox over SMTP and IMAP; credentials encrypted at rest | P0 | Built |
| FR‑O2 | Test the connection (SMTP login, IMAP login) before saving | P1 | Built |
| FR‑O3 | Multi-step sequences, up to 8 steps, with merge variables and a preview | P0 | Built |
| FR‑O4 | Send windows by timezone (default 09:00 to 17:00), daily caps per mailbox (default 40), and a warmup ramp from 5 per day growing 30% a day up to the cap | P0 | Built |
| FR‑O5 | Reply and bounce detection by IMAP polling, threaded by Message-ID; DSN parsing; auto-reply detection | P0 | Built |
| FR‑O6 | Auto-pause a mailbox when its hard-bounce rate passes 2% (after at least 20 sends; both configurable); resume manually | P0 | Built |
| FR‑O7 | One-click unsubscribe headers and a footer with unsubscribe link and sender postal address | P0 | Built |
| FR‑O8 | DNS preflight: SPF, DKIM, DMARC check for the sending domain | P1 | Built |
| FR‑O9 | Suppressed addresses are skipped at send time | P0 | Built |
| FR‑O10 | Sequence stats: sent, replied, bounced (reply rate is the headline; open tracking is secondary) | P1 | Built |
| FR‑O11 | Gmail and Microsoft OAuth mailboxes | P2 | Open (out of scope) |

## 5.6 Signals and watch (FR-W)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑W1 | Saved searches that re-run on a schedule | P1 | Built |
| FR‑W2 | Signal events (hiring, funding, news, tech-stack change) with snapshots to detect change | P1 | Built |
| FR‑W3 | Per-lead signal feed and an account-wide signal list | P1 | Built |
| FR‑W4 | Email and Slack alerts when a saved search finds new matches or signals; alerts are seeded so existing matches are not announced | P1 | Built |

## 5.7 Integrations (FR-I)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑I1 | Public API keys, created and revoked in the UI | P1 | Built |
| FR‑I2 | Outbound webhooks with delivery log and test button | P1 | Built |
| FR‑I3 | HubSpot connection (OAuth) and list push, run as a background job with per-lead sync status | P1 | Built |
| FR‑I4 | CSV export endpoint for automation tools | P1 | Built |
| FR‑I5 | Salesforce, Pipedrive, Zapier and Make connectors | P2 | Open |

## 5.8 Workspaces, billing and usage (FR-B)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑B1 | Organizations with owner, admin, member and viewer roles; email invites | P0 | Built |
| FR‑B2 | Plans: Free, Pro, Team with request, credit, seat and CRM-connection limits | P0 | Built |
| FR‑B3 | Credit ledger: monthly grant, spend, top-ups; two separate balances (request credits, email-lookup credits) | P0 | Built |
| FR‑B4 | Payment providers behind one interface: Stripe, Razorpay, and a mock for local demos | P1 | Built |
| FR‑B5 | Credit top-up packs, credited only after a verified paid webhook, idempotent per event | P0 | Built |
| FR‑B6 | Usage summary: requests, spend and quota remaining | P1 | Built |

### Plan catalogue (from `billing/plans.py`)

| Plan | Price / month | Requests / month | Credits / month | Seats | CRM connections |
|---|---|---|---|---|---|
| Free | $0 | 3 | 25 | 3 | 0 |
| Pro | $49 | 50 | 500 | 5 | 1 |
| Team | $199 | 250 | 2,500 | 25 | 5 |

Top-up packs: 100 credits for $10, 500 for $40, 2,000 for $140. A lead request costs 1 credit. These prices are
placeholders set in code and **have not been validated with customers**.

## 5.9 Compliance and trust (FR-C)

| ID | Requirement | Pri | Status |
|---|---|---|---|
| FR‑C1 | Workspace-wide suppression ledger checked before enrichment, export and send | P0 | Built |
| FR‑C2 | Public opt-out page and signed opt-out links | P0 | Built |
| FR‑C3 | Person-level erasure tool | P0 | Built |
| FR‑C4 | Audit log of compliance-relevant actions | P0 | Built |
| FR‑C5 | 30-day retention purge for rejected and unpromoted leads | P1 | Built |
| FR‑C6 | Reject and restore a lead | P1 | Built |
| FR‑C7 | Privacy notice page | P0 | Built |
| FR‑C8 | Legal review of data-broker status, legitimate-interest assessment, DPA and subprocessor list | P0 | **Open: needs counsel** |

# 6. User journeys

## 6.1 Journey A: first list in one session

1. Sign up (email or Google).
2. Create a request: describe the product and buyer. Optionally paste a URL or document to seed the ICP.
3. Review and edit the generated ICP in the wizard.
4. See a cost and time estimate. Optionally run a small sample first.
5. Launch. The request page shows live progress; the user can leave and return.
6. Review leads: match score, tech stack, signals, decision makers, email status with source and date.
7. Star, exclude or reject leads; add keepers to a list.
8. Export a CSV, or continue to journey B.

## 6.2 Journey B: from list to conversation

1. Connect a mailbox; Quarry tests the SMTP and IMAP login.
2. Run the DNS preflight for the sending domain.
3. Build a sequence (up to 8 steps) with merge variables; preview it against a real contact.
4. Enroll a list. Quarry sends inside the send window, under the daily cap, skipping suppressed addresses.
5. Replies and bounces are detected by IMAP polling; replying contacts leave the sequence.
6. Optionally push the list to HubSpot and watch per-lead sync status.

## 6.3 Journey C: a recipient opts out

1. The recipient clicks Unsubscribe in the footer or the one-click header.
2. A signed token adds them to the workspace suppression ledger and records an audit entry.
3. Future enrichment, export and sends skip them. They can be erased entirely by an admin.

# 7. Non-functional requirements

| Area | Requirement | Current state |
|---|---|---|
| **Security** | Object-level authorization on every resource; no header identity shortcut | Built, tested |
| | SSRF protection on every outbound fetch of a user-influenced URL | Built; DNS-pinned connections for httpx and requests; Playwright checked but not pinned (off by default) |
| | Secrets encrypted at rest; no secrets in job payloads | Built |
| **Reliability** | Durable jobs, retry with backoff, recovery after restart | Built |
| | Single writer: one API worker only | Documented limit |
| **Performance** | A run returns a request id immediately; long work is off the request path | Built. Run duration is **not yet measured**; the "about 6 minutes" figure in early mockups is an estimate |
| **Scalability** | Single instance on SQLite | Fine for a pilot; Postgres is the scale-out path |
| **Privacy** | Third-party personal data deletable by request, lead, account | Built |
| **Accessibility** | Keyboard focus trap and Escape in dialogs, labelled controls, status never conveyed by colour alone | Built; formal contrast audit pending |
| **Browser support** | Current evergreen browsers; responsive to phone width | Built |
| **Observability** | Structured logs; failure reasons surfaced to the user; audit log | Built; no metrics or tracing backend yet |
| **Maintainability** | CI runs ruff, pytest, eslint, vitest and a production build | Built |

# 8. Success metrics

| Metric | Why | Target (proposed, to calibrate) |
|---|---|---|
| Activation: users who launch a run within 24 hours of signup | Product clarity | Set a baseline first |
| Time to first result | Core promise | Under 10 minutes for a 25-lead run |
| Email accuracy: bounce rate on delivered lists | Trust claim | Under 2% hard bounce on Verified+Likely |
| Enrichment failure rate | Pipeline health | Under 5% of leads flagged `enrichment_failed` |
| Run success rate | Reliability | Over 95% of runs Completed |
| Reply rate on sequences | Outcome that matters | Track per user; no universal target |
| Opt-out handled | Compliance | 100% of suppressions honoured at the next send |
| Paid conversion | Business | Unknown until pricing is validated |

Open measurement gap: Quarry cannot see bounces or replies for mail sent outside Quarry, and the accuracy of the
LLM-extracted contacts is unmeasured. The roadmap proposes a labelled set of 100 to 200 leads.

# 9. Constraints, assumptions and risks

## 9.1 Constraints

* Solo builder; free tiers and bring-your-own keys are the build-time cost model.
* One process and one SQLite writer: the job queue, schedulers and write lock are in-process.
* No mailbox OAuth, to avoid restricted-scope security assessments.

## 9.2 Assumptions (unvalidated)

1. A niche exists where live-web data beats stale databases.
2. Buyers will pay per request or per month for transparent, reviewed lists.
3. Users accept bringing their own Serper key, or an operator-paid key at a marked-up credit price.

## 9.3 Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | No demand evidence (no customer conversations yet) | High | High | Run the interview and concierge plan before more features; time-boxed go/no-go |
| 2 | Data-broker or privacy-law exposure from storing third-party contacts | Medium | High | Per-customer processing default; suppression, erasure, retention; **legal review before hosted launch** |
| 3 | LLM extraction errors or hallucinated contacts | Medium | High | Provenance and checked-at on every field; verification statuses; measure on a labelled set |
| 4 | Deliverability harm to customers' domains | Medium | High | Caps, warmup, auto-pause, unsubscribe headers, DNS preflight |
| 5 | SSRF or abuse via scraped URLs once hosted | Low after fixes | High | URL guard with DNS pinning; residual Playwright gap documented |
| 6 | SQLite single-writer limits growth | Medium | Medium | One worker today; Postgres migration is the next infrastructure step |
| 7 | Upstream cost spikes (Serper, LLM) | Medium | Medium | Estimates, quotas, credits, bring-your-own keys |
| 8 | Unvalidated pricing | High | Medium | Treat plan prices as placeholders until interviews |

# 10. Release plan and open items

All four roadmap phases (foundation, data trust and compliance, features, growth) are implemented.
What remains before a hosted launch:

| Item | Type | Priority |
|---|---|---|
| Legal review: data-broker status, legitimate-interest assessment, DPA, subprocessors | Compliance | P0 |
| Exercise real services end to end (full pipeline with a live Serper key, email verification providers, SMTP and IMAP, Stripe, Razorpay, HubSpot) | Verification | P0 |
| Re-check shared work with two accounts in one organization | QA | P3 |
| Response-size cap in the scraper | Hardening | P3 |
| Customer interviews and a concierge pilot to validate persona, niche and price | Discovery | P0 |
| Postgres and multi-worker queue | Scale | P2 |
| Salesforce, Pipedrive, Zapier and Make connectors; browser extension | Growth | P2 |

# 11. Glossary

| Term | Meaning |
|---|---|
| **ICP** | Ideal Customer Profile: the description of the company and buyer you want |
| **Request** | One discovery run and its results |
| **Lead** | A matched company with its enrichment |
| **Decision maker** | A person at a lead who is likely to buy |
| **Provenance** | Where a fact came from (URL) and when it was collected |
| **Suppression** | A do-not-contact entry that blocks enrichment, export and sending |
| **Waterfall** | Trying several data sources in order and paying only for a hit |
| **Warmup** | A gradual increase in daily send volume for a new mailbox |
| **DSN** | Delivery Status Notification: the bounce message mail servers return |
| **SSRF** | Server-side request forgery: tricking the server into fetching internal addresses |
