from __future__ import annotations

import asyncio
import json
import os
import re
import time
from collections import defaultdict
from urllib.parse import unquote, urljoin, urlparse

import httpx
import requests
from bs4 import BeautifulSoup

from app.core.config import settings
from app.core.logger import logger

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_STRIP_TAGS = [
    "script", "style", "nav", "footer", "header",
    "noscript", "svg", "img", "iframe", "picture",
]

# _DIRECTORY_LINK_DENY_DOMAINS = {
#     "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com",
#     "youtube.com", "github.com", "gitlab.com", "medium.com", "substack.com",
#     "blogspot.com", "wordpress.com", "docs.google.com", "slideshare.net",
#     "behance.net", "dribbble.com", "eventbrite.com", "meetup.com",
#     "calendar.google.com", "producthunt.com", "g2.com", "capterra.com",
#     "trustpilot.com", "alternativeto.net", "quora.com", "reddit.com",
#     "pinterest.com", "tiktok.com", "discord.com", "telegram.me",
# }

# _DIRECTORY_LINK_DENY_PATHS = {
#     "/login", "/signin", "/sign-in", "/signup", "/sign-up", "/register", "/auth",
#     "/terms", "/privacy", "/cookie", "/cookies", "/help", "/support", "/faq",
#     "/documentation", "/docs", "/developer", "/developers", "/community",
#     "/blog", "/blogs", "/news", "/press", "/press-release", "/events", "/event",
#     "/share", "/search", "/intent", "/invite", "/status", "/jobs", "/careers",
#     "/resources", "/resource", "/ebook", "/podcast", "/study", "/case-study",
# }

# _DIRECTORY_LINK_DENY_EXTENSIONS = {
#     ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".csv", ".zip",
#     ".tar", ".gz", ".rar", ".mp4", ".mp3", ".wav", ".ogg", ".webm", ".svg",
#     ".png", ".jpg", ".jpeg", ".gif", ".md", ".json", ".xml", ".rss", ".atom",
# }

# Weighted keyword scoring — contact/about are highest value for leads
# Each keyword maps to its score weight
_LEAD_PAGE_KEYWORDS: dict[str, int] = {
    "contact": 5,       # Highest: direct contact info
    "contact-us": 5,
    "contactus": 5,
    "about": 4,         # High: company info, founding, team
    "about-us": 4,
    "aboutus": 4,
    "team": 3,          # Good: decision-makers
    "people": 3,
    "leadership": 3,
    "founders": 3,
    "management": 3,
    "executives": 3,
    "who-we-are": 3,
    "our-team": 3,
    "meet": 2,
    "staff": 2,
    "board": 2,
    "investors": 2,     # Useful for funding stage signals
    "press": 1,
    "media": 1,
    "partner": 1,
    # REMOVED: careers, jobs — these waste a scrape slot, zero lead contact value
}

# Unified social domain mapping — all use schema-consistent keys
_SOCIAL_DOMAINS: dict[str, str] = {
    "linkedin.com": "linkedin_url",
    "twitter.com": "x_url",      # was 'twitter_url' in v2 — mismatch with schema
    "x.com": "x_url",
    "facebook.com": "facebook_url",
    "instagram.com": "instagram_url",
    "crunchbase.com": "crunchbase_url",
}

# Email blocklist — generic/noreply/tracking emails that are not contact emails
# NOTE: 'info@' and 'admin@' are intentionally NOT blocked — they are often
# the genuine contact email for small/mid-size companies and B2B firms.
_EMAIL_BLOCKLIST_PREFIXES = {
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "mailer", "bounce", "return", "postmaster", "root",
    "webmaster", "hostmaster",
    "newsletter", "notifications", "alerts", "updates", "news",
    "marketing", "promotions", "offers", "deals",
    "careers", "jobs", "recruitment",
    "billing", "payments", "invoice", "receipts",
    "security", "privacy",
    "feedback", "abuse", "spam",
    # System/helpdesk emails
    "helpdesk", "servicedesk", "it-support", "itsupport", "support",
    "hr", "hrdesk", "hrhelpdesk",
}

# Email regex — intentionally excludes % to prevent URL-encoded junk like %20name@domain.com
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")

