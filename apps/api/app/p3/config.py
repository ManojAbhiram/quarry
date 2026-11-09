"""Phase 3 settings, read from the environment (kept out of core.config so that shared file stays untouched)."""
import os


def _bool(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).lower() in ("1", "true", "yes")


class P3Settings:
    @property
    def public_api_url(self) -> str:
        """Absolute base URL of this API as seen by email recipients (used in unsubscribe links)."""
        return os.getenv("PUBLIC_API_URL", "http://localhost:8000").rstrip("/")

    @property
    def scheduler_enabled(self) -> bool:
        return _bool("P3_SCHEDULER", "true")

    @property
    def scheduler_interval_seconds(self) -> int:
        return int(os.getenv("P3_SCHEDULER_INTERVAL", "60"))

    @property
    def bounce_pause_threshold(self) -> float:
        return float(os.getenv("OUTREACH_BOUNCE_PAUSE_THRESHOLD", "0.02"))

    @property
    def bounce_pause_min_sent(self) -> int:
        return int(os.getenv("OUTREACH_BOUNCE_MIN_SAMPLE", "20"))

    @property
    def free_credits(self) -> int:
        return int(os.getenv("ENRICH_FREE_CREDITS", "100"))

    @property
    def claude_batch_scoring(self) -> bool:
        return _bool("CLAUDE_BATCH_SCORING", "false")

    @property
    def claude_scoring_model(self) -> str:
        return os.getenv("CLAUDE_SCORING_MODEL", "claude-haiku-4-5")

    @property
    def anthropic_api_key(self) -> str:
        return os.getenv("ANTHROPIC_API_KEY", "")

    def platform_key(self, provider: str) -> str:
        return os.getenv(f"{provider.upper()}_API_KEY", "")


p3_settings = P3Settings()
