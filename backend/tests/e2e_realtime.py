"""End-to-end realtime check against a running API (default http://localhost:8000).

    python tests/e2e_realtime.py

User A (citizen) submits a photo report; user B (anonymous viewer subscribed to the
viewport) must receive incident.created/updated over the WebSocket without polling.
Also verifies EXIF stripping, idempotent offline retries and public-location snapping.
"""

import asyncio
import io
import json
import os
import sys
import time
import uuid

import httpx
import websockets
from PIL import Image

BASE = os.environ.get("ECOPULSE_API", "http://localhost:8000")
WS = BASE.replace("http", "ws") + "/ws"


def photo_with_gps() -> bytes:
    img = Image.new("RGB", (800, 600), (120, 100, 60))
    for x in range(0, 800, 7):
        for y in range(0, 600, 11):
            img.putpixel((x, y), ((x * 3) % 255, (y * 5) % 255, (x + y) % 255))
    exif = Image.Exif()
    exif[0x8825] = {2: (12, 56, 0), 4: (77, 37, 0)}  # GPS IFD — must be stripped
    exif[0x010F] = "SecretCam"
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


async def main() -> int:
    failures = []
    async with httpx.AsyncClient(base_url=BASE, timeout=30) as http:
        citizen = (await http.post("/auth/guest")).json()
        token = citizen["access_token"]
        lat, lon = 12.9395, 77.6190  # Koramangala waste storyline

        received: list[dict] = []
        async with websockets.connect(WS) as ws:
            await ws.recv()  # ready
            await ws.send(json.dumps({"type": "subscribe", "topics": ["incidents", "hotspots", "scores"], "bbox": [77.60, 12.92, 77.64, 12.96]}))
            await ws.recv()  # subscribed

            client_id = uuid.uuid4().hex
            t0 = time.perf_counter()
            r = await http.post(
                "/reports",
                headers={"Authorization": f"Bearer {token}"},
                data={"category": "garbage", "lat": lat, "lon": lon, "accuracy_m": 12, "description": "Overflowing garbage bin, huge pile", "client_id": client_id},
                files={"photo": ("p.jpg", photo_with_gps(), "image/jpeg")},
            )
            assert r.status_code == 202, r.text
            report = r.json()
            print(f"report accepted in {1000 * (time.perf_counter() - t0):.0f} ms → {report['id'][:8]}")

            # Offline retry with the same client_id must not create a duplicate
            r2 = await http.post(
                "/reports",
                headers={"Authorization": f"Bearer {token}"},
                data={"category": "garbage", "lat": lat, "lon": lon, "client_id": client_id},
                files={"photo": ("p.jpg", photo_with_gps(), "image/jpeg")},
            )
            if r2.status_code != 200 or r2.json()["id"] != report["id"]:
                failures.append(f"idempotent retry failed: {r2.status_code}")

            # EXIF must be stripped from stored media
            media_url = report["media"][0]["url"]
            stored = (await http.get(media_url.replace("http://localhost:8000", ""))).content
            if Image.open(io.BytesIO(stored)).getexif():
                failures.append("EXIF metadata was not stripped")

            deadline = time.perf_counter() + 15
            while time.perf_counter() < deadline:
                try:
                    msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.perf_counter()))
                except TimeoutError:
                    break
                received.append(msg)
                if msg["type"] in ("incident.created", "incident.updated") and any(
                    m["type"].startswith("environmental_score") or m["type"].startswith("hotspot") for m in received
                ):
                    break
            dt = time.perf_counter() - t0

        types = [m["type"] for m in received]
        print(f"events received by viewer within {dt:.1f}s: {types}")
        inc_events = [m for m in received if m["type"] in ("incident.created", "incident.updated")]
        if not inc_events:
            failures.append("viewer did not receive an incident event")
        else:
            data = inc_events[0]["data"]
            print(f"  → {data['ref']} '{data['title']}' reporters={data['reporter_count']} priority={data['priority']} risk={data['risk_score']}")
            if abs(data["lat"] - lat) < 1e-6 and abs(data["lon"] - lon) < 1e-6:
                failures.append("public event leaked the exact coordinate")

        processed = (await http.get(f"/reports/{report['id']}", headers={"Authorization": f"Bearer {token}"})).json()
        print(f"  AI: {processed['ai']['label']} ({processed['ai']['confidence']}) via {processed['ai']['provider']}")
        print(f"  duplicate score {processed['duplicate']['score']} → {'merged into existing incident' if processed['status'] == 'merged' else 'new incident'}")

    if failures:
        print("FAIL:", *failures, sep="\n  ")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
