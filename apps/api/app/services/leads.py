"""
Lead generation pipeline — end-to-end flow:

  1.  Generate search queries from the ICP context (Groq)
  2.  Store queries on the request
  3.  Search Google via Serper API for each query
  4.  Deduplicate discovered URLs
  5.  Classify URLs: standalone (company site) vs directory (aggregator/list)
  6.  Expand directory pages -> extract nested company URLs
  7.  Re-classify expanded URLs, merge into standalone list
  8.  For each standalone URL:
        a. Fetch homepage + discover /contact /about /team sub-pages
        b. Extract structured lead data via Groq (email, phone, company, …)
  9.  Save all enriched leads to the database
  10. Mark the request as Completed (or Failed on error)
"""
import asyncio
import time
import re

import httpx

from app.core.config import settings
from app.core.logger import logger
from app.core.utils import (
    clean_company_name,
    canonical_host,
    canonical_website,
    extract_seller_name,
    deduplicate_list_case_insensitive,
    parse_employee_range,
    ranges_overlap,
)
from app.db.leads import (
    get_normalized_leads_for_request,
    process_and_save_standalone_leads,
    save_enriched_leads_to_db,
)
from app.db.requests import (
    add_queries_to_lead_request,
    get_request_by_id,
    request_exists,
    update_request_status,
)
from app.services.llm import (
    extract_leads_from_pages,
    generate_sales_queries,
    normalize_lead_request_payload,
    process_serper_results_batch,
    extract_target_outreach_roles,
    extract_decision_makers_from_serper,
    summarize_linkedin_posts_from_serper,
)
from app.services.email_verification import verify_emails_batch
from app.services.scraper import scrape_directory_links
from app.services.serper import fetch_leads_from_serper, current_serper_key
from app.services.tech_stack import detect_infrastructure_profile_parallel

# Limit how many _resolve_company() calls run concurrently so that a large
# batch of companies does not fire hundreds of Serper requests simultaneously
# and trigger 429 rate-limit errors.
_RESOLVE_SEM = asyncio.Semaphore(10)

async def _attach_tech_stacks_to_leads(leads: list[dict]) -> list[dict]:
    """
    Detect and attach technology stacks and infrastructure profiles to leads in parallel.
    
    Extracts company URLs from leads, detects tech/infra profiles in parallel,
    and attaches them to each lead.
    
    Args:
        leads: List of enriched leads with 'website' or 'source_url' field
        
    Returns:
        List of leads with 'tech_stack' and 'infrastructure' fields added
    """
    logger.info("Attaching tech stacks and infrastructure profiles to leads...")    
    if not leads:
        logger.info("No leads to attach tech stacks to")
        return leads
    logger.info("Inside the _attach_tech_stacks_to_leads function with %d leads", len(leads))
    # Extract all company URLs
    url_to_lead_idx = {}
    urls = []
    for idx, lead in enumerate(leads):
        url = lead.get("website") or lead.get("source_url") or ""
        if url:
            urls.append(url)
            url_to_lead_idx[url] = idx
    
    if not urls:
        logger.warning("No URLs found in leads to detect tech stacks")
        return leads
    
    logger.info("Detecting tech stacks/infra for %d leads in parallel...", len(urls))
    
    try:
        # Detect profiles for all URLs in parallel (8 second timeout per URL for better reliability)
        profiles = await detect_infrastructure_profile_parallel(urls, timeout=8)
        
        # Attach tech stacks and infrastructure profiles to leads
        attached_count = 0
        for url, profile in profiles.items():
            if url in url_to_lead_idx:
                idx = url_to_lead_idx[url]
                tech_list = profile.get("technologies") or []
                infra_dict = profile.get("infrastructure") or {}
                
                # Fetch existing tech stack (possibly extracted by LLM)
                existing_tech = leads[idx].get("tech_stack") or []
                if isinstance(existing_tech, str):
                    existing_tech = [t.strip() for t in existing_tech.split(",") if t.strip()]
                elif not isinstance(existing_tech, list):
                    existing_tech = []
                
                leads[idx]["tech_stack"] = deduplicate_list_case_insensitive(list(existing_tech) + list(tech_list))
                if profile.get("tech_provenance"):
                    leads[idx]["tech_provenance"] = profile.get("tech_provenance")
                if profile.get("careers"):
                    leads[idx]["careers_tech_signals"] = profile.get("careers")
                
                existing_infra = leads[idx].get("infrastructure") or {}
                if not isinstance(existing_infra, dict):
                    existing_infra = {}
                
                merged_infra = dict(existing_infra)
                for cat, items in infra_dict.items():
                    merged_infra[cat] = deduplicate_list_case_insensitive(list(merged_infra.get(cat) or []) + list(items))
                
                leads[idx]["infrastructure"] = merged_infra
                attached_count += 1
                logger.info("Attached/Merged tech & infra to lead for %s", url)
        
        logger.info("Successfully attached/merged tech stacks/infra to %d leads", attached_count)
    
    except Exception as e:
        logger.warning("Error detecting/merging tech stacks & infra: %s", e, exc_info=True)
    
    # Ensure all leads have tech_stack and infrastructure fields
    for lead in leads:
        if "tech_stack" not in lead:
            lead["tech_stack"] = []
        if "infrastructure" not in lead:
            lead["infrastructure"] = {}
    
    logger.info("Tech stack/infra attachment complete.")
    return leads


