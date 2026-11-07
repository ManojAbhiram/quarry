"""
Careers-page tech stack detection.

Discovers official careers hubs via Serper + LLM, extracts tech from job descriptions.
Third-party job boards (LinkedIn, Naukri, Indeed, etc.) are blocked.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from app.core.config import settings
from app.core.utils import normalize_url
from app.services.llm import pick_official_careers_url, resolve_company_from_job_board_page
from app.services.serper import fetch_leads_from_serper
from app.services.tech_stack import TECH_FINGERPRINTS

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

CAREERS_PATH_KEYWORDS = (
    "careers", "jobs", "join-us", "join_us", "work-with-us",
    "open-positions", "opportunities", "vacancies",
)

ATS_PATTERNS = {
    "greenhouse": [r"boards\.greenhouse\.io", r"job-boards\.greenhouse\.io", r"greenhouse\.io"],
    "lever": [r"jobs\.lever\.co"],
    "ashby": [r"jobs\.ashbyhq\.com"],
    "workday": [r"myworkdayjobs\.com"],
    "smartrecruiters": [r"careers\.smartrecruiters\.com"],
    "workable": [r"apply\.workable\.com"],
    "jobvite": [r"jobs\.jobvite\.com"],
    "breezy": [r"\.breezy\.hr"],
    "recruitee": [r"\.recruitee\.com"],
}

# Third-party job boards and aggregators — never scrape these
BLOCKED_JOB_BOARD_DOMAINS = {
    "linkedin.com", "in.linkedin.com", "www.linkedin.com",
    "naukri.com", "naukri.in", "www.naukri.com",
    "indeed.com", "www.indeed.com", "in.indeed.com",
    "glassdoor.com", "www.glassdoor.com",
    "monster.com", "www.monster.com",
    "ziprecruiter.com", "www.ziprecruiter.com",
    "dice.com", "www.dice.com",
    "wellfound.com", "angel.co",
    "careerbuilder.com", "simplyhired.com",
    "seek.com.au", "foundit.in", "shine.com",
    "instahyre.com", "hirist.com", "cutshort.io",
    "gethired.devhub.co.in", "devhub.co.in",
    "talent.com", "jobstreet.com", "timesjobs.com",
    "freshersworld.com", "internshala.com",
}

BLOCKED_JOB_BOARD_FRAGMENTS = (
    "linkedin.com/jobs",
    "naukri.com/job",
    "indeed.com/viewjob",
    "glassdoor.com/job",
    "gethired.",
    "/job-listing/",
    "/job-listings/",
)

TECH_ALIASES: Dict[str, str] = {}
for tech_name in TECH_FINGERPRINTS:
    TECH_ALIASES[tech_name.lower()] = tech_name

_EXTRA_ALIASES = {
    "k8s": "Kubernetes", "kubernetes": "Kubernetes",
    "postgres": "PostgreSQL", "postgresql": "PostgreSQL",
    "mongo": "MongoDB", "mongodb": "MongoDB",
    "node": "Node.js", "nodejs": "Node.js", "node.js": "Node.js",
    "reactjs": "React", "react.js": "React",
    "vue": "Vue.js", "vuejs": "Vue.js", "angularjs": "Angular",
    "golang": "Go", "amazon web services": "AWS",
    "google cloud platform": "Google Cloud", "gcp": "Google Cloud",
    "azure": "Microsoft Azure", "tf": "Terraform",
    "docker": "Docker", "kafka": "Kafka", "redis": "Redis",
    "elasticsearch": "Elasticsearch", "spark": "Apache Spark",
    "typescript": "TypeScript", "javascript": "JavaScript",
    "python": "Python", "java": "Java", "rust": "Rust",
    "fastapi": "FastAPI", "django": "Django", "flask": "Flask",
    "spring boot": "Spring Boot", "nestjs": "NestJS",
    "next.js": "Next.js", "nextjs": "Next.js",
}
TECH_ALIASES.update({k.lower(): v for k, v in _EXTRA_ALIASES.items()})


def get_canonical_map() -> Dict[str, str]:
    return dict(TECH_ALIASES)


def _host(url: str) -> str:
    return urlparse(normalize_url(url).rstrip("/")).netloc.lower().replace("www.", "")


def _domain_from_url(url: str) -> str:
    return _host(url)


def _detect_ats_type(url: str) -> Optional[str]:
    lower = url.lower()
    for ats_type, patterns in ATS_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, lower):
                return ats_type
    return None


def _is_blocked_job_board(url: str) -> bool:
    if not url:
        return True
    lower = url.lower()
    host = _host(url)
    if host in BLOCKED_JOB_BOARD_DOMAINS:
        return True
    for blocked in BLOCKED_JOB_BOARD_DOMAINS:
        if host.endswith("." + blocked) or host == blocked:
            return True
    return any(fragment in lower for fragment in BLOCKED_JOB_BOARD_FRAGMENTS)


def _is_allowed_ats(url: str) -> bool:
    return _detect_ats_type(url) is not None


def _same_company_domain(url: str, company_domain: str) -> bool:
    if not company_domain:
        return False
    host = _host(url)
    company_domain = company_domain.lower().replace("www.", "")
    return host == company_domain or host.endswith("." + company_domain) or company_domain in host


def is_official_careers_url(url: str, company_domain: str) -> bool:
    """True if URL is an official company careers hub or allowed ATS board."""
    if not url or _is_blocked_job_board(url):
        return False
    if _is_allowed_ats(url):
        return True
    return _same_company_domain(url, company_domain)


def is_allowed_job_url(job_url: str, careers_url: str, company_domain: str) -> bool:
    """True if job detail URL belongs to the official careers source."""
    if not job_url or _is_blocked_job_board(job_url):
        return False
    if not is_official_careers_url(job_url, company_domain) and not _is_allowed_ats(job_url):
        return False

    careers_host = _host(careers_url)
    job_host = _host(job_url)

    if job_host == careers_host:
        return True
    if _is_allowed_ats(careers_url) and _is_allowed_ats(job_url):
        return True
    if _same_company_domain(job_url, company_domain):
        return True
    return False


def _looks_like_job_detail_page(url: str) -> bool:
    path = urlparse(url).path.lower()
    return bool(re.search(r"/jobs?/[^/]+|/position/|/opening/|/requisition/", path))


def select_roles(jobs: List[Dict[str, Any]], limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Take up to N job listings from official careers page — no role scoring."""
    limit = limit or settings.CAREERS_MAX_ROLES
    valid = [dict(job) for job in jobs if job.get("url") and job.get("title")]
    return valid[:limit]


