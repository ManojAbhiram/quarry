"""
Lead-intent scoring configuration.

Centralizes the tunable weights/thresholds used by the 4-pillar intent scoring
engine (``app/services/scoring.py``) so they can be reviewed and adjusted in one
place instead of being scattered as in-code literals.

Decay rate/period and the ICP gate are env-overridable through ``settings``;
the structural tables (score bands, pillar caps, confidence multipliers) live
here as the single source of truth. All defaults match the previous in-code
values, so behaviour is unchanged unless these are edited.
"""

from app.core.config import settings

# Score bands: maps a 0-100 composite score to a band label, emoji and action.
SCORE_BANDS: list[dict] = [
    {"min": 80, "max": 100, "band": "HOT",     "emoji": "🔥", "action": "Immediate outreach"},
    {"min": 60, "max": 79,  "band": "WARM",    "emoji": "🟠", "action": "SDR sequence within 24 hours"},
    {"min": 40, "max": 59,  "band": "NURTURE", "emoji": "🟡", "action": "Add to nurture sequence"},
    {"min": 20, "max": 39,  "band": "WATCH",   "emoji": "⚪", "action": "Monitor only"},
    {"min": 0,  "max": 19,  "band": "COLD",    "emoji": "🔵", "action": "Excluded from active lists"},
]

# Maximum points contributed by each pillar (caps the weighted sum per pillar).
PILLAR_CAPS: dict[str, int] = {
    "firmographic": 25,
    "tech": 20,
    "intent": 35,
    "engagement": 20,
}

# Scaling factor applied to the 0-100 ICP match score to fit the firmographic cap.
FIRMOGRAPHIC_SCALE: float = PILLAR_CAPS["firmographic"] / 100.0  # = 0.25

# Confidence multipliers applied to each signal's weight.
CONFIDENCE_MULTIPLIERS: dict[str, float] = {
    "high": 1.0,
    "medium": 0.75,
    "low": 0.5,
}

# Time-based decay for intent/engagement pillars (env-overridable via settings).
DECAY_RATE: float = settings.INTENT_SCORE_DECAY_RATE
DECAY_PERIOD_DAYS: int = settings.INTENT_SCORE_DECAY_PERIOD_DAYS