def _deduplicate_urls(results: list[dict]) -> list[dict]:
    # Known platform domains that pollute query results and should never be scraped/treated as leads
    restricted_domains = [
        "linkedin.com", "facebook.com", "twitter.com", "x.com", "instagram.com", 
        "youtube.com", "pinterest.com", "reddit.com",
        "indeed.", "glassdoor.", "simplyhired.com", "ziprecruiter.com", 
        "upwork.com", "fiverr.com", "freelancer.com", "naukri.com", "monster.com", "foundit.in",
        "zoominfo.com", "crunchbase.com", "apollo.io", "lusha.com", 
        "pitchbook.com", "cbinsights.com", "tracxn.com", "wikipedia.org", 
        "medium.com", "github.com", "gitlab.com", "stackoverflow.com", "google.",
        # Support/docs/knowledgebase subdomains that never contain company profile info
        "knowledgebase.", "support.", "help.", "docs.", "status.", "community.",
        "forum.", "forums.", "kb.", "faq.", "helpdesk.", "servicedesk.",
        # App-store / listing pages that describe products, not the lead company
        "g2.com", "capterra.com", "trustradius.com", "getapp.com", "softwareadvice.com",
        "producthunt.com", "alternativeto.net",
    ]

    seen: set[str] = set()
    unique: list[dict] = []
    for item in results:
        url = item.get("url") or item.get("link") or ""
        if url:
            # Check for restricted domains
            url_lower = url.lower()
            if any(domain in url_lower for domain in restricted_domains):
                continue
                
            # Normalize URL to prevent duplicates (www, http/https, trailing slashes)
            norm_url = url.lower().strip()
            norm_url = re.sub(r"^https?://", "", norm_url)
            norm_url = re.sub(r"^www\.", "", norm_url)
            norm_url = norm_url.split("?")[0].split("#")[0]
            norm_url = norm_url.rstrip("/")
            if norm_url not in seen:
                seen.add(norm_url)
                item["url"] = url  # keep original URL
                unique.append(item)
    return unique


def _is_seller_or_junk_lead(lead: dict, seller_names: set[str]) -> bool:
    """
    Returns True if the lead should be excluded because it is:
    - The seller's own company (by company_name or source_url)
    - Scraped from a junk/non-profile URL (support portal, knowledgebase, etc.)
    """
    # Check if company_name matches any seller name
    company = (lead.get("company_name") or "").lower().strip()
    if company and seller_names:
        for name in seller_names:
            if name and (name in company or company in name):
                logger.info("Excluding self-match lead: company_name '%s' matches seller '%s'", company, name)
                return True

    # Check page/source URL against junk patterns (support/help/etc.)
    url = (lead.get("page_url") or lead.get("source_url") or "").lower()
    junk_url_patterns = [
        "knowledgebase.", "support.", "/contactsupport", "/support",
        "help.", "/help", "docs.", "status.", "community.", "forum",
        "/faq", "helpdesk.", "kb.",
    ]
    if any(pat in url for pat in junk_url_patterns):
        logger.info("Excluding junk-source lead: source_url '%s' matches junk pattern", url)
        return True

    return False


# ── Pipeline stages ───────────────────────────────────────────────────────────

async def _generate_and_store_queries(request_id: str, payload: dict) -> list[str]:
    queries = await generate_sales_queries(payload)
    if not queries:
        logger.warning("No queries generated for request %s", request_id)
        return []
    await add_queries_to_lead_request(request_id, queries)
    logger.info("Stored %d queries for request %s", len(queries), request_id)
    return queries


def _explain_serper_error(exc: Exception) -> str:
    """Turn a Serper failure into something the user can act on."""
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return "Serper rejected the API key (HTTP %d). Check or replace your Serper key in Profile." % code
        if code == 429:
            return "Serper rate limit or credit quota reached (HTTP 429). Wait a while or top up your Serper plan."
        return "Serper returned an error (HTTP %d)." % code
    return "Could not reach Serper (%s)." % type(exc).__name__


async def _fetch_all_serper_results(queries: list[str]) -> tuple[list[dict], str | None]:
    """Run all Serper queries concurrently.

    Returns (results, failure_reason). `failure_reason` is set only when no query returned results and at least one
    failed, so a bad or exhausted key no longer looks like "no results".
    """
    errors: list[str] = []

    async def _one(query: str) -> list[dict]:
        try:
            data = await fetch_leads_from_serper(query)
            items = [
                {"title": i.get("title", ""), "url": i.get("link", ""), "snippet": i.get("snippet", "")}
                for i in data.get("organic", [])
            ]
            logger.info("Query '%s' -> %d results", query, len(items))
            return items
        except Exception as exc:
            logger.warning("Serper error for query '%s': %s", query, exc)
            errors.append(_explain_serper_error(exc))
            return []

    batches = await asyncio.gather(*(_one(q) for q in queries))
    results = [item for batch in batches for item in batch]
    return results, (errors[0] if errors and not results else None)


async def _expand_directories(directory_items: list[dict]) -> list[dict]:
    """
    For each directory URL, run scrape_directory_links in a thread (it is sync),
    then return expanded items as standalone candidates.
    """
    expanded: list[dict] = []
    loop = asyncio.get_running_loop()

    async def process_dir(item):
        url = item.get("url", "")
        if not url:
            return []
        # Skip high anti-bot domains that always fail with 403.
        # Note: crunchbase, zoominfo, pitchbook are already blocked upstream in
        # _deduplicate_urls so they never reach here. This list covers social/job
        # domains that may slip through as "directory" type from the classifier.
        forbidden_domains = [
            "indeed.", "glassdoor.", "linkedin.com", "upwork.com",
            "fiverr.com", "google.", "youtube.com",
            "facebook.com", "twitter.com", "x.com",
            "naukri.com", "monster.com",
        ]
        if any(d in url.lower() for d in forbidden_domains):
            logger.info("Skipping forbidden/anti-bot directory domain: %s", url)
            return []
        try:
            nested_links = await loop.run_in_executor(None, scrape_directory_links, url)
            logger.info("Directory %s -> %d nested links", url, len(nested_links))
            return [{"url": link, "title": "", "snippet": "", "from_directory": url} for link in nested_links]
        except Exception as exc:
            logger.warning("Directory scrape failed for %s: %s", url, exc)
            return []

    # Fetch all directories concurrently
    results = await asyncio.gather(*(process_dir(item) for item in directory_items))
    for res in results:
        expanded.extend(res)
        
    return expanded


async def _fetch_company_linkedin_fallback(company_name: str) -> str | None:
    """
    Search Google for the company's official LinkedIn page if it was not found on their site.
    """
    if not company_name:
        return None
    cleaned = clean_company_name(company_name)
    if not cleaned:
        return None

    query = f'site:linkedin.com/company/ "{cleaned}"'
    try:
        data = await fetch_leads_from_serper(query)
        for item in data.get("organic", []):
            link = item.get("link") or item.get("url") or ""
            if "linkedin.com/company/" in link.lower():
                return link
    except Exception as e:
        logger.warning("Failed to fetch fallback company LinkedIn for %s: %s", company_name, e)
    return None