def _is_recent_post(posted_at: Optional[str]) -> bool:
    if not posted_at:
        return True
    try:
        text = posted_at.strip().lower()
        if any(kw in text for kw in ("day", "hour", "week", "month")):
            return True
        for fmt in ("%Y-%m-%d", "%b %d, %Y", "%B %d, %Y"):
            try:
                dt = datetime.strptime(posted_at[:20].strip(), fmt).replace(tzinfo=timezone.utc)
                return dt >= datetime.now(timezone.utc) - timedelta(days=settings.CAREERS_RECENCY_DAYS)
            except ValueError:
                continue
    except Exception:
        pass
    return True


def extract_tech_from_jd(text: str) -> Dict[str, Any]:
    """Dictionary-based tech extraction from job description text."""
    if not text:
        return {"technologies": [], "evidence": []}

    lower = text.lower()
    found: Dict[str, str] = {}
    evidence: List[Dict[str, str]] = []

    sorted_aliases = sorted(TECH_ALIASES.keys(), key=len, reverse=True)
    for alias in sorted_aliases:
        pattern = r"\b" + re.escape(alias) + r"\b"
        match = re.search(pattern, lower, re.IGNORECASE)
        if not match:
            continue
        canon = TECH_ALIASES[alias]
        if _normalize_key(canon) in {_normalize_key(x) for x in found.values()}:
            continue
        start = max(0, match.start() - 40)
        end = min(len(text), match.end() + 40)
        snippet = text[start:end].replace("\n", " ").strip()
        found[alias] = canon
        evidence.append({"tech": canon, "snippet": snippet})

    return {
        "technologies": sorted(set(found.values())),
        "evidence": evidence,
    }


