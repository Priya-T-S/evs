"""Optional Redis connection. EcoPulse degrades to in-process equivalents without it."""

import logging

import redis.asyncio as aioredis

from app.core.config import settings

log = logging.getLogger("ecopulse.redis")

_client: aioredis.Redis | None = None
_checked = False


async def get_redis() -> aioredis.Redis | None:
    global _client, _checked
    if _checked:
        return _client
    _checked = True
    if not settings.redis_url:
        return None
    try:
        client = aioredis.from_url(settings.redis_url, decode_responses=True, socket_connect_timeout=2)
        await client.ping()
        _client = client
        log.info("redis connected: %s", settings.redis_url)
    except Exception as exc:  # pragma: no cover - environment dependent
        log.warning("redis unavailable (%s); using in-process fallbacks", exc)
        _client = None
    return _client