async def _fetch_company_website_fallback(company_name: str) -> str | None:
    """
    Search Google for the company's official website if it was missing from the scraper extraction.
    """
    if not company_name:
        return None
    cleaned = clean_company_name(company_name)
    if not cleaned:
        return None

    query = f'"{cleaned}"'
    try:
        data = await fetch_leads_from_serper(query)
        # Deduplicate using the restricted domain rules to ensure a high-quality link
        unique_results = _deduplicate_urls(data.get("organic", []))
        if unique_results:
            return unique_results[0].get("link") or unique_results[0].get("url")
    except Exception as e:
        logger.warning("Failed to fetch fallback company website for %s: %s", company_name, e)
    return None


async def _dedup_against_companies(items: list[dict]) -> list[dict]:
    """
    Deduplicate incoming URL candidates against the companies collection.
    URLs whose canonical domain is already in companies (enriched within 24h) are
    removed — the existing company record will be linked when saving enriched leads.
    URLs for companies not yet seen (or stale) are returned for scraping.
    """
    from app.db.companies import get_company_by_domain
    unique: list[dict] = []
    seen_domains: set[str] = set()
    for item in items:
        url = item.get("url", "")
        if not url:
            unique.append(item)
            continue
        domain = canonical_host(url)
        if not domain or domain in seen_domains:
            continue
        seen_domains.add(domain)
        existing = await get_company_by_domain(domain)
        if existing:
            from datetime import datetime
            enriched_at = existing.get("enriched_at")
            if enriched_at:
                age_hours = (datetime.utcnow() - enriched_at).total_seconds() / 3600
                if age_hours < 24:
                    logger.info(
                        "Dedup: skipping re-scrape for known company domain=%s (enriched %.1fh ago)",
                        domain, age_hours,
                    )
                    continue
        unique.append(item)
    return unique


async def _scrape_and_extract(
    standalone_items: list[dict],
    context: dict,
    request_id: str,
    user_id: str,
) -> list[dict]:
    """
    For each standalone URL:
      1. Detect tech stack and infrastructure profile in parallel
      2. Fetch homepage + sub-pages (/contact /about /team) — async (concurrently)
      3. Run Groq lead extraction on combined text — sync in thread executor
    Returns enriched lead dicts.
    """
    pages: list[dict] = []
    semaphore = asyncio.Semaphore(25)  # Limit concurrent scrapes so we don't exhaust connection pools

    async def process_item(item):
        url = item.get("url", "")
        if not url:
            return None

        company_name = item.get("title", "") or ""
        snippet = item.get("snippet", "") or ""

        # For directory-expanded items the title is empty; derive a search name from the domain.
        # e.g. "datamatics.com" → "Datamatics" so the Serper query is useful.
        if not company_name.strip():
            try:
                from urllib.parse import urlparse as _urlparse
                _parsed = _urlparse(url if url.startswith("http") else f"https://{url}")
                _netloc = (_parsed.netloc or "").removeprefix("www.")
                company_name = _netloc.split(".")[0].replace("-", " ").replace("_", " ").title()
            except Exception:
                pass

        # Extract the ICP-relevant keywords to guide the relevance search
        icp_keywords = ""
        business_type = context.get("business_type") or ""
        ideal_profile = context.get("ideal_lead_profile") or context.get("icp") or ""
        if business_type:
            icp_keywords = business_type.replace("/", " ").replace("-", " ").strip()
        elif ideal_profile:
            # Take first 50 chars of the ICP as keywords
            icp_keywords = " ".join(ideal_profile.split()[:8])

        text = f"{company_name}\n{snippet}"

        async with semaphore:
            try:
                # PRIMARY: Get what the company does via LinkedIn/Crunchbase (rich descriptions)
                desc_query = f'"{company_name}" company about site:linkedin.com/company OR site:crunchbase.com'
                desc_data = await fetch_leads_from_serper(desc_query)
                desc_snippets = desc_data.get("organic", [])

                # SECONDARY: Check ICP-relevant signals
                signal_query = f'"{company_name}" {icp_keywords}'.strip()
                sig_data = await fetch_leads_from_serper(signal_query) if icp_keywords else {}
                sig_snippets = sig_data.get("organic", []) if sig_data else []

                all_snippets = desc_snippets + sig_snippets
                if all_snippets:
                    context_lines = "\n".join(
                        f"- {r.get('title', '')} | {r.get('snippet', '')}"
                        for r in all_snippets[:10]  # cap at 10 snippets to keep prompt lean
                    )
                    text = f"{text}\n\nCompany research context:\n{context_lines}"
            except Exception as e:
                logger.warning("Company research search failed for '%s': %s", company_name, e)

        return {
            "url": url,
            "text": text,
            "title": company_name,
            "snippet": snippet,
            "structured_data": {},
        }

    # Fetch all standalone sites concurrently
    results = await asyncio.gather(*(process_item(item) for item in standalone_items))
    pages = [p for p in results if p is not None]

    if not pages:
        logger.info("No pages to extract for request %s", request_id)
        return []

    logger.info("Extracting leads from %d pages for request %s", len(pages), request_id)

    enriched: list[dict] = await extract_leads_from_pages(pages, context)
    
    # ── Fallback Resolvers for Compulsory Webpage and LinkedIn ──────────────────
    async def enrich_with_fallbacks(e: dict) -> dict:
        company_name = e.get("company_name") or e.get("title") or ""
        
        # 1. Fallback for website if missing
        if not e.get("website") or str(e.get("website")).lower() == 'null':
            fallback_web = await _fetch_company_website_fallback(company_name)
            if fallback_web:
                e["website"] = fallback_web
                
        # 2. Fallback for linkedin_url if missing
        if not e.get("linkedin_url") or str(e.get("linkedin_url")).lower() == 'null':
            fallback_li = await _fetch_company_linkedin_fallback(company_name)
            if fallback_li:
                e["linkedin_url"] = fallback_li
                
        return e

    if enriched:
        logger.info("Resolving website and LinkedIn fallbacks for %d candidate leads...", len(enriched))
        enriched = await asyncio.gather(*(enrich_with_fallbacks(e) for e in enriched))

    # Filter to only keep leads with at least a valid email or phone number and compulsory website & linkedin
    _email_validator = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
    _phone_validator = re.compile(r"^\+?[0-9\s\-\(\).]{7,}$")

    # Require a working website. Score gate is intentionally low (30) because
    # this pipeline works from Serper snippets, not full website scrapes.
    # A non-zero score confirms the LLM found a recognisable company entity.
    def is_valid_lead(e: dict) -> bool:
        website = str(e.get("website") or "").strip()

        if not website or website.lower() == 'null':
            return False

        # Parse match score
        match_score_str = str(e.get("match_score") or "0").strip()
        try:
            score = int(float(match_score_str.split("/")[0].strip()))
        except (ValueError, TypeError):
            score = 0

        if score == 0:
            return False

        # Accept any lead with a non-trivial ICP match (lowered from 60 → 30 because
        # snippets rarely carry enough firmographic signal for a confident 60+ score).
        if score >= 30:
            return True

        email = str(e.get("contact_email") or "").strip()
        phone = str(e.get("contact_phone") or "").strip()
        if email and email.lower() != 'null' and _email_validator.match(email):
            return True
        if phone and phone.lower() != 'null' and _phone_validator.match(phone):
            return True
        return False

    enriched = [e for e in enriched if is_valid_lead(e)]

    # ── Email verification (MX-only, fast/non-blocking) ─────────────────────
    # Attach deliverability signals so the UI can show verification badges.
    # We use MX-only mode here (skip the slow SMTP probe) to keep the pipeline
    # responsive; the on-demand per-lead endpoint runs the full SMTP probe.
    await _verify_lead_emails(enriched)

    return enriched