# Tightened phone regex — specific Indian mobile/landline patterns
# Indian mobile: +91 followed by 10 digits starting with 6-9
# Indian landline: STD code (2-4 digits) + local number = 8-10 digits total
_PHONE_RE_INDIAN = re.compile(
    r"(?<!\d)"
    r"(?:"
    r"\+91[\s\-]?[6-9]\d{9}"          # +91 mobile: +91 9876543210
    r"|0[1-9]\d{8,9}"                  # Landline with 0: 0891-1234567
    r"|[6-9]\d{9}"                     # Mobile without country code: 9876543210
    r")"
    r"(?!\d)"
)
_PHONE_RE_INTL = re.compile(
    r"(?<!\d)"
    r"\+[1-9]\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}"
    r"(?!\d)"
)

_DOMAIN_LAST_HIT: dict[str, float] = defaultdict(float)
_DOMAIN_LOCKS: dict[str, asyncio.Lock] = {}
_MIN_DELAY_SECS = 0.5

ENABLE_PLAYWRIGHT = os.getenv("ENABLE_PLAYWRIGHT", "false").lower() == "true"


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

def _get_domain_lock(host: str) -> asyncio.Lock:
    if host not in _DOMAIN_LOCKS:
        _DOMAIN_LOCKS[host] = asyncio.Lock()
    return _DOMAIN_LOCKS[host]


async def _wait_for_domain(url: str) -> None:
    host = urlparse(url).netloc
    lock = _get_domain_lock(host)
    async with lock:
        elapsed = time.monotonic() - _DOMAIN_LAST_HIT[host]
        if elapsed < _MIN_DELAY_SECS:
            await asyncio.sleep(_MIN_DELAY_SECS - elapsed)
        _DOMAIN_LAST_HIT[host] = time.monotonic()


# ---------------------------------------------------------------------------
# Structured data extractors
# ---------------------------------------------------------------------------

def _extract_json_ld(soup: BeautifulSoup) -> dict:
    """
    Parse JSON-LD schema.org blocks — highest fidelity structured data.
    Skips Place/Event/Product types that contaminate company data.
    """
    result: dict = {}
    # Types we want — primary business entity types
    TARGET_TYPES = {
        "Organization", "LocalBusiness", "Corporation", "NGO",
        "GovernmentOrganization", "WebSite", "Person",
    }
    # Types we explicitly ignore to avoid contamination from map embeds etc.
    SKIP_TYPES = {
        "Place", "GeoCoordinates", "Event", "Product", "Service",
        "BreadcrumbList", "WebPage", "SiteNavigationElement",
        "ListItem", "ItemList", "FAQPage", "Question", "Answer",
    }

    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
            items = data if isinstance(data, list) else [data]
            for item in items:
                if not isinstance(item, dict):
                    continue
                schema_type = str(item.get("@type", ""))

                # Skip explicitly bad types
                if any(t in schema_type for t in SKIP_TYPES):
                    continue

                # Only process target types
                if not any(t in schema_type for t in TARGET_TYPES):
                    continue

                result.setdefault("company_name", item.get("name"))

                # Only use description if it's substantive
                desc = item.get("description", "")
                if desc and len(str(desc)) > 50:
                    result.setdefault("description", desc)

                result.setdefault("contact_phone", item.get("telephone"))
                result.setdefault("contact_email", item.get("email"))
                result.setdefault("founded_year", item.get("foundingDate"))
                result.setdefault("website", item.get("url"))

                emp = item.get("numberOfEmployees")
                if isinstance(emp, dict):
                    result.setdefault("employee_count", emp.get("value"))
                elif emp:
                    result.setdefault("employee_count", str(emp))

                addr = item.get("address", {})
                if isinstance(addr, dict):
                    parts = [
                        addr.get("streetAddress", ""),
                        addr.get("addressLocality", ""),
                        addr.get("addressRegion", ""),
                        addr.get("postalCode", ""),
                        addr.get("addressCountry", ""),
                    ]
                    address_str = ", ".join(p for p in parts if p)
                    if address_str:
                        result.setdefault("location", address_str)

                same_as = item.get("sameAs", [])
                if isinstance(same_as, str):
                    same_as = [same_as]
                for link in same_as:
                    for domain, key in _SOCIAL_DOMAINS.items():
                        if domain in link:
                            result.setdefault(key, link)

        except Exception:
            continue

    return {k: v for k, v in result.items() if v}


