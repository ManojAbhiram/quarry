import os
from dotenv import load_dotenv

# override=False so real environment variables take precedence over the .env file.
load_dotenv(override=False)


def _require(key: str) -> str:
    """Read an env var and raise a clear error if it is missing or empty."""
    val = os.getenv(key)
    if not val:
        raise EnvironmentError(
            f"Required environment variable '{key}' is not set. "
            "Copy .env.example to .env and fill in the value."
        )
    return val


class Settings:
    PROJECT_NAME: str = "Quarry API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api"

    # Database (SQLite by default; any SQLAlchemy async URL works)
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./quarry.db")
    MONGODB_URL: str = os.getenv(
        "MONGODB_URL",
        "mongodb://quarry:quarry_secret@localhost:27017/quarry?authSource=admin",
    )
    DATABASE_NAME: str = os.getenv("DATABASE_NAME", "quarry")

    # Auth — SECRET_KEY must be explicitly set (no insecure fallback)
    SECRET_KEY: str = _require("SECRET_KEY")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))

    # CORS — comma-separated list of allowed frontend origins (env-overridable)
    ALLOWED_ORIGINS: list[str] = [
        o.strip()
        for o in os.getenv(
            "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173"
        ).split(",")
        if o.strip()
    ]

    # Google OAuth
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_REDIRECT_URI: str = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/auth/google/callback")

    # SMTP
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USERNAME: str = os.getenv("SMTP_USERNAME", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM: str = os.getenv("SMTP_FROM", "")

    # Frontend URL & password reset
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    PASSWORD_RESET_EXPIRE_MINUTES: int = int(os.getenv("PASSWORD_RESET_EXPIRE_MINUTES", "15"))

    # LLM Settings
    LITELLM_MODEL: str = os.getenv("LITELLM_MODEL", "openrouter/meta-llama/llama-3.3-70b-instruct")
    LITELLM_MODEL_MINI: str = os.getenv("LITELLM_MODEL_MINI", "openrouter/meta-llama/llama-3.1-8b-instruct")
    LITELLM_FALLBACK_MODELS: list[str] = [
        m.strip() for m in os.getenv("LITELLM_FALLBACK_MODELS", "groq/llama-3.3-70b-versatile").split(",") if m.strip()
    ]

    # Serper
    SERPER_API_KEY: str = _require("SERPER_API_KEY")
    SERPER_URL: str = "https://google.serper.dev/search"

    # LLM call tuning (defaults match prior in-code literals)
    LLM_CONCURRENCY: int = int(os.getenv("LLM_CONCURRENCY", "12"))
    LLM_MAX_TOKENS: int = int(os.getenv("LLM_MAX_TOKENS", "800"))
    LLM_TIMEOUT: int = int(os.getenv("LLM_TIMEOUT", "30"))

    # Lead scoring thresholds (defaults match prior in-code literals)
    ICP_SCORE_THRESHOLD: int = int(os.getenv("ICP_SCORE_THRESHOLD", "60"))
    INTENT_SCORE_DECAY_RATE: float = float(os.getenv("INTENT_SCORE_DECAY_RATE", "0.15"))
    INTENT_SCORE_DECAY_PERIOD_DAYS: int = int(
        os.getenv("INTENT_SCORE_DECAY_PERIOD_DAYS", "30")
    )

    # Scraping
    SCRAPE_TIMEOUT: int = int(os.getenv("SCRAPE_TIMEOUT", "15"))
    MAX_SCRAPE_TEXT_CHARS: int = 12000
    MAX_LEADS_TO_PROCESS: int = int(os.getenv("MAX_LEADS_TO_PROCESS", "40"))

    # Company enrichment (LinkedIn firmographics + market/funding signals)
    # LinkedIn firmographics cost ~1 Serper query per lead; signals cost ~4 per lead.
    ENABLE_LINKEDIN_ENRICHMENT: bool = os.getenv("ENABLE_LINKEDIN_ENRICHMENT", "true").lower() in ("1", "true", "yes")
    ENABLE_SIGNAL_ENRICHMENT: bool = os.getenv("ENABLE_SIGNAL_ENRICHMENT", "true").lower() in ("1", "true", "yes")
    LINKEDIN_ENRICH_MAX_LEADS: int = int(os.getenv("LINKEDIN_ENRICH_MAX_LEADS", "50"))
    SIGNAL_ENRICH_MAX_LEADS: int = int(os.getenv("SIGNAL_ENRICH_MAX_LEADS", "25"))
    ENRICH_CONCURRENCY: int = int(os.getenv("ENRICH_CONCURRENCY", "6"))

    # Careers tech stack enrichment
    CAREERS_MAX_ROLES: int = int(os.getenv("CAREERS_MAX_ROLES", "15"))
    CAREERS_ENRICH_TIMEOUT: int = int(os.getenv("CAREERS_ENRICH_TIMEOUT", "30"))
    CAREERS_JOB_TTL_DAYS: int = int(os.getenv("CAREERS_JOB_TTL_DAYS", "14"))
    CAREERS_RECENCY_DAYS: int = int(os.getenv("CAREERS_RECENCY_DAYS", "90"))
    TECH_FUSION_THRESHOLD: float = float(os.getenv("TECH_FUSION_THRESHOLD", "0.50"))
    CAREERS_MIN_DICT_TECHS: int = int(os.getenv("CAREERS_MIN_DICT_TECHS", "3"))
    CAREERS_PIPELINE_EXPORT: bool = os.getenv("CAREERS_PIPELINE_EXPORT", "true").lower() in ("1", "true", "yes")
    CAREERS_PIPELINE_EXPORT_DIR: str = os.getenv(
        "CAREERS_PIPELINE_EXPORT_DIR",
        os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
            "exports",
            "careers_pipeline",
        ),
    )


settings = Settings()
