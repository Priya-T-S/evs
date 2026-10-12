import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import jwt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.core.catalog import CATEGORIES, SEVERITY_LABELS, STATUSES
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.errors import install_error_handlers
from app.core.redis import get_redis
from app.core.security import decode_access_token
from app.modules.analytics.router import router as analytics_router
from app.modules.assistant.router import router as assistant_router
from app.modules.auth.router import router as auth_router
from app.modules.drives.router import router as drives_router
from app.modules.external_data.router import router as external_router
from app.modules.hotspots.router import router as hotspots_router
from app.modules.incidents.router import router as incidents_router
from app.modules.maps.router import router as maps_router
from app.modules.notifications.router import router as notifications_router
from app.modules.pulse.router import router as pulse_router
from app.modules.recommendations.router import router as recommendations_router
from app.modules.reports.router import router as reports_router
from app.modules.scores.router import router as scores_router
from app.modules.users.router import router as users_router
from app.realtime import bus
from app.realtime.hub import Client, hub

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("ecopulse")


@asynccontextmanager
async def lifespan(_: FastAPI):
    tasks = []
    if await get_redis() is not None:
        tasks.append(asyncio.create_task(bus.listen_forever()))
    if settings.embedded_worker:
        from app import worker

        tasks.append(asyncio.create_task(worker.run()))
    log.info("EcoPulse API ready (redis=%s, embedded_worker=%s)", bool(await get_redis()), settings.embedded_worker)
    yield
    for t in tasks:
        t.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await t


app = FastAPI(
    title="EcoPulse API",
    version="1.0.0",
    description="Real-time environmental intelligence platform. Software-only: citizen reports, open data, GIS and AI.",
    lifespan=lifespan,
)
install_error_handlers(app)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


for r in (
    auth_router,
    reports_router,
    incidents_router,
    maps_router,
    hotspots_router,
    scores_router,
    pulse_router,
    recommendations_router,
    drives_router,
    analytics_router,
    notifications_router,
    external_router,
    assistant_router,
    users_router,
):
    app.include_router(r)

if settings.storage_backend == "local":
    media = Path(settings.media_dir)
    media.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=media), name="media")


@app.get("/health", tags=["system"])
async def health():
    db_ok = True
    try:
        async with SessionLocal() as db:
            await db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": db_ok, "redis": bool(await get_redis()), "ws_clients": hub.size}


@app.get("/meta", tags=["system"])
async def meta():
    """Static vocabulary for clients: categories, statuses, severities, city."""
    return {
        "city": {"name": settings.city_name, "center": [settings.city_center_lon, settings.city_center_lat]},
        "categories": [
            {"slug": s, "label": label, "domain": d, "default_severity": sev, "requires_photo": s not in ("noise_pollution", "air_pollution", "flooding", "waterlogging", "other")}
            for s, label, d, sev, _w, _p in CATEGORIES
        ],
        "statuses": list(STATUSES) + ["dismissed"],
        "severities": SEVERITY_LABELS,
        "public_location_precision_m": settings.public_location_precision_m,
        "ai": {"classifier": "claude-vision" if settings.anthropic_api_key else "heuristic-v1"},
    }


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    """Realtime channel. Auth via ?token=<access token> (optional for public topics).

    Client → server: {"type":"subscribe","topics":[...],"bbox":[w,s,e,n]} | {"type":"ping"}
    Server → client: {"type": "<event>", "topic", "ts", "geo", "data"} | {"type":"pong"} | {"type":"ready"}
    """
    token = ws.query_params.get("token")
    user_id, role = None, "citizen"
    if token:
        try:
            payload = decode_access_token(token)
            user_id, role = payload["sub"], payload.get("role", "citizen")
        except jwt.PyJWTError:
            await ws.close(code=4401)
            return
    await ws.accept()
    client = Client(ws=ws, user_id=user_id, role=role)
    await hub.register(client)

    async def sender():
        while True:
            event = await client.queue.get()
            await ws.send_json(event)

    send_task = asyncio.create_task(sender())
    try:
        await ws.send_json({"type": "ready", "data": {"authenticated": user_id is not None, "topics": sorted(client.topics)}})
        while True:
            msg = await asyncio.wait_for(ws.receive_json(), timeout=90)
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "subscribe":
                hub.subscribe(client, msg.get("topics"), msg.get("bbox"))
                await ws.send_json({"type": "subscribed", "data": {"topics": sorted(client.topics), "bbox": client.bbox}})
            elif msg.get("type") == "ping":
                await ws.send_json({"type": "pong"})
    except (WebSocketDisconnect, TimeoutError, RuntimeError):
        pass
    except Exception:
        log.exception("websocket error")
    finally:
        hub.unregister(client)
        send_task.cancel()