async def _verify_lead_emails(enriched: list[dict]) -> None:
    """
    Verify the ``contact_email`` on each enriched lead in place, attaching:
      • email_verified   (bool)
      • email_confidence (high|medium|low)
      • email_verify_method / email_verify_reason
    Leads without a syntactically valid email are left untouched.
    """
    _email_re = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
    to_verify = [
        e for e in enriched
        if (str(e.get("contact_email") or "").strip()
            and str(e.get("contact_email")).strip().lower() != "null"
            and _email_re.match(str(e.get("contact_email")).strip()))
    ]
    if not to_verify:
        return

    emails = [str(e.get("contact_email")).strip() for e in to_verify]
    logger.info("Verifying deliverability of %d lead email(s)...", len(emails))
    try:
        results = await verify_emails_batch(emails, concurrency=8, smtp_probe=False)
    except Exception as exc:
        logger.warning("Email verification batch failed: %s", exc)
        return

    for lead, res in zip(to_verify, results, strict=False):
        lead["email_verified"] = res.get("verified")
        lead["email_confidence"] = res.get("confidence")
        lead["email_verify_method"] = res.get("method")
        lead["email_verify_reason"] = res.get("reason")


async def _enrich_leads_with_decision_makers(
    enriched: list[dict],
    request_payload: dict,
    request_id: str
) -> list[dict]:
    """
    Find key decision-makers at each company via Google Dorking + Serper,
    using titles derived from the Ideal Customer Profile (ICP).
    """
    if not enriched:
        return []

    # 1. Derive search roles from the campaign's ideal lead profile
    ideal_lead_profile = request_payload.get("ideal_lead_profile") or request_payload.get("icp") or ""
    logger.info("Extracting outreach titles based on profile: '%s'", ideal_lead_profile[:100])
    target_roles = await extract_target_outreach_roles(ideal_lead_profile)
    logger.info("Outreach target roles: %s", target_roles)

    if not target_roles:
        target_roles = ["CEO", "Founder", "Owner"]

    # Format the roles query part: e.g. ("CEO" OR "Founder" OR "CTO")
    roles_query_part = " OR ".join(f'"{r}"' for r in target_roles)
    roles_query_part = f"({roles_query_part})"

    # Limit concurrency for decision-maker Serper calls
    semaphore = asyncio.Semaphore(10)

    async def enrich_linkedin_posts(dm: dict, company_name: str) -> dict:
        person_name = str(dm.get("name") or "").strip()
        if not person_name:
            return dm

        query = (
            f'site:linkedin.com/posts OR site:linkedin.com/feed/update '
            f'"{person_name}" "{company_name}"'
        )
        try:
            async with semaphore:
                data = await fetch_leads_from_serper(query)
            organic = data.get("organic", [])
            summary = await summarize_linkedin_posts_from_serper(
                organic,
                person_name=person_name,
                company_name=company_name,
            )
            dm["recent_activity_summary"] = summary.get("recent_activity_summary")
            dm["recent_posts"] = summary.get("recent_posts") or []
        except Exception as exc:
            logger.warning(
                "Failed to summarize LinkedIn post activity for '%s' at '%s': %s",
                person_name, company_name, exc,
            )
            dm.setdefault("recent_activity_summary", None)
            dm.setdefault("recent_posts", [])
        return dm

    def _guess_domain(lead: dict) -> str:
        website = lead.get("website") or lead.get("url") or ""
        if not website:
            return ""
        return re.sub(r'^https?://(www\.)?', '', str(website)).split('/')[0].strip()

    async def _dm_search(query: str, company_name: str, domain: str) -> list[dict]:
        """Run a Serper LinkedIn search, extract DMs, and guess emails from the domain."""
        async with semaphore:
            data = await fetch_leads_from_serper(query)
        organic = data.get("organic", [])
        dms = await extract_decision_makers_from_serper(organic, company_name)
        for dm in dms:
            if not dm.get("email") and dm.get("name") and domain:
                parts = dm["name"].lower().strip().split()
                if len(parts) >= 2:
                    dm["email"] = f"{parts[0]}.{parts[-1]}@{domain}"
                elif len(parts) == 1:
                    dm["email"] = f"{parts[0]}@{domain}"
        return dms

    def _fallback_dm(lead: dict, company_name: str, domain: str) -> dict:
        """
        Build a guaranteed contact when no public decision-maker can be found.
        Prefers a contact captured during page extraction; otherwise synthesises a
        generic company point-of-contact so every company has at least one entry.
        """
        contact_name = str(lead.get("contact_name") or "").strip()
        contact_title = str(lead.get("contact_title") or "").strip()
        contact_email = str(lead.get("contact_email") or lead.get("email") or "").strip()
        if contact_email.lower() == "null":
            contact_email = ""
        primary_role = target_roles[0] if target_roles else "Decision Maker"
        email = contact_email or (f"contact@{domain}" if domain else None)
        has_named_contact = bool(contact_name)
        return {
            "name": contact_name or "Primary Contact",
            "title": contact_title or primary_role,
            "linkedin_url": lead.get("linkedin_url") or "",
            "email": email,
            "snippet": (
                "Primary contact sourced from the company website."
                if has_named_contact else
                f"General point of contact for {company_name}; no named decision-maker was found publicly."
            ),
            "recent_activity_summary": None,
            "recent_posts": [],
            "is_fallback": not has_named_contact,
        }

    async def find_dms_for_lead(lead: dict) -> dict:
        raw_company = lead.get("company_name") or lead.get("title") or ""
        company_name = clean_company_name(raw_company)
        if not company_name:
            lead["decision_makers"] = []
            return lead

        domain = _guess_domain(lead)
        dms: list[dict] = []

        try:
            # Tier 1 — targeted, role-based Google Dork search.
            query = f'site:linkedin.com/in/ "{company_name}" {roles_query_part}'
            logger.info("Searching decision-makers for '%s' (cleaned: '%s') using query: %s", raw_company, company_name, query)
            dms = await _dm_search(query, company_name, domain)
            logger.info("Found %d role-matched decision makers for '%s'", len(dms), company_name)

            # Tier 2 — broaden the net to any current employee if the role search was empty.
            if not dms:
                broad_query = f'site:linkedin.com/in/ "{company_name}"'
                logger.info("No role-matched DMs for '%s'; broadening search: %s", company_name, broad_query)
                dms = await _dm_search(broad_query, company_name, domain)
                logger.info("Broadened search found %d decision makers for '%s'", len(dms), company_name)

            if dms:
                dms = list(await asyncio.gather(*(enrich_linkedin_posts(dm, company_name) for dm in dms)))
        except Exception as exc:
            logger.warning("Failed to find decision-makers for '%s': %s", company_name, exc)
            dms = []

        # Tier 3 — guarantee at least one contact per company.
        if not dms:
            logger.info("No public decision-makers for '%s'; using fallback contact", company_name)
            dms = [_fallback_dm(lead, company_name, domain)]

        lead["decision_makers"] = dms
        return lead

    # Enrich all leads concurrently with a per-lead timeout so a single hung
    # Serper/LLM call cannot stall the entire pipeline indefinitely.
    _DM_TIMEOUT = 120  # seconds per company

    async def _safe_find_dms(lead: dict) -> dict:
        try:
            return await asyncio.wait_for(find_dms_for_lead(lead), timeout=_DM_TIMEOUT)
        except asyncio.TimeoutError:
            company = lead.get("company_name") or lead.get("title") or "unknown"
            logger.warning("DM enrichment timed out for '%s' — using fallback contact", company)
            lead["decision_makers"] = []
            return lead
        except Exception as exc:
            company = lead.get("company_name") or lead.get("title") or "unknown"
            logger.warning("DM enrichment failed for '%s': %s", company, exc)
            lead["decision_makers"] = []
            return lead

    enriched = await asyncio.gather(*(_safe_find_dms(lead) for lead in enriched))
    return enriched