def _normalize_key(name: str) -> str:
    return name.strip().lower()


def aggregate_careers_stack(job_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Merge all tech from official careers JDs — no scoring or cross-role filtering."""
    technologies: Set[str] = set()
    evidence_map: Dict[str, List[str]] = {}
    role_hits: Dict[str, int] = {}

    for job in job_results:
        for tech in job.get("technologies", []):
            if not tech:
                continue
            technologies.add(tech)
            role_hits[tech] = role_hits.get(tech, 0) + 1
            for ev in job.get("evidence", []):
                if ev.get("tech") == tech:
                    evidence_map.setdefault(tech, [])
                    snippet = ev.get("snippet", "")
                    if snippet and snippet not in evidence_map[tech]:
                        evidence_map[tech].append(snippet)

    return {
        "technologies": sorted(technologies),
        "role_hits": role_hits,
        "evidence_map": evidence_map,
        "jobs_analyzed": len(job_results),
    }


def _candidate_from_link(url: str, title: str = "", snippet: str = "") -> Dict[str, str]:
    return {"url": url, "title": title, "snippet": snippet}


async def _serper_careers_candidates(company_domain: str, company_name: str = "") -> List[Dict[str, str]]:
    """Collect careers URL candidates from Serper."""
    queries = [
        f'site:{company_domain} (careers OR jobs OR "join us" OR "work with us")',
        f'"{company_domain}" (careers OR jobs) (greenhouse OR lever OR ashby OR workday)',
    ]
    if company_name:
        queries.append(f'"{company_name}" official careers jobs site')

    candidates: List[Dict[str, str]] = []
    seen: Set[str] = set()

    for query in queries:
        try:
            data = await fetch_leads_from_serper(query)
            for item in data.get("organic", []):
                link = (item.get("link") or item.get("url") or "").strip()
                if not link or link in seen:
                    continue
                seen.add(link)
                candidates.append(_candidate_from_link(
                    link,
                    title=item.get("title") or "",
                    snippet=item.get("snippet") or "",
                ))
        except Exception as exc:
            logger.debug("Serper query failed (%s): %s", query, exc)

    return candidates


async def _homepage_link_candidates(
    base_url: str,
    company_domain: str,
    client: httpx.AsyncClient,
) -> List[Dict[str, str]]:
    candidates: List[Dict[str, str]] = []
    try:
        response = await client.get(base_url, timeout=settings.CAREERS_ENRICH_TIMEOUT)
        if response.status_code != 200:
            return candidates
        soup = BeautifulSoup(response.text, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith("#"):
                continue
            full = urljoin(base_url, href)
            if not is_official_careers_url(full, company_domain):
                continue
            path = urlparse(full).path.lower()
            text = (a.get_text() or "").lower()
            if any(kw in path for kw in CAREERS_PATH_KEYWORDS) or any(
                kw in text for kw in ("career", "job", "join us", "work with us", "we're hiring")
            ):
                candidates.append(_candidate_from_link(full, title=a.get_text(strip=True) or ""))
    except Exception as exc:
        logger.debug("Homepage link scan failed for %s: %s", base_url, exc)
    return candidates


async def _path_probe_candidates(base_url: str, company_domain: str, client: httpx.AsyncClient) -> List[Dict[str, str]]:
    candidates: List[Dict[str, str]] = []
    for path in ("/careers", "/jobs", "/join-us", "/work-with-us", "/open-positions", "/company/careers"):
        probe = f"{base_url}{path}"
        if not is_official_careers_url(probe, company_domain):
            continue
        try:
            resp = await client.get(probe, timeout=8)
            if resp.status_code == 200 and len(resp.text) > 500:
                candidates.append(_candidate_from_link(str(resp.url), title=f"Careers page {path}"))
        except Exception:
            continue
    return candidates


async def discover_careers_hub(
    url: str,
    client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    """
    Find official careers/jobs page using homepage scan, Serper, and LLM validation.
    Blocks third-party job boards (LinkedIn, Naukri, Indeed, etc.).
    """
    input_url = normalize_url(url).rstrip("/")
    company_domain = _domain_from_url(input_url)
    result: Dict[str, Any] = {
        "careers_url": None,
        "ats_type": None,
        "confidence": 0.0,
        "source": None,
        "company_domain": company_domain,
        "input_url": input_url,
    }

    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=settings.CAREERS_ENRICH_TIMEOUT)

    try:
        candidates: List[Dict[str, str]] = []
        resolved_company_url = input_url

        # Input is a third-party job board — resolve real company via page + LLM
        if _is_blocked_job_board(input_url):
            try:
                resp = await client.get(input_url, timeout=12)
                page_text = BeautifulSoup(resp.text, "html.parser").get_text("\n", strip=True) if resp.status_code == 200 else ""
                resolved = await resolve_company_from_job_board_page(input_url, page_text)
                resolved_domain = _domain_from_url(
                    resolved.get("company_website") or resolved.get("careers_url") or input_url
                )
                if resolved.get("careers_url") and is_official_careers_url(resolved["careers_url"], resolved_domain):
                    result.update({
                        "careers_url": resolved["careers_url"],
                        "ats_type": _detect_ats_type(resolved["careers_url"]) or "native",
                        "confidence": resolved.get("confidence", 0.7),
                        "source": "llm_job_board_resolve",
                        "company_domain": resolved_domain,
                    })
                    return result
                if resolved.get("company_website"):
                    resolved_company_url = normalize_url(resolved["company_website"]).rstrip("/")
                    company_domain = _domain_from_url(resolved_company_url)
                    result["company_domain"] = company_domain
                    if resolved.get("careers_url"):
                        candidates.append(_candidate_from_link(
                            resolved["careers_url"],
                            title="LLM resolved careers URL",
                            snippet=resolved.get("company_name") or "",
                        ))
            except Exception as exc:
                logger.debug("Job board resolve failed for %s: %s", input_url, exc)

        # Don't treat a single job detail page on company site as the careers hub
        if (
            not _is_blocked_job_board(input_url)
            and _looks_like_job_detail_page(input_url)
            and is_official_careers_url(input_url, company_domain)
        ):
            base = f"{urlparse(input_url).scheme}://{urlparse(input_url).netloc}"
            resolved_company_url = base

        base_url = normalize_url(resolved_company_url).rstrip("/")

        candidates.extend(await _homepage_link_candidates(base_url, company_domain, client))
        candidates.extend(await _path_probe_candidates(base_url, company_domain, client))
        candidates.extend(await _serper_careers_candidates(company_domain))

        # Deduplicate and pre-filter
        filtered: List[Dict[str, str]] = []
        seen_urls: Set[str] = set()
        for item in candidates:
            link = item.get("url", "")
            if not link or link in seen_urls:
                continue
            if not is_official_careers_url(link, company_domain):
                continue
            seen_urls.add(link)
            filtered.append(item)

        if not filtered:
            return result

        llm_pick = await pick_official_careers_url(base_url, company_domain, filtered)
        careers_url = llm_pick.get("careers_url")
        if careers_url and is_official_careers_url(careers_url, company_domain):
            result.update({
                "careers_url": careers_url,
                "ats_type": llm_pick.get("ats_type") or _detect_ats_type(careers_url) or "native",
                "confidence": llm_pick.get("confidence", 0.0),
                "source": "serper_llm",
                "llm_reason": llm_pick.get("reason"),
            })
            return result

        # Fallback: best filtered candidate if LLM rejected all
        fallback = filtered[0]
        result.update({
            "careers_url": fallback["url"],
            "ats_type": _detect_ats_type(fallback["url"]) or "native",
            "confidence": 0.5,
            "source": "filtered_fallback",
        })

    except Exception as exc:
        logger.debug("Careers hub discovery failed for %s: %s", url, exc)
    finally:
        if owns_client and client is not None:
            await client.aclose()

    return result


def _looks_like_job_link(url: str, careers_url: str) -> bool:
    path = urlparse(url).path.lower()
    careers_path = urlparse(careers_url).path.lower().rstrip("/")
    if careers_path and path.startswith(careers_path) and path != careers_path:
        return True
    job_markers = ("job", "position", "opening", "role", "requisition", "vacancy", "apply")
    return any(marker in path for marker in job_markers)


async def collect_job_listings(
    careers_url: str,
    company_domain: str,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Dict[str, Any]]:
    """Parse official careers index and return validated job URLs only."""
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=settings.CAREERS_ENRICH_TIMEOUT)

    jobs: List[Dict[str, Any]] = []
    try:
        response = await client.get(careers_url, timeout=settings.CAREERS_ENRICH_TIMEOUT)
        if response.status_code != 200:
            return jobs
        soup = BeautifulSoup(response.text, "html.parser")
        seen_urls: Set[str] = set()

        for a in soup.find_all("a", href=True):
            href = a.get("href", "").strip()
            title = (a.get_text() or "").strip()
            if not href or not title or len(title) < 3:
                continue
            full = urljoin(str(response.url), href)
            if full in seen_urls:
                continue
            if not is_allowed_job_url(full, careers_url, company_domain):
                continue
            if not _looks_like_job_link(full, careers_url) and full.rstrip("/") == careers_url.rstrip("/"):
                continue
            seen_urls.add(full)
            jobs.append({"title": title, "url": full, "department": None, "posted_at": None})

    except Exception as exc:
        logger.debug("Job listing collection failed for %s: %s", careers_url, exc)
    finally:
        if owns_client and client is not None:
            await client.aclose()

    unique: Dict[str, Dict[str, Any]] = {}
    for job in jobs:
        unique[job["url"]] = job
    return [job for job in unique.values() if _is_recent_post(job.get("posted_at"))]


async def fetch_job_descriptions(
    jobs: List[Dict[str, Any]],
    careers_url: str,
    company_domain: str,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Dict[str, Any]]:
    """Fetch JD text for validated official job URLs."""
    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=settings.CAREERS_ENRICH_TIMEOUT)

    semaphore = asyncio.Semaphore(10)
    results: List[Dict[str, Any]] = []

    async def _fetch_one(job: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        job_url = job.get("url")
        if not job_url or not is_allowed_job_url(job_url, careers_url, company_domain):
            return None
        try:
            async with semaphore:
                resp = await client.get(job_url, timeout=12)
            if resp.status_code != 200:
                return None
            if _is_blocked_job_board(str(resp.url)):
                return None
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header"]):
                tag.decompose()
            text = soup.get_text("\n", strip=True)
            if len(text) < 100:
                return None
            extracted = extract_tech_from_jd(text)
            return {
                "title": job.get("title"),
                "url": job_url,
                "text": text[:12000],
                "technologies": extracted["technologies"],
                "evidence": extracted["evidence"],
            }
        except Exception as exc:
            logger.debug("Failed to fetch JD %s: %s", job_url, exc)
            return None

    try:
        fetched = await asyncio.gather(*(_fetch_one(job) for job in jobs))
        results = [item for item in fetched if item]
    finally:
        if owns_client and client is not None:
            await client.aclose()

    return results


async def detect_careers_tech_stack(url: str) -> Dict[str, Any]:
    """End-to-end careers tech detection for one company URL."""
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True, timeout=settings.CAREERS_ENRICH_TIMEOUT) as client:
        discovery = await discover_careers_hub(url, client=client)
        company_domain = discovery.get("company_domain") or _domain_from_url(url)
        careers_url = discovery.get("careers_url")

        if not careers_url:
            return {
                "discovery": discovery,
                "jobs": [],
                "selected_roles": [],
                "job_results": [],
                "aggregated": {"technologies": [], "role_hits": {}, "evidence_map": {}, "jobs_analyzed": 0},
            }

        listings = await collect_job_listings(careers_url, company_domain, client=client)
        selected = select_roles(listings)
        job_results = await fetch_job_descriptions(selected, careers_url, company_domain, client=client)
        aggregated = aggregate_careers_stack(job_results)

        return {
            "discovery": discovery,
            "jobs": listings,
            "selected_roles": selected,
            "job_results": job_results,
            "aggregated": aggregated,
        }
