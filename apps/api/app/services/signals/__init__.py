"""
Lead Intent Signal Collection Package.

This package provides zero-cost intent signal detection using
Serper Google dorking + LLM extraction.  Every signal source
lives in its own module and exposes an async `detect_*_signals()`
function that returns a list of signal dicts.

Signal dict schema:
    {
        "type":       str,   # e.g. "job_hiring", "funding_event", "news_mention"
        "source":     str,   # e.g. "greenhouse.io", "techcrunch.com"
        "title":      str,   # one-line summary
        "weight":     int,   # raw point contribution (before pillar cap)
        "confidence": str,   # "high" | "medium" | "low"
        "timestamp":  str,   # ISO date of signal (or detection date if unknown)
        "url":        str,   # source URL for "View source" link
        "summary":    str,   # 1-2 sentence explanation
        "category":   str,   # pillar: "intent" | "tech" | "engagement" | "firmographic"
    }
"""

from app.services.signals.orchestrator import collect_all_signals

__all__ = ["collect_all_signals"]