# ── Top-level pipeline ────────────────────────────────────────────────────────

async def run_lead_pipeline(request_id: str, request_payload: dict) -> list[dict]:
    """
    Full pipeline for a single lead-generation request.

    request_payload may include raw `icp` text. Any missing request fields are auto-derived.
    """
    request_payload = await normalize_lead_request_payload(request_payload)
    user_id = str(request_payload.get("user_id", ""))
    start_time = time.time()

    # ── Build seller exclusion set from ICP ───────────────────────────────────
    # The ICP text always starts with the seller's own product name ("Product Name: Anthra AI").
    # We must NEVER return the seller itself as a lead.
    icp_text = request_payload.get("ideal_lead_profile") or request_payload.get("icp") or ""
    seller_name = extract_seller_name(icp_text)
    # Also grab the title which often contains the product/campaign name
    title_name = (request_payload.get("title") or "").lower().strip()
    seller_names: set[str] = {n for n in [seller_name, title_name] if n}
    if seller_names:
        logger.info("Seller self-exclusion names: %s", seller_names)

    # ── Step 1 & 2: Generate + store queries ─────────────────────────────────
    queries = await _generate_and_store_queries(request_id, request_payload)
    if not queries:
        await update_request_status(
            request_id, "Failed", failure_reason="Could not generate search queries. Check your LLM key and your ideal customer profile."
        )
        return []

    # ── Step 3: Search Serper ─────────────────────────────────────────────────
    raw_results, serper_failure = await _fetch_all_serper_results(queries)
    if not raw_results:
        logger.warning("No Serper results for request %s", request_id)
        await update_request_status(
            request_id, "Failed",
            failure_reason=serper_failure or "The search returned no results. Try broadening your ideal customer profile.",
        )
        return []

    # ── Step 4: Deduplicate ───────────────────────────────────────────────────
    unique_results = _deduplicate_urls(raw_results)
    logger.info("%d unique URLs after dedup for request %s", len(unique_results), request_id)

    # ── Step 5: Classify — standalone vs directory ────────────────────────────
    standalone_items, directory_items = await process_serper_results_batch(unique_results)
    logger.info(
        "Request %s: %d standalone, %d directory URLs",
        request_id, len(standalone_items), len(directory_items),
    )

    # ── Steps 6, 7 & 8: Dynamic loop to guarantee minimum of 5 enriched leads ───
    all_standalone = list(standalone_items)
    directories_to_expand = list(directory_items)
    
    enriched = []
    seen_lead_hosts: set[str] = set()
    all_processed_standalone = []
    
    def add_unique_leads(new_leads: list[dict]):
        for lead in new_leads:
            # Prefer the company's official website (if extracted) for identity/deduping.
            url = lead.get("website") or lead.get("source_url") or lead.get("page_url") or ""
            host_key = canonical_host(url)
            if host_key:
                if host_key in seen_lead_hosts:
                    continue
                seen_lead_hosts.add(host_key)
                lead["website"] = lead.get("website") or canonical_website(url)
                # Preserve the specific scraped page URL for provenance.
                # Normalize source_url to the canonical website so downstream storage/UI doesn't show /contact duplicates.
                lead["page_url"] = lead.get("page_url") or lead.get("source_url") or url
                lead["source_url"] = lead["website"]
                enriched.append(lead)
                continue

            # If we cannot parse a host, fall back to keeping the item (better than dropping)
            enriched.append(lead)

    # Process standalone leads in small incremental batches to minimize scraping overhead and exit early once we hit target leads
    BATCH_SIZE = 10
    
    # Extract num_leads from request_payload, defaulting to 10 if not provided
    TARGET_ENRICHED = request_payload.get("num_leads") or 10

    while len(enriched) < TARGET_ENRICHED and (all_standalone or directories_to_expand):
        # Always try to expand a directory to guarantee both sources are processed
        if directories_to_expand:
            next_dirs = directories_to_expand[:2]
            directories_to_expand = directories_to_expand[2:]
            logger.info("Expanding next %d directories for more candidates...", len(next_dirs))
            expanded = await _expand_directories(next_dirs)
            if expanded:
                if len(expanded) > BATCH_SIZE * 2:
                    expanded = expanded[:BATCH_SIZE * 2]
                exp_standalone, _ = await process_serper_results_batch(expanded)
                
                # Add to candidates list for next processing pass
                all_standalone.extend(_deduplicate_urls(exp_standalone))
                all_standalone = _deduplicate_urls(all_standalone)
                logger.info("Added new standalone candidates from directory expansion")

        # Process any available standalone items
        if all_standalone and len(enriched) < TARGET_ENRICHED:
            batch = all_standalone[:BATCH_SIZE]
            all_standalone = all_standalone[BATCH_SIZE:]
            # Dedup batch against companies collection before scraping
            batch = await _dedup_against_companies(batch)
            all_processed_standalone.extend(batch)
            
            logger.info("Processing batch of %d standalone leads. Current enriched count: %d", len(batch), len(enriched))
            batch_enriched = await _scrape_and_extract(batch, request_payload, request_id, user_id)
            
            # Filter out self-matches or junk before expensive enrichment
            batch_enriched = [e for e in batch_enriched if not _is_seller_or_junk_lead(e, seller_names)]
            
            # Enrich with decision makers — this is best-effort; leads without DMs are still valid
            batch_enriched = await _enrich_leads_with_decision_makers(batch_enriched, request_payload, request_id)
            # NOTE: We intentionally do NOT filter out leads with empty decision_makers here.
            # Keeping all valid leads ensures we reach the requested num_leads count.
            # Leads with no DMs found will have decision_makers=[] which is acceptable.
            
            add_unique_leads(batch_enriched)

        # If we've exhausted all candidates but still haven't reached the target,
        # generate a fresh batch of queries with a different prompt angle and retry once.
        if not all_standalone and not directories_to_expand and len(enriched) < TARGET_ENRICHED:
            still_need = TARGET_ENRICHED - len(enriched)
            logger.info(
                "Candidate pool exhausted with %d/%d leads — generating additional queries to find %d more",
                len(enriched), TARGET_ENRICHED, still_need,
            )
            extra_payload = dict(request_payload)
            extra_payload["_extra_queries_round"] = (extra_payload.get("_extra_queries_round") or 0) + 1
            # Only retry once to avoid infinite loops
            if extra_payload["_extra_queries_round"] <= 1:
                extra_queries = await _generate_and_store_queries(request_id, extra_payload)
                if extra_queries:
                    extra_raw, _ = await _fetch_all_serper_results(extra_queries)
                    if extra_raw:
                        extra_unique = _deduplicate_urls(extra_raw)
                        extra_standalone, extra_dirs = await process_serper_results_batch(extra_unique)
                        all_standalone.extend(extra_standalone)
                        directories_to_expand.extend(extra_dirs)
                        # Update request_payload so next loop iteration uses the retry flag
                        request_payload = extra_payload
                        logger.info(
                            "Extra query round added %d standalone + %d directory candidates",
                            len(extra_standalone), len(extra_dirs),
                        )
            else:
                break  # Already retried once, stop to avoid wasting API calls

    # Save basic standalone leads to DB (capped at a higher limit to ensure DB is populated)
    if all_processed_standalone:
        # Cap at 100 to prevent overwhelming DB in extreme edge cases
        await process_and_save_standalone_leads(all_processed_standalone[:100], request_id, user_id)

    # ── Step 9: Enrichment and save ──────────────────────────────────────────
    if enriched:
        # Tech stack probing
        try:
            enriched = await _attach_tech_stacks_to_leads(enriched)
        except Exception as exc:
            logger.warning("Tech stack attachment failed for request %s: %s", request_id, exc)

        # LinkedIn firmographics + market signals
        from app.services.company_enrichment import (
            enrich_leads_with_linkedin_firmographics,
            enrich_leads_with_market_signals,
        )
        try:
            enriched = await enrich_leads_with_linkedin_firmographics(enriched)
        except Exception as exc:
            logger.warning("LinkedIn enrichment failed for request %s: %s", request_id, exc)
        try:
            enriched = await enrich_leads_with_market_signals(enriched)
        except Exception as exc:
            logger.warning("Signal enrichment failed for request %s: %s", request_id, exc)

        if settings.ICP_FILTER_ENABLED:
            before = len(enriched)
            enriched = filter_leads_by_icp(enriched, request_payload.get("icp_dimensions"))
            logger.info("ICP filter kept %d of %d leads for request %s", len(enriched), before, request_id)

        if not await request_exists(request_id):
            logger.info("Request %s was deleted while running; discarding its results", request_id)
            return []
        await save_enriched_leads_to_db(request_id, user_id, enriched)
        logger.info("Saved %d final high-quality enriched leads with decision-makers for request %s", len(enriched), request_id)

    # ── Step 10: Mark complete ────────────────────────────────────────────────
    end_time = time.time()
    duration = round(end_time - start_time, 2)
    await update_request_status(request_id, "Completed", time_taken=duration)
    logger.info(
        "Request %s completed in %.2fs — %d enriched leads", request_id, duration, len(enriched)
    )
    return enriched


