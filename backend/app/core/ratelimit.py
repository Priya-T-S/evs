"""Fixed-window rate limiting backed by Redis, with an in-memory fallback."""

import time
from collections import defaultdict

from app.core.config import settings
from app.core.errors import RateLimited
from app.core.redis import get_redis

_memory: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))


async def enforce(key: str, limit: int, window_seconds: int) -> None:
    if settings.env == "development":
        limit *= 20  # local dev, tests and demos share one loopback IP
    bucket = int(time.time() // window_seconds)
    redis_key = f"rl:{key}:{bucket}"
    r = await get_redis()
    if r is not None:
        count = await r.incr(redis_key)
        if count == 1:
            await r.expire(redis_key, window_seconds)
    else:
        count, expires = _memory[redis_key]
        now = time.time()
        if now > expires:
            count, expires = 0, now + window_seconds
        count += 1
        _memory[redis_key] = (count, expires)
    if count > limit:
        raise RateLimited(
            "Too many requests. Please slow down and try again shortly.",
            details={"limit": limit, "window_seconds": window_seconds},
        )