def _extract_meta_tags(soup: BeautifulSoup) -> dict:
    """
    Extract og:description, meta description, og:site_name.
    Only use description if it's substantive (>50 chars).
    """
    result: dict = {}
    for meta in soup.find_all("meta"):
        name = (meta.get("name") or meta.get("property") or "").lower()
        content = (meta.get("content") or "").strip()
        if not content:
            continue
        if name in ("description", "og:description", "twitter:description"):
            # Skip short taglines that aren't useful descriptions
            if len(content) > 50:
                result.setdefault("description", content)
        if name == "og:site_name":
            result.setdefault("company_name", content)
    return result


def _is_valid_contact_email(email: str) -> bool:
    """
    Reject generic/noreply/system emails.
    Returns True only for emails that are likely real contact addresses.

    Checks:
    1. Exact prefix match against the blocklist (e.g. 'noreply')
    2. Each dot/hyphen-separated word in the prefix (e.g. 'hr.helpdeskexit' -> checks 'hr', 'helpdeskexit')
    3. Substring check within each part (e.g. 'helpdeskexit' contains 'helpdesk' -> blocked)
    """
    if not email or "@" not in email:
        return False
    # Normalize: strip leading/trailing whitespace and any URL-encoded junk
    email = email.strip()
    if "%" in email:
        # Contains URL-encoded chars — reject immediately
        return False
    prefix = email.split("@")[0].lower()
    # Remove any + alias suffix (e.g. john+newsletter@company.com -> john)
    prefix = prefix.split("+")[0].strip()

    # 1. Exact match
    if prefix in _EMAIL_BLOCKLIST_PREFIXES:
        return False

    # 2 & 3. Split by dots and hyphens, check each word exactly and as substring
    parts = re.split(r'[.\-]', prefix)
    for part in parts:
        if not part:
            continue
        # Exact word match
        if part in _EMAIL_BLOCKLIST_PREFIXES:
            return False
        # Substring match — catches compound words like 'helpdeskexit' or 'noreply2024'
        for blocked in _EMAIL_BLOCKLIST_PREFIXES:
            if len(blocked) >= 5 and blocked in part:  # only substring-check words >= 5 chars to avoid false positives
                return False

    return True


def _extract_mailto_tel(soup: BeautifulSoup) -> dict:
    """
    Harvest email/phone from href attributes — machine-readable and reliable.
    Skips generic/noreply emails and URL-encoded garbage.
    Uses tightened phone regex for Indian numbers.
    """
    result: dict = {}
    for a in soup.find_all("a", href=True):
        href: str = a["href"].strip()
        if href.startswith("mailto:") and "contact_email" not in result:
            # URL-decode the email (handles %20, %40, etc.)
            raw = href[7:].split("?")[0].strip()
            email = unquote(raw).strip()
            # If decoding introduced whitespace (was %20prefix@…), reject
            if " " in email:
                continue
            if email and _EMAIL_RE.match(email) and _is_valid_contact_email(email):
                result["contact_email"] = email
        elif href.startswith("tel:") and "contact_phone" not in result:
            phone = href[4:].strip().replace(" ", "").replace("-", "")
            if phone and len(phone) >= 7:
                result["contact_phone"] = href[4:].strip()  # Store original formatting
    return result


def _extract_social_links(soup: BeautifulSoup) -> dict:
    """
    Extract LinkedIn, Twitter/X, Crunchbase profile URLs from all anchors.
    Maps to correct field names (x_url not twitter_url).
    Filters sharing intents, generic paths, placeholder usernames.
    """
    result: dict = {}

    # Paths that indicate sharing/intent links, not profile links
    _SHARING_PATHS = {
        "share", "intent", "sharer", "pin/create",
        "search", "home", "login", "signup", "register",
        "terms", "privacy", "status", "hashtag",
        "compose", "post", "tweet",
    }
    # Generic placeholder usernames to skip
    _PLACEHOLDER_USERNAMES = {
        "yourhandle", "username", "profile", "user",
        "companyname", "company", "yourbusiness",
    }

    for a in soup.find_all("a", href=True):
        href: str = a["href"].strip()
        for domain, key in _SOCIAL_DOMAINS.items():
            if domain not in href or key in result:
                continue
            parsed = urlparse(href)
            path = parsed.path.lower().strip("/")

            if not path:
                continue

            # Skip sharing/generic paths
            path_parts = set(path.split("/"))
            if path_parts & _SHARING_PATHS:
                continue

            # Skip placeholder usernames
            if path in _PLACEHOLDER_USERNAMES:
                continue

            # For LinkedIn: must be /company/ or /in/ profile, not /jobs/ or /learning/
            if domain == "linkedin.com":
                if not (path.startswith("company/") or path.startswith("in/")):
                    # Allow /pub/ paths too (older LinkedIn URLs)
                    if not path.startswith("pub/"):
                        continue

            result[key] = href

    return result