# ── Direct-companies pipeline ─────────────────────────────────────────────────

async def _resolve_company(raw_company: str) -> dict | None:
    """
    Resolve a user-supplied company name or domain into a basic enriched-lead dict.

    - If the input looks like a domain/URL, use it directly as the website.
    - Otherwise, search Serper for the company's official website.
    - Always attempt to resolve the official LinkedIn company page.

    Returns a dict shaped like the entries produced by `_scrape_and_extract`
    (company_name, website, source_url, linkedin_url, match_score) so the
    existing decision-maker enrichment and save logic can be reused as-is.
    Returns None if no usable website can be resolved.

    Uses _RESOLVE_SEM to cap concurrency and prevent Serper 429 floods when
    resolving large batches of companies simultaneously.
    """
    raw = (raw_company or "").strip()
    if not raw:
        return None

    async with _RESOLVE_SEM:
        try:
            looks_like_domain = bool(re.match(r"^(https?://)?[\w-]+(\.[\w-]+)+", raw)) and " " not in raw

            website: str | None = None
            company_name = raw

            if looks_like_domain:
                website = canonical_website(raw)
                host = canonical_host(raw)
                # Derive a human-friendly name from the domain (e.g. "acme.com" → "Acme").
                if host:
                    company_name = host.split(".")[0].replace("-", " ").replace("_", " ").title()
            else:
                website = await asyncio.wait_for(
                    _fetch_company_website_fallback(company_name), timeout=30
                )

            if not website or str(website).lower() == "null":
                logger.warning("Could not resolve a website for company '%s'", raw)
                return None

            linkedin_url = await asyncio.wait_for(
                _fetch_company_linkedin_fallback(company_name), timeout=30
            )

            return {
                "company_name": company_name,
                "title": company_name,
                "website": canonical_website(website),
                "source_url": canonical_website(website),
                "linkedin_url": linkedin_url,
                "match_score": "100",
            }
        except asyncio.TimeoutError:
            logger.warning("Timed out resolving company '%s' — skipping", raw)
            return None
        except Exception as exc:
            logger.warning("Error resolving company '%s': %s", raw, exc)
            return None


