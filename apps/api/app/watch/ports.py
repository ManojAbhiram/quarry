"""Network edges for signals and alerts, behind swappable ports (tests assign fakes to `ports.<name>`)."""
from __future__ import annotations

import asyncio
import json
from email.mime.text import MIMEText
from typing import Protocol
from urllib.parse import quote_plus

import httpx

from app.core.config import settings
from app.core.logger import logger
from app.core.url_guard import safe_get
from app.integrations.webhooks import RealPoster


class PageFetcher(Protocol):
    async def get_html(self, url: str) -> str | None: ...


class FeedFetcher(Protocol):
    async def get_xml(self, url: str) -> str | None: ...


class NewsClassifier(Protocol):
    async def classify(self, company: str, items: list[dict]) -> list[str]:
        """One label per item: funding | acquisition | launch | layoffs | other."""


class TechDetector(Protocol):
    async def detect(self, url: str) -> list[str]: ...


class EmailSender(Protocol):
    async def send(self, to: str, subject: str, text: str) -> None: ...


class SlackPoster(Protocol):
    async def post(self, url: str, body: bytes, headers: dict[str, str]) -> int: ...


class RealPages:
    async def get_html(self, url: str) -> str | None:
        def fetch():
            r = safe_get(url, timeout=12, headers={"User-Agent": "Mozilla/5.0 QuarryBot"})
            return r.text if r.status_code == 200 else None

        try:
            return await asyncio.to_thread(fetch)
        except Exception as exc:  # noqa: BLE001
            logger.info("careers fetch failed for %s: %s", url, exc)
            return None


class RealFeeds:
    async def get_xml(self, url: str) -> str | None:
        try:
            async with httpx.AsyncClient(timeout=12, follow_redirects=True) as c:
                r = await c.get(url, headers={"User-Agent": "QuarryBot"})
                return r.text if r.status_code == 200 else None
        except httpx.HTTPError:
            return None


_KEYWORDS = {
    "funding": ("raises", "raised", "funding", "series a", "series b", "series c", "seed round", "investment"),
    "acquisition": ("acquires", "acquired", "acquisition", "merger"),
    "layoffs": ("layoffs", "lays off", "job cuts"),
    "launch": ("launches", "launched", "unveils", "announces"),
}


def keyword_label(title: str) -> str:
    t = title.lower()
    for label, words in _KEYWORDS.items():
        if any(w in t for w in words):
            return label
    return "other"


class LlmClassifier:
    """LLM classification through the app's existing LiteLLM helper; falls back to keywords if the call fails."""

    async def classify(self, company: str, items: list[dict]) -> list[str]:
        from app.services.llm import _llm_json_completion

        headlines = "\n".join(f"{i}. {it['title']}" for i, it in enumerate(items))
        try:
            data = await _llm_json_completion(
                model=settings.LITELLM_MODEL_MINI,
                system_prompt="Classify each news headline about a company. Labels: funding, acquisition, launch, "
                              "layoffs, other. Reply JSON: {\"labels\": [label per headline, same order]}.",
                user_prompt=f"Company: {company}\n{headlines}",
                max_tokens=300,
            )
            labels = data.get("labels") if isinstance(data, dict) else None
            if isinstance(labels, list) and len(labels) == len(items):
                return [lb if lb in _KEYWORDS or lb == "other" else "other" for lb in map(str, labels)]
        except Exception as exc:  # noqa: BLE001
            logger.info("news LLM classification failed, using keywords: %s", exc)
        return [keyword_label(it["title"]) for it in items]


class RealTech:
    async def detect(self, url: str) -> list[str]:
        from app.services.tech_stack import detect_technology_stack

        return await detect_technology_stack(url)


class SmtpEmail:
    async def send(self, to: str, subject: str, text: str) -> None:
        from app.services.email import _deliver

        msg = MIMEText(text, "plain")
        msg["Subject"], msg["To"] = subject, to
        await _deliver(msg)


class Ports:
    def __init__(self) -> None:
        self.pages: PageFetcher = RealPages()
        self.feeds: FeedFetcher = RealFeeds()
        self.classifier: NewsClassifier = LlmClassifier()
        self.tech: TechDetector = RealTech()
        self.email: EmailSender = SmtpEmail()
        self.slack: SlackPoster = RealPoster()


ports = Ports()


def news_feed_url(company: str) -> str:
    return f"https://news.google.com/rss/search?q={quote_plus(chr(34) + company + chr(34))}&hl=en-US"


def slack_body(text: str) -> bytes:
    return json.dumps({"text": text}).encode()
