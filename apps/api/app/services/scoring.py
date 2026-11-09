"""
Lead Intent Scoring Engine — 4-pillar model (PRD Phase 6)

Computes a composite intent score 0-100 across 4 pillars:
    Pillar 1: Firmographic Fit    MAX 25 pts  (from existing match_score)
    Pillar 2: Technographic Fit   MAX 20 pts
    Pillar 3: Intent Signals      MAX 35 pts  (job + funding + news)
    Pillar 4: Engagement Signals  MAX 20 pts  (social + content)

Score bands:
    80-100  →  HOT 🔥     →  Immediate outreach
    60-79   →  WARM       →  SDR sequence within 24 hours
    40-59   →  NURTURE    →  Add to nurture sequence
    20-39   →  WATCH      →  Monitor only
    0-19    →  COLD       →  Excluded from active lists

Score decay:
    -15% per 30 days for intent-based points if no new signal
"""

import logging
from datetime import datetime, timezone

from app.core.scoring_config import (
    CONFIDENCE_MULTIPLIERS,
    DECAY_PERIOD_DAYS,
    DECAY_RATE,
    FIRMOGRAPHIC_SCALE,
    PILLAR_CAPS,
    SCORE_BANDS,
)

logger = logging.getLogger("app.services.scoring")


def get_score_band(score: int) -> dict:
    """Get the score band info for a given score."""
    for band in SCORE_BANDS:
        if band["min"] <= score <= band["max"]:
            return band
    return SCORE_BANDS[-1]  # Default to COLD



def apply_score_decay(
    pillar_scores: dict[str, float],
    last_signal_date: str | None,
    decay_rate: float = DECAY_RATE,
    decay_period_days: int = DECAY_PERIOD_DAYS,
) -> dict[str, float]:
    """
    Apply time-based decay to intent and engagement pillar scores.

    PRD rule: -15% per 30 days for intent-based points if no new signal.
    Firmographic and tech scores don't decay (they're structural, not temporal).

    Args:
        pillar_scores:    Raw pillar scores before decay
        last_signal_date: ISO date of the most recent intent signal
        decay_rate:       Fraction to decay per period (default 15%)
        decay_period_days: Days per decay period (default 30)

    Returns:
        Pillar scores with decay applied
    """
    if not last_signal_date:
        return pillar_scores

    try:
        last_signal = datetime.fromisoformat(last_signal_date.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return pillar_scores
    if last_signal.tzinfo is None:  # a date-only / naive ISO string is UTC; subtracting from an aware "now" would raise
        last_signal = last_signal.replace(tzinfo=timezone.utc)

    now = datetime.now(timezone.utc)
    days_since = (now - last_signal).days

    if days_since <= 0:
        return pillar_scores

    # Number of complete decay periods elapsed
    periods = days_since / decay_period_days

    # Decay multiplier: (1 - rate) ^ periods
    decay_multiplier = max(0.0, (1 - decay_rate) ** periods)

    decayed = dict(pillar_scores)
    # Only decay intent and engagement pillars
    for pillar in ("intent", "engagement"):
        if pillar in decayed:
            decayed[pillar] = round(decayed[pillar] * decay_multiplier, 1)

    return decayed



def compute_intent_score(
    signals: list[dict],
    existing_match_score: int | str | None = None,
    last_signal_date: str | None = None,
) -> dict:
    """
    Compute a composite intent score from collected signals.

    Args:
        signals:             List of signal dicts from the signal collectors
        existing_match_score: The ICP match score (0-100) from lead extraction
        last_signal_date:    ISO date of the most recent signal for decay

    Returns:
        {
            "intent_score":   int (0-100),
            "intent_band":    str ("HOT" | "WARM" | "NURTURE" | "WATCH" | "COLD"),
            "band_emoji":     str,
            "band_action":    str,
            "score_breakdown": {
                "firmographic": float,
                "tech": float,
                "intent": float,
                "engagement": float,
            },
            "pillar_details": {
                "firmographic": [...],
                "tech": [...],
                "intent": [...],
                "engagement": [...],
            },
            "total_signals":  int,
            "decay_applied":  bool,
        }
    """
    # ── Pillar 1: Firmographic Fit ────────────────────────────────────────────
    # Derived from existing match_score (already computed during lead extraction)
    firmographic_score = 0.0
    if existing_match_score is not None:
        try:
            raw = int(str(existing_match_score).split("/")[0].strip())
            # Scale 0-100 match score to 0-25 firmographic pillar
            firmographic_score = min(PILLAR_CAPS["firmographic"], raw * FIRMOGRAPHIC_SCALE)
        except (ValueError, TypeError):
            pass

    # ── Group signals by category ─────────────────────────────────────────────
    category_signals: dict[str, list[dict]] = {
        "firmographic": [],
        "tech": [],
        "intent": [],
        "engagement": [],
    }

    for signal in signals:
        cat = signal.get("category", "intent")
        if cat not in category_signals:
            cat = "intent"  # Default unmapped categories to intent
        category_signals[cat].append(signal)

    # ── Calculate raw pillar scores ───────────────────────────────────────────
    raw_pillar_scores = {
        "firmographic": firmographic_score,
    }

    for pillar in ("tech", "intent", "engagement"):

        weighted = 0.0
        for s in category_signals[pillar]:
            w = s.get("weight", 0)
            conf = s.get("confidence", "medium")
            weighted += w * CONFIDENCE_MULTIPLIERS.get(conf, CONFIDENCE_MULTIPLIERS["low"])
        raw_pillar_scores[pillar] = min(PILLAR_CAPS[pillar], weighted)

    # ── Apply decay ───────────────────────────────────────────────────────────
    decay_applied = False
    if last_signal_date:
        decayed = apply_score_decay(raw_pillar_scores, last_signal_date)
        if decayed != raw_pillar_scores:
            decay_applied = True
        raw_pillar_scores = decayed

    # ── Compute total ─────────────────────────────────────────────────────────
    total_score = int(round(sum(raw_pillar_scores.values())))
    total_score = max(0, min(100, total_score))

    band_info = get_score_band(total_score)

    # ── Build pillar details for breakdown UI ─────────────────────────────────
    pillar_details = {}
    for pillar, sigs in category_signals.items():
        pillar_details[pillar] = [
            {
                "title": s.get("title", ""),
                "weight": s.get("weight", 0),
                "confidence": s.get("confidence", "medium"),
                "source": s.get("source", ""),
            }
            for s in sigs
        ]

    return {
        "intent_score": total_score,
        "intent_band": band_info["band"],
        "band_emoji": band_info["emoji"],
        "band_action": band_info["action"],
        "score_breakdown": {k: round(v, 1) for k, v in raw_pillar_scores.items()},
        "pillar_details": pillar_details,
        "total_signals": len(signals),
        "decay_applied": decay_applied,
    }