async def run_direct_companies_pipeline(
    request_id: str,
    companies: list[str],
    target_roles: list[str],
    user_id: str,
) -> list[dict]:
    """
    Pipeline for the 'direct companies → decision makers' flow.

    Skips query generation / Serper discovery / URL classification. For each
    user-supplied company it resolves the official website + LinkedIn, finds
    decision makers (using the user-provided target roles), then persists the
    enriched leads with the same storage path as the ICP flow.
    """
    start_time = time.time()

    # Deduplicate while preserving order.
    seen: set[str] = set()
    unique_companies: list[str] = []
    for c in companies:
        key = (c or "").strip().lower()
        if key and key not in seen:
            seen.add(key)
            unique_companies.append(c.strip())

    if not unique_companies:
        logger.warning("No companies provided for direct request %s", request_id)
        await update_request_status(request_id, "Failed", failure_reason="No companies were provided.")
        return []

    logger.info("Resolving %d companies for direct request %s", len(unique_companies), request_id)
    resolved = await asyncio.gather(*(_resolve_company(c) for c in unique_companies))
    enriched = [r for r in resolved if r]

    if not enriched:
        logger.warning("No companies could be resolved for direct request %s", request_id)
        await update_request_status(
            request_id, "Failed", failure_reason="None of the companies could be matched to a website. Check the names and try again."
        )
        return []

    # Build a payload that drives decision-maker role extraction. The existing
    # `_enrich_leads_with_decision_makers` derives roles from `ideal_lead_profile`,
    # so we encode the user's explicit roles there as a "Decision Makers:" line.
    cleaned_roles = [r.strip() for r in (target_roles or []) if r and r.strip()]
    ideal_lead_profile = (
        f"Decision Makers: {', '.join(cleaned_roles)}" if cleaned_roles else ""
    )
    request_payload = {"ideal_lead_profile": ideal_lead_profile, "user_id": user_id}

    logger.info("Finding decision makers for %d resolved companies (request %s)", len(enriched), request_id)
    enriched = await _enrich_leads_with_decision_makers(enriched, request_payload, request_id)

    # Attach tech stack / infrastructure profiles (basic company enrichment).
    try:
        enriched = await _attach_tech_stacks_to_leads(enriched)
    except Exception as exc:
        logger.warning("Tech stack attachment failed for direct request %s: %s", request_id, exc)

    # LinkedIn firmographics + market signals
    from app.services.company_enrichment import (
        enrich_leads_with_linkedin_firmographics,
        enrich_leads_with_market_signals,
    )
    try:
        enriched = await enrich_leads_with_linkedin_firmographics(enriched)
    except Exception as exc:
        logger.warning("LinkedIn enrichment failed for direct request %s: %s", request_id, exc)
    try:
        enriched = await enrich_leads_with_market_signals(enriched)
    except Exception as exc:
        logger.warning("Signal enrichment failed for direct request %s: %s", request_id, exc)

    # Attach email deliverability signals (MX-only, fast) before persisting.
    await _verify_lead_emails(enriched)

    if not await request_exists(request_id):
        logger.info("Request %s was deleted while running; discarding its results", request_id)
        return []
    await save_enriched_leads_to_db(request_id, user_id, enriched)

    duration = round(time.time() - start_time, 2)
    await update_request_status(request_id, "Completed", time_taken=duration)
    logger.info(
        "Direct request %s completed in %.2fs — %d enriched leads",
        request_id, duration, len(enriched),
    )
    return enriched


async def run_direct_companies_background(
    request_id: str,
    companies: list[str],
    target_roles: list[str],
    user_id: str,
    serper_api_key: str | None = None,
) -> None:
    try:
        if serper_api_key:
            current_serper_key.set(serper_api_key)
        await run_direct_companies_pipeline(request_id, companies, target_roles, user_id)
    except BaseException as exc:  # catches asyncio.CancelledError too
        logger.error("Direct-companies pipeline failed for request %s: %s", request_id, exc, exc_info=True)
        try:
            await update_request_status(
                request_id, "Failed", failure_reason="The run stopped unexpectedly (%s). Please try again." % type(exc).__name__
            )
        except Exception:
            pass
        # Re-raise CancelledError so the event loop can propagate cancellation correctly.
        if isinstance(exc, asyncio.CancelledError):
            raise


