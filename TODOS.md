# TODOS

## Infrastructure
### Close the DNS-rebinding gap in the private-address guard (pre-hosting blocker)

**What:** Make the guard connect to the IP address it checked, so a DNS server that answers differently on the second lookup cannot redirect a request to an internal address.

**Why:** `app/core/url_guard.py` resolves a name to check it, then the HTTP client resolves the same name again before connecting. A hostile DNS server can answer with a public address the first time and `127.0.0.1` the second.

**Context:** Documented as a known limit in the `url_guard.py` module docstring. Closing it means pinning the resolved IP into the connection (a custom httpx transport and a `requests` adapter, keeping the Host header and TLS server name). It affects every guarded fetcher: `scraper.py`, `tech_stack.py`, `careers_tech_stack.py`, `company_enrichment.py` and `product_similarity.py`. Not needed for the local concierge pilot.

**Effort:** M
**Priority:** P2
**Depends on:** None. Must land before Quarry runs on any server.

### Check MX addresses before the SMTP email probe

**What:** In `app/services/email_verification.py` (`_smtp_verify`, around line 62), resolve the MX host and refuse non-public addresses before connecting on port 25.

**Why:** A domain can publish an MX record that points at a private or loopback address, so the verifier would open a connection to an internal host. Impact is low: it only sends `EHLO`, `MAIL` and `RCPT`, and the result is reduced to a pass or fail reason.

**Context:** Found by the guard follow-up audit on 2026-11-08. Reuse `check_url`-style address validation from `app/core/url_guard.py`; add a test with an MX that resolves to `127.0.0.1` and `10.0.0.5`, copying `tests/test_url_guard.py`. It also helps with the pilot's accuracy numbers, since a refused private MX should read as invalid, not verified.

**Effort:** S
**Priority:** P3
**Depends on:** None.

## Completed
### Extend the private-address guard to the other outbound fetchers (pre-hosting blocker)

**What:** Add `event_hooks={"request": [httpx_request_guard]}` to every `httpx.AsyncClient` that fetches company or scraped URLs outside `scraper.py`, and close the DNS-rebinding gap in `app/core/url_guard.py`.

**Why:** The scraper is guarded (`app/core/url_guard.py`), but the same exposure remains in the other fetchers. A hostile page or search result can still make these request internal addresses once Quarry is hosted.

**Context:** Found while fixing the scraper guard on 2026-11-08. Client call sites to wire: `app/services/tech_stack.py` (around lines 861 and 1209), `app/services/careers_tech_stack.py` (around lines 371, 485, 531 and 577) and `app/services/company_enrichment.py` (around line 114). Each is a one-line hook plus a test that a redirect to `http://169.254.169.254/` is refused, copying `tests/test_url_guard.py`. Not needed for the local concierge pilot.

**Effort:** M
**Priority:** P2
**Depends on:** None. Must land before Quarry runs on any server.

**Completed:** 2026-11-08 on branch `fix/guard-other-fetchers`. Hook added to all 3 clients in `tech_stack.py`, all 4 in `careers_tech_stack.py`, and the LinkedIn fetchers in `company_enrichment.py` and `product_similarity.py` (found by auditing every outbound call); 18 new tests. Fixed first-party endpoints (Serper, Google OAuth, outbound SMTP) were deliberately left alone. The DNS-rebinding half was split into its own item above.

### Block private and internal addresses in the scraper (pre-hosting blocker)

**What:** Add a single `safe_fetch()` for all scraper requests that refuses loopback, private, link-local and cloud-metadata addresses, and caps response size.

**Why:** `apps/api/app/services/scraper.py` fetches whatever URLs search results and crawled directories return, and a grep found no private-IP guard. On a founder's laptop the risk is low; once Quarry is hosted, a hostile page could make it fetch internal services (SSRF).

**Context:** Found by /plan-ceo-review on 2026-11-08, decision R4. The flow audit (`reports/Quarry lead flow business audit.md`) listed this as an open question because it never read `scraper.py`. Verify first by reading the redirect handling too, since a public URL can redirect to an internal one. Prove the fix with a test that `http://127.0.0.1`, `http://169.254.169.254` and a redirect to either are all refused. Not needed for the 3-person concierge pilot, which runs locally.

**Effort:** M
**Priority:** P2
**Depends on:** None. Must land before Quarry runs on any server.

**Completed:** 2026-11-08 on branch `fix/scraper-ssrf-guard`. New `app/core/url_guard.py` (`check_url`, `httpx_request_guard`, `safe_get`, `playwright_route_guard`) wired into all four fetch paths in `scraper.py`; 30 tests in `tests/test_url_guard.py`. The response-size cap was not added (not covered by a failing test); the guard covers address and redirect hops only.
