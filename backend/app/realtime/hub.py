"""WebSocket connection hub with topic + geographic filtering.

Clients send ``{"type": "subscribe", "topics": [...], "bbox": [w, s, e, n]}``.

* Geo-located events (incidents, hotspots, alerts) are delivered only when the event
  falls inside the client's viewport bbox (padded), unless the client subscribed to
  the city-wide ``pulse`` topic.
* ``user`` events (notifications) are delivered only to their target users.
* Staff connections may subscribe to ``org`` to receive every operational event.
"""

import asyncio
import logging
from dataclasses import dataclass, field

from fastapi import WebSocket

log = logging.getLogger("ecopulse.hub")

PUBLIC_TOPICS = {"incidents", "hotspots", "scores", "alerts", "pulse"}
STAFF_TOPICS = PUBLIC_TOPICS | {"org"}


@dataclass(eq=False)
class Client:
    ws: WebSocket
    user_id: str | None
    role: str
    topics: set[str] = field(default_factory=lambda: {"pulse", "alerts", "scores"})
    bbox: tuple[float, float, float, float] | None = None
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=500))

    def wants(self, event: dict) -> bool:
        if event.get("user_ids"):
            return self.user_id is not None and self.user_id in event["user_ids"]
        topic = event.get("topic")
        if "org" in self.topics:
            return True
        if topic == "scores":
            return "scores" in self.topics
        if topic == "alerts" and "alerts" in self.topics:
            return True
        if "pulse" in self.topics and topic in ("incidents", "alerts", "hotspots"):
            return True
        if topic not in self.topics:
            return False
        geo = event.get("geo")
        if geo is None or self.bbox is None:
            return True
        w, s, e, n = self.bbox
        pad_x, pad_y = (e - w) * 0.25, (n - s) * 0.25
        return (w - pad_x) <= geo["lon"] <= (e + pad_x) and (s - pad_y) <= geo["lat"] <= (n + pad_y)


class Hub:
    def __init__(self) -> None:
        self.clients: set[Client] = set()

    async def register(self, client: Client) -> None:
        self.clients.add(client)

    def unregister(self, client: Client) -> None:
        self.clients.discard(client)

    def subscribe(self, client: Client, topics: list[str] | None, bbox: list[float] | None) -> None:
        allowed = STAFF_TOPICS if client.role != "citizen" else PUBLIC_TOPICS
        if topics is not None:
            client.topics = {t for t in topics if t in allowed}
        if bbox is not None and len(bbox) == 4:
            w, s, e, n = (float(v) for v in bbox)
            if -180 <= w < e <= 180 and -90 <= s < n <= 90:
                client.bbox = (w, s, e, n)

    async def dispatch(self, event: dict) -> None:
        for client in list(self.clients):
            if not client.wants(event):
                continue
            try:
                client.queue.put_nowait(event)
            except asyncio.QueueFull:
                # A slow client never blocks the others; it is told to resync instead.
                while not client.queue.empty():
                    client.queue.get_nowait()
                client.queue.put_nowait({"type": "resync", "topic": "system", "data": {}})

    @property
    def size(self) -> int:
        return len(self.clients)


hub = Hub()
