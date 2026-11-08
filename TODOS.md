# TODOS

## Infrastructure
### Block private and internal addresses in the scraper (pre-hosting blocker)

**What:** Add a single `safe_fetch()` for all scraper requests that refuses loopback, private, link-local and cloud-metadata addresses, and caps response size.

**Why:** `apps/api/app/services/scraper.py` fetches whatever URLs search results and crawled directories return, and a grep found no private-IP guard. On a founder's laptop the risk is low; once Quarry is hosted, a hostile page could make it fetch internal services (SSRF).

**Context:** Found by /plan-ceo-review on 2026-11-08, decision R4. The flow audit (`reports/Quarry lead flow business audit.md`) listed this as an open question because it never read `scraper.py`. Verify first by reading the redirect handling too, since a public URL can redirect to an internal one. Prove the fix with a test that `http://127.0.0.1`, `http://169.254.169.254` and a redirect to either are all refused. Not needed for the 3-person concierge pilot, which runs locally.

**Effort:** M
**Priority:** P2
**Depends on:** None. Must land before Quarry runs on any server.