def _extract_headings_with_context(soup: BeautifulSoup, max_chars: int = 3000) -> str:
    """
    Extract text preserving heading hierarchy.
    Per-page cap reduced to 3000 (was 7000) — each page gets this budget.
    The caller assembles multiple pages and prioritises contact/about pages first.
    """
    sections: list[str] = []
    total = 0
    for tag in soup.find_all(["h1", "h2", "h3", "p", "li", "address", "span", "td"]):
        if total >= max_chars:
            break
        text = tag.get_text(separator=" ", strip=True)
        if not text or len(text) < 4:
            continue
        prefix = "## " if tag.name in ("h1", "h2", "h3") else ""
        line = f"{prefix}{text}"
        sections.append(line)
        total += len(line)
    return "\n".join(sections)


# ---------------------------------------------------------------------------
# Main HTML cleaner
# ---------------------------------------------------------------------------

def _clean_html(html: str) -> tuple[str, dict]:
    """
    Parse HTML, extract all structured signals, return clean text + structured dict.
    Returns empty results gracefully if the content is binary/corrupt.
    """
    if not html or not isinstance(html, str):
        return "", {}
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception as exc:
        logger.debug("BeautifulSoup parse error (corrupt/binary content): %s", exc)
        return "", {}

    # Extract structured data BEFORE stripping tags (scripts needed for JSON-LD)
    structured: dict = {}
    structured.update(_extract_json_ld(soup))
    structured.update({k: v for k, v in _extract_meta_tags(soup).items() if k not in structured})
    structured.update({k: v for k, v in _extract_mailto_tel(soup).items() if k not in structured})
    structured.update({k: v for k, v in _extract_social_links(soup).items() if k not in structured})

    # --- Run email/phone regex on FULL page text BEFORE heading reduction ---
    # Many sites put emails in footers, <div> blocks, or plain text nodes that
    # get dropped when we later filter to headings/paragraphs only.
    full_text_for_regex = soup.get_text(separator=" ", strip=True)

    if "contact_email" not in structured:
        for match in _EMAIL_RE.finditer(full_text_for_regex):
            email = match.group(0)
            if _is_valid_contact_email(email):
                structured["contact_email"] = email
                logger.debug("Email found in full page text: %s", email)
                break

    if "contact_phone" not in structured:
        m = _PHONE_RE_INDIAN.search(full_text_for_regex)
        if m:
            structured["contact_phone"] = m.group(0).strip()
            logger.debug("Indian phone found in full page text: %s", structured["contact_phone"])
        else:
            m = _PHONE_RE_INTL.search(full_text_for_regex)
            if m:
                structured["contact_phone"] = m.group(0).strip()
                logger.debug("Intl phone found in full page text: %s", structured["contact_phone"])

    # Strip noise tags for text extraction
    for tag in soup(_STRIP_TAGS):
        tag.decompose()

    text = _extract_headings_with_context(soup)

    # Secondary regex pass on reduced text only for fields still missing after full scan
    if "contact_email" not in structured:
        for match in _EMAIL_RE.finditer(text):
            email = match.group(0)
            if _is_valid_contact_email(email):
                structured["contact_email"] = email
                break

    if "contact_phone" not in structured:
        m = _PHONE_RE_INDIAN.search(text)
        if m:
            structured["contact_phone"] = m.group(0).strip()
        else:
            m = _PHONE_RE_INTL.search(text)
            if m:
                structured["contact_phone"] = m.group(0).strip()

    return text, {k: v for k, v in structured.items() if v}


# ---------------------------------------------------------------------------
# Sub-page discovery
# ---------------------------------------------------------------------------

