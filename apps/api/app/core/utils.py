"""
Shared utility functions used across the application.

Consolidates helpers for URL handling, text processing, and data manipulation
that were previously duplicated across service and DB modules.
"""

import re
from datetime import datetime, timezone
from typing import Any, List, Optional
from urllib.parse import urlparse


def normalize_url(url: str) -> str:
    """Prepend https:// if no scheme is present."""
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        return f"https://{url}"
    return url


def utc_now_iso() -> str:
    """Return the current UTC timestamp in ISO 8601 format."""
    return datetime.now(timezone.utc).isoformat()


def domain_slug(url: str) -> str:
    """Convert a URL into a filesystem-safe slug based on the domain."""
    domain = urlparse(normalize_url(url)).netloc.replace("www.", "")
    return re.sub(r"[^a-zA-Z0-9]+", "_", domain).strip("_") or "unknown"


def extract_canonical_domain(url: str) -> str:
    """Extract the bare domain from a URL, stripping www/scheme/path/port."""
    if not url:
        return ""
    candidate = url.strip()
    if "://" not in candidate:
        candidate = "https://" + candidate
    try:
        parsed = urlparse(candidate)
        host = (parsed.netloc or "").lower().strip()
        if host.startswith("www."):
            host = host[4:]
        host = host.split(":")[0]
        return host
    except Exception:
        return url.strip().lower()


def canonical_host(url: str) -> str:
    """
    Canonicalize a URL to a host key for identity matching.

    Different paths on the same host (/, /about, /contact) resolve to the same key.
    Handles edge cases: missing scheme, www prefix, credentials, port numbers.
    """
    if not url:
        return ""

    candidate = url.strip()
    if not candidate:
        return ""

    parsed = urlparse(candidate if "://" in candidate else f"https://{candidate}")
    host = (parsed.netloc or "").lower().strip()
    if not host and parsed.path and "." in parsed.path and "/" not in parsed.path:
        host = parsed.path.lower().strip()

    if host.startswith("www."):
        host = host[4:]

    if "@" in host:
        host = host.split("@", 1)[1]
    if ":" in host:
        host = host.split(":", 1)[0]

    return host


def canonical_website(url: str) -> str:
    """Build a canonical https:// URL from a raw URL string."""
    host = canonical_host(url)
    return f"https://{host}" if host else (url or "").strip()


def clean_company_name(name: str) -> str:
    """Strip common corporate suffixes (Inc, Ltd, LLC, etc.) for cleaner search queries."""
    if not name:
        return ""
    suffixes = [
        r"\bpvt\b\.?", r"\bltd\b\.?", r"\binc\b\.?",
        r"\bllc\b\.?", r"\bco\b\.?", r"\bcorp\b(oration)?\.?"
    ]
    cleaned = name
    for suff in suffixes:
        cleaned = re.sub(suff, "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(",. \"'")


def extract_seller_name(icp_text: str) -> str:
    """
    Extract the seller's product/company name from ICP text by scanning for
    labelled fields such as 'Product Name: <value>' or 'Company Name: <value>'.

    Returns the extracted name lowercased, or empty string if not found.
    """
    if not icp_text:
        return ""
    m = re.search(
        r'(?:product|company|tool|service|our\s+product|our\s+company)\s+name\s*[:\-]\s*(.+)',
        icp_text,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).strip().lower()
    m2 = re.search(
        r'(?:our\s+product|seller|vendor|client\s+name|product)\s*[:\-]\s*(.+)',
        icp_text,
        re.IGNORECASE,
    )
    if m2:
        return m2.group(1).strip().lower()
    return ""


def normalize_urls_list(raw: str) -> List[str]:
    """Split a comma/newline-separated string of URLs and prepend scheme if missing."""
    urls = []
    for token in raw.replace(",", "\n").split("\n"):
        token = token.strip()
        if token:
            urls.append(token if token.startswith("http") else f"https://{token}")
    return urls


def deduplicate_list_case_insensitive(items: list) -> list:
    """Deduplicate a list of strings case-insensitively, preserving original casing."""
    seen: set[str] = set()
    unique: list = []
    for item in items:
        if item and str(item).strip():
            clean = str(item).strip()
            normalized = clean.lower()
            if normalized not in seen:
                seen.add(normalized)
                unique.append(clean)
    return unique


def parse_employee_range(text: str) -> Optional[tuple[int, int]]:
    """Parse employee count strings like '50-200', '500+', or 'up to 100'."""
    if not text:
        return None
    m = re.search(r"(\d[\d,]*)\s*[-–]\s*(\d[\d,]*)", text)
    if m:
        return (int(m.group(1).replace(",", "")), int(m.group(2).replace(",", "")))
    m = re.search(r"(\d[\d,]*)\s*\+", text)
    if m:
        return (int(m.group(1).replace(",", "")), 10_000_000)
    m = re.search(r"(?:up\s+to|under|less\s+than)\s+(\d[\d,]*)", text, re.IGNORECASE)
    if m:
        return (1, int(m.group(1).replace(",", "")))
    return None


def ranges_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
    """Check if two numeric ranges overlap."""
    return a[0] <= b[1] and b[0] <= a[1]
