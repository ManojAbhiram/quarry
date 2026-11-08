# TODOS

## Infrastructure
### Extend the private-address guard to the other outbound fetchers (pre-hosting blocker)

**What:** Add `event_hooks={"request": [httpx_request_guard]}` to every `httpx.AsyncClient` that fetches company or scraped URLs outside `scraper.py`, and close the DNS-rebinding gap in `app/core/url_guard.py`.

**Why:** The scraper is guarded (`app/core/url_guard.py`), but the same exposure remains in the other fetchers. A hostile page or search result can still make these request internal addresses once Quarry is hosted.

**Context:** Found while fixing the scraper guard on 2026-11-08. Client call sites to wire: `app/services/tech_stack.py` (around lines 861 and 1209), `app/services/careers_tech_stack.py` (around lines 371, 485, 531 and 577) and `app/services/company_enrichment.py` (around line 114). Each is a one-line hook plus a test that a redirect to `http://169.254.169.254/` is refused, copying `tests/test_url_guard.py`. The guard checks an address, then the HTTP client resolves the name again, so a DNS server that answers differently the second time can slip past; closing that means connecting to the checked IP directly. Not needed for the local concierge pilot.

**Effort:** M
**Priority:** P2
**Depends on:** None. Must land before Quarry runs on any server.

## Completed
### Block private and internal addresses in the scraper (pre-hosting blocker)

**What:** Add a single `safe_fetch()` for all scraper requests that refuses loopback, private, link-local and cloud-metadata addresses, and caps response size.

**Why:** `apps/api/app/services/scraper.py` fetches whatever URLs search results and crawled directories return, and a grep found no private-IP guard. On a founder's laptop the risk is low; once Quarry is hosted, a hostile page could make it fetch internal services (SSRF).

**Context:** Found by /plan-ceo-review on 2026-11-08, decision R4. The flow audit (`reports/Quarry lead flow business audit.md`) listed this as an open question because it never read `scraper.py`. Verify first by reading the redirect handling too, since a public URL can redirect to an internal one. Prove the fix with a test that `http://127.0.0.1`, `http://169.254.169.254` and a redirect to either are all refused. Not needed for the 3-person concierge pilot, which runs locally.

**Effort:** M
**Priority:** P2
**Depends on:** None. Must land before Quarry runs on any server.

**Completed:** 2026-11-08 on branch `fix/scraper-ssrf-guard`. New `app/core/url_guard.py` (`check_url`, `httpx_request_guard`, `safe_get`, `playwright_route_guard`) wired into all four fetch paths in `scraper.py`; 30 tests in `tests/test_url_guard.py`. The response-size cap was not added (not covered by a failing test); the guard covers address and redirect hops only.
