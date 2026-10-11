"""Event distribution.

Every API process publishes domain events to the Redis channel ``ecopulse:events``
and runs one listener that forwards events to its local WebSocket hub. With several
API replicas each one receives every event and filters per connected client.
Without Redis, events are delivered straight to the local hub.
"""

import asyncio
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from app.core.redis import get_redis

log = logging.getLogger("ecopulse.bus")

CHANNEL = "ecopulse:events"

EVENT_TOPICS = {
    "incident.created": "incidents",
    "incident.updated": "incidents",
    "incident.resolved": "incidents",
    "report.received": "incidents",
    "hotspot.created": "hotspots",
    "hotspot.updated": "hotspots",
    "hotspot.cooled": "hotspots",
    "environmental_score.updated": "scores",
    "alert.created": "alerts",
    "notification.created": "user",
}


def make_event(
    type_: str,
    data: dict[str, Any],
    *,
    lon: float | None = None,
    lat: float | None = None,
    user_ids: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex,
        "type": type_,
        "topic": EVENT_TOPICS.get(type_, "misc"),
        "ts": datetime.now(UTC).isoformat(),
        "geo": {"lon": lon, "lat": lat} if lon is not None and lat is not None else None,
        "user_ids": user_ids,
        "data": data,
    }


async def publish(event: dict[str, Any]) -> None:
    r = await get_redis()
    if r is not None:
        try:
            await r.publish(CHANNEL, json.dumps(event, default=str))
            return
        except Exception as exc:  # pragma: no cover
            log.warning("redis publish failed, delivering locally: %s", exc)
    from app.realtime.hub import hub

    await hub.dispatch(event)


async def emit(type_: str, data: dict[str, Any], **kw) -> None:
    await publish(make_event(type_, data, **kw))


async def listen_forever() -> None:
    """Forward Redis events to the local hub. Reconnects on failure."""
    from app.realtime.hub import hub

    while True:
        r = await get_redis()
        if r is None:
            return
        try:
            pubsub = r.pubsub()
            await pubsub.subscribe(CHANNEL)
            async for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    await hub.dispatch(json.loads(message["data"]))
                except Exception:
                    log.exception("dispatch failed")
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover
            log.warning("event listener error (%s); reconnecting", exc)
            await asyncio.sleep(2)
