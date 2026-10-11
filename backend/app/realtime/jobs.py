"""Background job queue: Redis list when available, in-process asyncio queue otherwise.

Jobs are small JSON documents ``{"name": str, "args": dict}``; handlers are registered
by the worker. Report processing is enqueued here so the citizen's POST returns fast.
"""

import asyncio
import json
import logging

from app.core.redis import get_redis

log = logging.getLogger("ecopulse.jobs")

QUEUE_KEY = "ecopulse:jobs"
_local: asyncio.Queue | None = None


def _local_queue() -> asyncio.Queue:
    global _local
    if _local is None:
        _local = asyncio.Queue()
    return _local


async def enqueue(name: str, **args) -> None:
    job = {"name": name, "args": args}
    r = await get_redis()
    if r is not None:
        await r.lpush(QUEUE_KEY, json.dumps(job, default=str))
    else:
        await _local_queue().put(job)


async def next_job(timeout: int = 5) -> dict | None:
    r = await get_redis()
    if r is not None:
        item = await r.brpop(QUEUE_KEY, timeout=timeout)
        return json.loads(item[1]) if item else None
    try:
        return await asyncio.wait_for(_local_queue().get(), timeout=timeout)
    except TimeoutError:
        return None