# ── ICP filtering ─────────────────────────────────────────────────────────────

ICP_SCORE_THRESHOLD = settings.ICP_SCORE_THRESHOLD


def filter_leads_by_icp(
    leads: list[dict], icp_dimensions: dict | None, threshold: int | None = None
) -> list[dict]:
    """Drop leads scoring below the threshold or whose employee size cannot fit the ICP range.

    Leads whose enrichment failed are always kept: they have no score because the AI step failed, not because
    they are a poor fit. Only applied by the pipeline when settings.ICP_FILTER_ENABLED is true.
    """
    if not leads:
        return leads
    min_score = ICP_SCORE_THRESHOLD if threshold is None else threshold

    def _score(lead: dict) -> int:
        try:
            return int(float(str(lead.get("match_score") or "0").split("/")[0].strip()))
        except (ValueError, TypeError):
            return 0

    leads = [ld for ld in leads if ld.get("enrichment_failed") or _score(ld) >= min_score]

    icp_employee_range: tuple[int, int] | None = None
    if isinstance(icp_dimensions, dict):
        firmographic = icp_dimensions.get("firmographic") or {}
        ftext = firmographic.get("value", "") if isinstance(firmographic, dict) else str(firmographic)
        icp_employee_range = parse_employee_range(ftext)

    if icp_employee_range is None:
        return leads

    filtered = []
    for lead in leads:
        emp_str = lead.get("employee_size_estimate") or ""
        if not emp_str:
            filtered.append(lead)
            continue
        lead_range = parse_employee_range(str(emp_str))
        if lead_range is None or ranges_overlap(icp_employee_range, lead_range):
            filtered.append(lead)
        else:
            logger.info(
                "ICP filter: excluded lead '%s' employee_size='%s' outside ICP range %s",
                lead.get("company_name", ""), emp_str, icp_employee_range,
            )
    return filtered


# ── Background pipeline task ──────────────────────────────────────────────────

async def run_pipeline_background(
    request_id: str, data_dict: dict, user_id: str, serper_api_key: str | None = None
) -> None:
    try:
        if serper_api_key:
            current_serper_key.set(serper_api_key)
        data_dict["user_id"] = user_id
        await run_lead_pipeline(request_id, data_dict)
    except BaseException as exc:  # catches asyncio.CancelledError too
        logger.error("Pipeline failed for request %s: %s", request_id, exc, exc_info=True)
        try:
            await update_request_status(
                request_id, "Failed", failure_reason="The run stopped unexpectedly (%s). Please try again." % type(exc).__name__
            )
        except Exception:
            pass
        # Re-raise CancelledError so the event loop can propagate cancellation correctly.
        if isinstance(exc, asyncio.CancelledError):
            raise


# ── Retry a failed lead enrichment ────────────────────────────────────────────

async def retry_lead_enrichment(lead_id: str, user_id: str) -> dict:
    """Re-run the AI extraction for one lead whose enrichment failed. Raises LookupError if the lead is gone.

    Returns {"lead_id", "enrichment_failed", "reason"}; a still-failing lead keeps its failure marker.
    """
    from app.db.leads import get_lead_for_user

    lead = await get_lead_for_user(lead_id, user_id)
    if not lead:
        raise LookupError("Lead not found")
    request_id = lead.get("request_id") or ""
    req = await get_request_by_id(request_id, user_id) or {}
    context = {
        "business_type": req.get("business_type") or "",
        "target_location": req.get("target_location") or "",
        "ideal_lead_profile": req.get("ideal_lead_profile") or "",
        "title": req.get("title") or "",
    }
    item = {"url": lead.get("url") or "", "title": lead.get("title") or "", "snippet": lead.get("snippet") or ""}
    results = await _scrape_and_extract([item], context, request_id, user_id)
    if not results:
        raise RuntimeError("Nothing could be extracted for this lead")
    result = results[0]
    result["source_url"] = lead.get("url") or result.get("source_url")
    await save_enriched_leads_to_db(request_id, user_id, [result])
    return {
        "lead_id": lead_id,
        "enrichment_failed": bool(result.get("enrichment_failed")),
        "reason": result.get("enrichment_failure_reason"),
    }


# ── Leads retrieval ───────────────────────────────────────────────────────────

async def get_leads_for_request(request_id: str, user_id) -> dict:
    from fastapi import HTTPException
    from app.services.competitor_service import get_competitors
    doc = await get_request_by_id(request_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Lead request not found")

    leads = await get_normalized_leads_for_request(request_id)
    competitors: list[dict] = []
    try:
        comp_doc = await get_competitors(request_id, str(user_id))
        competitors = comp_doc.get("competitors", []) or []
    except Exception as exc:
        logger.warning("Failed to load competitors for request %s: %s", request_id, exc)
    # Removing post-db filtering to ensure details view matches summary view counts

    return {
        "request_id": str(doc.get("_id")),
        "status": doc.get("status"),
        "queries": doc.get("queries", []),
        "leads": leads,
        "competitors": competitors,
        "total_found": len(leads),
        "user_query": {
            "title": doc.get("title"),
            "business_type": doc.get("business_type"),
            "ideal_lead_profile": doc.get("ideal_lead_profile"),
            "budget_target_size": doc.get("budget_target_size"),
            "target_location": doc.get("target_location"),
            "created_at": doc.get("created_at").isoformat() if doc.get("created_at") else None,
            "status": doc.get("status"),
        },
    }


async def get_decision_makers_service(request_id: str, user_id) -> dict:
    from fastapi import HTTPException
    from app.db.decision_makers import get_decision_makers_for_request

    doc = await get_request_by_id(request_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Lead request not found")

    dms = await get_decision_makers_for_request(request_id)
    return {
        "request_id": request_id,
        "total_contacts": len(dms),
        "decision_makers": dms,
    }


async def get_request_status_summary(request_id: str, user_id) -> dict:
    from fastapi import HTTPException
    from app.db.requests import get_request_status_doc
    from app.db.leads import count_leads_for_request
    doc = await get_request_status_doc(request_id, user_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Lead request not found")

    leads_count = await count_leads_for_request(request_id)
    return {
        "request_id": request_id,
        "status": doc.get("status", "Pending"),
        "leads_count": leads_count,
        "queries_count": len(doc.get("queries", [])),
    }
