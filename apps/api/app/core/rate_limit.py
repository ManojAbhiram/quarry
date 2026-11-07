"""A small in-memory sliding-window rate limiter for the auth endpoints.

Good enough for a single API process (the current deployment). If Quarry ever runs several workers or hosts, replace
the storage with Redis (or put a rate limit in the reverse proxy); the dependency below stays the same.
"""
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.core.config import settings


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_seconds: int) -> int:
        """Record a hit. Returns 0 if allowed, otherwise the seconds to wait before retrying."""
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] >= window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            return max(1, int(window_seconds - (now - hits[0])) + 1)
        hits.append(now)
        if len(self._hits) > 10_000:  # keep memory bounded under a spray of distinct clients
            for k in [k for k, v in self._hits.items() if not v]:
                del self._hits[k]
        return 0

    def reset(self) -> None:
        self._hits.clear()


limiter = SlidingWindowLimiter()


async def auth_rate_limit(request: Request) -> None:
    """FastAPI dependency: limit attempts per client address and endpoint."""
    client = request.client.host if request.client else "unknown"
    retry_after = limiter.check(
        f"{client}:{request.url.path}",
        settings.AUTH_RATE_LIMIT_ATTEMPTS,
        settings.AUTH_RATE_LIMIT_WINDOW_SECONDS,
    )
    if retry_after:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many attempts. Please wait a moment and try again.",
            headers={"Retry-After": str(retry_after)},
        )