def _discover_subpages(html: str, base_url: str, max_pages: int = 3) -> list[str]:
    """
    Find internal links likely to contain lead-relevant content.
    Weighted scoring — contact/about score highest, careers/jobs excluded.
    Returns pages sorted by descending score (most valuable first).
    """
    if not html or not isinstance(html, str):
        return []
    try:
        soup = BeautifulSoup(html, "html.parser")
    except Exception as exc:
        logger.debug("_discover_subpages: BeautifulSoup parse error (corrupt/binary content): %s", exc)
        return []
    base_netloc = urlparse(base_url).netloc
    scored: dict[str, int] = {}

    for a in soup.find_all("a", href=True):
        href: str = a["href"].strip()
        if not href or href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
            continue
        full = urljoin(base_url, href)
        parsed = urlparse(full)
        if parsed.netloc != base_netloc:
            continue
        path = parsed.path.lower()
        # Use weighted scoring from _LEAD_PAGE_KEYWORDS dict
        score = max(
            (_LEAD_PAGE_KEYWORDS.get(kw, 0) for kw in _LEAD_PAGE_KEYWORDS if kw in path),
            default=0
        )
        if score > 0:
            scored[full] = max(scored.get(full, 0), score)

    pages = sorted(scored, key=lambda u: scored[u], reverse=True)[:max_pages]
    if pages:
        logger.info("Discovered %d sub-page(s) for %s: %s (scores: %s)",
                    len(pages), base_url, pages, [scored[p] for p in pages])
    return pages


# ---------------------------------------------------------------------------
# Playwright fallback (opt-in)
# ---------------------------------------------------------------------------

async def _fetch_with_playwright(url: str) -> str:
    try:
        from playwright.async_api import async_playwright  # type: ignore
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page(extra_http_headers=HEADERS)
            await page.goto(url, timeout=25000, wait_until="networkidle")
            html = await page.content()
            await browser.close()
            return html
    except Exception as exc:
        logger.warning("Playwright fallback failed for %s: %s", url, exc)
        return ""


# ---------------------------------------------------------------------------
# Async scraper — main pipeline entry point
# ---------------------------------------------------------------------------

