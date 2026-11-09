"""Signal detectors: hiring (careers-page diff), funding/news (RSS + classification) and tech-stack changes."""
from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from app.db.models import TABLES
from app.watch.ports import news_feed_url, ports

_events = TABLES["signal_events"]
_snaps = TABLES["watch_snapshots"]
_leads = TABLES["leads"]

KINDS = ("hiring", "funding", "tech")
MAX_DOMAINS_PER_SCAN = 40


def domain_of(url: str) -> str:
    host = (urlparse(url if "//" in url else f"//{url}").hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _key(user_id: str, kind: str, domain: str) -> str:
    return f"{user_id}|{kind}|{domain}"


async def _load(user_id: str, kind: str, domain: str) -> dict | None:
    return await _snaps.get(snapshot_key=_key(user_id, kind, domain))


async def _save(user_id: str, kind: str, domain: str, data: dict) -> None:
    await _snaps.upsert({"snapshot_key": _key(user_id, kind, domain)}, {"state": data, "updated_at": datetime.utcnow()})


async def _record(user_id: str, domain: str, kind: str, summary: str, details: dict) -> dict:
    ev = {"user_id": user_id, "domain": domain, "kind": kind, "summary": summary, "details": details,
          "detected_at": datetime.utcnow()}
    ev["_id"] = await _events.insert(ev)
    try:
        from app.integrations.webhooks import emit

        await emit(user_id, "signal.detected", {"domain": domain, "kind": kind, "summary": summary})
    except Exception:  # noqa: BLE001
        pass
    return ev


# ------------------------------------------------------------------ hiring
def extract_roles(html: str) -> set[str]:
    soup = BeautifulSoup(html or "", "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    out = set()
    for el in soup.find_all(["a", "h2", "h3", "h4", "li"]):
        text = re.sub(r"\s+", " ", el.get_text(" ", strip=True))
        if 4 <= len(text) <= 90 and len(text.split()) <= 12:
            out.add(text.lower())
    return out


async def scan_hiring(user_id: str, domain: str) -> dict | None:
    html = await ports.pages.get_html(f"https://{domain}/careers")
    if not html:
        return None
    roles = extract_roles(html)
    prev = await _load(user_id, "hiring", domain)
    await _save(user_id, "hiring", domain, {"roles": sorted(roles)})
    if prev is None:
        return None  # first sight is a baseline, not a signal
    old = set(prev["state"]["roles"])
    added = roles - old
    if not added or len(added) > max(15, int(len(old) * 0.8)):  # nothing new, or the whole page was redesigned
        return None
    sample = sorted(added)[:5]
    return await _record(user_id, domain, "hiring", f"{len(added)} new careers-page item(s): {', '.join(sample[:3])}",
                         {"added": sample, "count": len(added)})


# ------------------------------------------------------------------ funding / news
def parse_feed(xml_text: str) -> list[dict]:
    if re.search(r"<!(DOCTYPE|ENTITY)", xml_text or "", re.I):
        return []  # never parse feeds that declare entities (XXE / billion-laughs)
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        if title and link:
            items.append({"title": title, "link": link, "published": (it.findtext("pubDate") or "").strip()})
    return items[:15]


async def scan_news(user_id: str, domain: str, company: str) -> list[dict]:
    xml_text = await ports.feeds.get_xml(news_feed_url(company or domain))
    if not xml_text:
        return []
    items = parse_feed(xml_text)
    prev = await _load(user_id, "news", domain)
    seen = set(prev["state"]["seen"]) if prev else set()
    fresh = [i for i in items if hashlib.sha1(i["link"].encode()).hexdigest()[:16] not in seen]
    allseen = sorted(seen | {hashlib.sha1(i["link"].encode()).hexdigest()[:16] for i in items})[-200:]
    await _save(user_id, "news", domain, {"seen": allseen})
    if prev is None or not fresh:
        return []
    labels = await ports.classifier.classify(company or domain, fresh)
    out = []
    for item, label in zip(fresh, labels, strict=False):
        if label in ("funding", "acquisition", "launch", "layoffs"):
            kind = "funding" if label in ("funding", "acquisition") else "news"
            out.append(await _record(user_id, domain, kind, item["title"],
                                     {"label": label, "link": item["link"], "published": item["published"]}))
    return out


# ------------------------------------------------------------------ tech
async def scan_tech(user_id: str, domain: str) -> dict | None:
    stack = sorted(set(await ports.tech.detect(f"https://{domain}")))
    if not stack:
        return None
    prev = await _load(user_id, "tech", domain)
    await _save(user_id, "tech", domain, {"stack": stack})
    if prev is None:
        return None
    old = set(prev["state"]["stack"])
    added, removed = sorted(set(stack) - old), sorted(old - set(stack))
    if not added and not removed:
        return None
    parts = ([f"adopted {', '.join(added[:4])}"] if added else []) + ([f"dropped {', '.join(removed[:4])}"] if removed else [])
    return await _record(user_id, domain, "tech", "Tech stack: " + "; ".join(parts), {"added": added, "removed": removed})


# ------------------------------------------------------------------ orchestration
async def user_domains(user_id: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for lead in await _leads.find(_leads.model.user_id == user_id, limit=2000):
        d = domain_of(lead.get("url") or "")
        if d and d not in out:
            out[d] = {"company": lead.get("title") or d, "lead_ids": []}
        if d:
            out[d]["lead_ids"].append(lead["_id"])
    return out


async def scan_user(user_id: str, kinds: tuple[str, ...] = KINDS) -> dict:
    domains = await user_domains(user_id)
    found = {"hiring": 0, "funding": 0, "tech": 0, "news": 0, "domains": 0}
    for domain, info in list(domains.items())[:MAX_DOMAINS_PER_SCAN]:
        found["domains"] += 1
        try:
            if "hiring" in kinds and await scan_hiring(user_id, domain):
                found["hiring"] += 1
            if "funding" in kinds:
                for ev in await scan_news(user_id, domain, info["company"]):
                    found[ev["kind"]] += 1
            if "tech" in kinds and await scan_tech(user_id, domain):
                found["tech"] += 1
        except Exception:  # noqa: BLE001 - one broken site must not stop the sweep
            from app.core.logger import logger

            logger.exception("signal scan failed for %s", domain)
    return found


async def scan_all_users() -> int:
    ids = {r["user_id"] for r in await _leads.find(limit=20000) if r.get("user_id")}
    for uid in ids:
        await scan_user(uid)
    return len(ids)


async def recent_signals(user_id: str, domain: str | None = None, kind: str | None = None, days: int = 60,
                         limit: int = 100) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    where = [_events.model.user_id == user_id, _events.model.detected_at >= since]
    if domain:
        where.append(_events.model.domain == domain)
    if kind:
        where.append(_events.model.kind == kind)
    return await _events.find(*where, order_by=_events.model.detected_at.desc(), limit=limit)