async def scrape_url_with_discovery(url: str) -> tuple[str, dict]:
    """
    Fetch homepage + discovered sub-pages, return combined text and structured data.

    Contact/about pages are assembled BEFORE homepage text in the combined
    output so they're not cut off by MAX_SCRAPE_TEXT_CHARS.
    Timeout increased — 25s for homepage, 20s for sub-pages.
    """
    homepage_text: str = ""
    homepage_structured: dict = {}
    subpage_results: list[tuple[str, str, dict]] = []  # (label, text, structured)
    all_structured: dict = {}

    async def _fetch_with_retry(
        client: httpx.AsyncClient, fetch_url: str, retries: int = 1, timeout: int = 8
    ) -> str:
        for attempt in range(retries + 1):
            try:
                await _wait_for_domain(fetch_url)
                resp = await client.get(fetch_url, timeout=timeout)
                resp.raise_for_status()
                # Skip non-HTML responses (PDFs, images, binary files, etc.)
                content_type = resp.headers.get("content-type", "")
                if content_type and not any(t in content_type for t in ("text/html", "text/plain", "application/xhtml")):
                    logger.debug("Skipping non-HTML response for %s: %s", fetch_url, content_type)
                    return ""
                # Decode bytes explicitly — avoids binary bleed-through when
                # the server sends gzip/binary data without proper headers.
                raw = resp.content
                encoding = resp.charset_encoding or "utf-8"
                return raw.decode(encoding, errors="replace")
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (403, 404, 410, 429, 500, 502, 503, 504):
                    return ""
                if attempt < retries:
                    await asyncio.sleep(2 ** attempt)
            except httpx.TimeoutException:
                logger.debug("Timeout on %s (attempt %d/%d)", fetch_url, attempt + 1, retries + 1)
                if attempt < retries:
                    await asyncio.sleep(1)
            except Exception as exc:
                if attempt < retries:
                    await asyncio.sleep(2 ** attempt)
                else:
                    logger.warning("Failed after %d retries — %s: %s", retries, fetch_url, exc)
        return ""

    async with httpx.AsyncClient(
        headers=HEADERS,
        timeout=settings.SCRAPE_TIMEOUT + 10,  # extra buffer
        follow_redirects=True,
    ) as client:

        # ── Homepage ──────────────────────────────────────────────────────────
        homepage_html = await _fetch_with_retry(client, url, retries=1, timeout=8)
        if not homepage_html:
            return "", {}

        # Playwright fallback for JS-heavy pages
        if ENABLE_PLAYWRIGHT and len(homepage_html.strip()) < 1500:
            rendered = await _fetch_with_playwright(url)
            if len(rendered) > len(homepage_html):
                homepage_html = rendered

        homepage_text, homepage_structured = _clean_html(homepage_html)
        all_structured.update(homepage_structured)
        logger.debug("Homepage %s -> %d chars, %d structured fields",
                     url, len(homepage_text), len(homepage_structured))

        # ── Sub-pages (now sorted by relevance score) ─────────────────
        subpages = _discover_subpages(homepage_html, url, max_pages=3)

        async def _fetch_sub(sub_url: str) -> tuple[str, str, dict]:
            html = await _fetch_with_retry(client, sub_url, retries=0, timeout=6)
            if not html:
                return sub_url, "", {}
            text, structured = _clean_html(html)
            # Sub-page fills gaps not found on homepage
            for k, v in structured.items():
                if v and k not in all_structured:
                    all_structured[k] = v
            label = sub_url.rstrip("/").split("/")[-1].upper() or "SUBPAGE"
            logger.debug("Sub-page %s -> %d chars, %d new fields", sub_url, len(text), len(structured))
            return sub_url, text, structured

        sub_results = await asyncio.gather(*(_fetch_sub(u) for u in subpages))
        subpage_results = list(sub_results)

    # Contact/about pages are assembled FIRST (highest priority),
    # then homepage. This ensures contact info isn't cut off by char limit.
    texts: list[str] = []

    # Sort sub-pages: contact > about > team > rest
    def _subpage_priority(result: tuple) -> int:
        sub_url = result[0].lower()
        if any(kw in sub_url for kw in ("contact",)):
            return 0
        if any(kw in sub_url for kw in ("about",)):
            return 1
        if any(kw in sub_url for kw in ("team", "people", "leadership")):
            return 2
        return 3

    subpage_results.sort(key=_subpage_priority)

    for sub_url, text, _ in subpage_results:
        if text:
            label = sub_url.rstrip("/").split("/")[-1].upper() or "SUBPAGE"
            texts.append(f"[{label}]\n{text}")

    if homepage_text:
        texts.append(f"[HOMEPAGE]\n{homepage_text}")

    combined = "\n\n".join(texts)
    return combined[: settings.MAX_SCRAPE_TEXT_CHARS], all_structured


# ---------------------------------------------------------------------------
# Sync helpers
# ---------------------------------------------------------------------------

def scrape_url(url: str) -> str:
    """Fetch a single URL and return cleaned text. Sync."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=settings.SCRAPE_TIMEOUT, allow_redirects=True)
        resp.raise_for_status()
        text, _ = _clean_html(resp.text)
        return text
    except Exception as exc:
        logger.warning("Failed to scrape %s: %s", url, exc)
        return ""


def scrape_directory_links(directory_url: str) -> list[str]:
    """Scrape a directory page and return external standalone links."""
    try:
        resp = requests.get(
            directory_url, headers=HEADERS,
            timeout=settings.SCRAPE_TIMEOUT, allow_redirects=True,
        )
        resp.raise_for_status()
        # Decode safely — same defence as async scraper
        raw = resp.content
        encoding = resp.apparent_encoding or resp.encoding or "utf-8"
        html = raw.decode(encoding, errors="replace")
        try:
            soup = BeautifulSoup(html, "html.parser")
        except Exception as exc:
            logger.debug("scrape_directory_links: BeautifulSoup parse error: %s", exc)
            return []
        base_netloc = urlparse(directory_url).netloc
        links: set[str] = set()
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith("#") or href.startswith("mailto:"):
                continue
            full = urljoin(directory_url, href)
            parsed = urlparse(full)
            if parsed.scheme in ("http", "https") and parsed.netloc and parsed.netloc != base_netloc:
                links.add(full)
        logger.info("Directory %s -> %d external company links", directory_url, len(links))
        return list(links)
    except Exception as exc:
        logger.warning("Failed to scrape directory %s: %s", directory_url, exc)
        return []