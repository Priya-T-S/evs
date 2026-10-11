"""Background worker.

Runs embedded in the API process (``ECOPULSE_EMBEDDED_WORKER=true``, the default for
development) or standalone::

    python -m app.worker

Responsibilities
* ``process_report`` jobs from the queue (classification → dedupe → incident → events)
* debounced area refresh after incident changes: scores for touched locations, the
  H3 grid, hotspot detection (bursts of reports trigger one recompute, not hundreds)
* periodic: hotspot + recommendation regeneration, external data refresh, risk ageing
"""

import asyncio
import logging
import time

from app.core.config import settings
from app.core.db import SessionLocal
from app.intelligence import grid as gridlib
from app.intelligence import hotspots, recommendations, scores
from app.realtime.jobs import next_job

log = logging.getLogger("ecopulse.worker")


class AreaRefresher:
    """Coalesces refresh requests: waits for a quiet period, then recomputes once."""

    QUIET_SECONDS = 2.0
    MIN_GRID_INTERVAL = 10.0

    def __init__(self) -> None:
        self.pending: set[int] = set()
        self.dirty_at: float | None = None
        self.last_grid = 0.0

    def mark(self, location_id: int | None) -> None:
        if location_id is not None:
            self.pending.add(location_id)
        self.dirty_at = time.monotonic()

    async def tick(self) -> None:
        if self.dirty_at is None or time.monotonic() - self.dirty_at < self.QUIET_SECONDS:
            return
        ids, self.pending, self.dirty_at = list(self.pending), set(), None
        async with SessionLocal() as db:
            if time.monotonic() - self.last_grid > self.MIN_GRID_INTERVAL:
                result = await hotspots.detect(db)
                await gridlib.refresh_grid(db)
                self.last_grid = time.monotonic()
                log.info("area refresh: hotspots %s", result)
            if ids:
                changed = await scores.recompute(db, ids)
                log.info("area refresh: %d/%d location scores changed", changed, len(ids))


refresher = AreaRefresher()


async def handle(job: dict) -> None:
    name, args = job.get("name"), job.get("args", {})
    if name == "process_report":
        from app.modules.reports.pipeline import process_report

        result = await process_report(args["report_id"])
        log.info("report %s → %s", args["report_id"][:8], result)
    elif name == "refresh_area":
        refresher.mark(args.get("location_id"))
    elif name == "refresh_external":
        await refresh_external()
    elif name == "regenerate":
        await regenerate()
    else:
        log.warning("unknown job %s", name)


async def regenerate() -> dict:
    async with SessionLocal() as db:
        h = await hotspots.detect(db)
        g = await gridlib.refresh_grid(db)
        await recompute_open_risk(db)
        s = await scores.recompute(db)
        r = await recommendations.generate(db)
    return {"hotspots": h, "grid": g, "scores_changed": s, "recommendations": r}


async def recompute_open_risk(db) -> int:
    """Risk depends on age and external signals, so open incidents are re-scored periodically."""
    from sqlalchemy import select

    from app.core.catalog import OPEN_STATUSES
    from app.models import Incident
    from app.modules.incidents.service import recompute_risk

    rows = (await db.execute(select(Incident).where(Incident.status.in_(OPEN_STATUSES)))).scalars().all()
    for inc in rows:
        await recompute_risk(db, inc)
    await db.commit()
    return len(rows)


async def refresh_external() -> dict:
    from app.providers import service as external

    from app.seed.demo_geo import CITY_BBOX

    async with SessionLocal() as db:
        before = await _flood_peaks(db)
        result = await external.refresh_conditions(db)
        upgraded = await external.upgrade_demo_geodata(db, CITY_BBOX)
        await gridlib.refresh_grid(db)
        result["flood_alerts"] = await _flood_alerts(db, before)
    if upgraded and upgraded.get("upgraded"):
        result["geodata"] = upgraded
        result["regenerate"] = await regenerate()
    return result


FLOOD_ALERT_LEVEL = 0.45
FLOOD_ALERT_RISE = 0.15


async def _flood_peaks(db) -> dict[int, float]:
    from sqlalchemy import text

    rows = await db.execute(text("SELECT location_id, max(flood_predicted) FROM grid_cells WHERE location_id IS NOT NULL GROUP BY 1"))
    return {loc: float(v or 0) for loc, v in rows}


async def _flood_alerts(db, before: dict[int, float]) -> int:
    """Alert residents when predicted flood risk (flood-1) rises sharply to a high level."""
    from datetime import UTC, datetime

    from sqlalchemy import text

    from app.modules.notifications.service import notify_residents

    after = await _flood_peaks(db)
    sent = 0
    for loc_id, peak in after.items():
        if peak >= FLOOD_ALERT_LEVEL and peak - before.get(loc_id, 0.0) >= FLOOD_ALERT_RISE:
            name = await db.scalar(text("SELECT name FROM locations WHERE id=:i"), {"i": loc_id})
            sent += await notify_residents(
                db, loc_id, "flood_risk", f"Flood risk increased in {name}",
                "Forecast rain and local drainage history raise the predicted flood risk (model forecast, not observed flooding).",
                f"flood:{loc_id}:{datetime.now(UTC):%Y%m%d}", location_id=str(loc_id),
            )
    await db.commit()
    return sent


async def _consumer() -> None:
    while True:
        try:
            job = await next_job(timeout=2)
            if job:
                await handle(job)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("job failed")
            await asyncio.sleep(1)


async def _ticker() -> None:
    last_regen = time.monotonic()
    last_external = time.monotonic()
    while True:
        await asyncio.sleep(1)
        try:
            await refresher.tick()
            now = time.monotonic()
            if now - last_regen > settings.hotspot_interval_seconds:
                last_regen = now
                log.info("periodic regenerate: %s", await regenerate())
            if now - last_external > settings.external_interval_seconds:
                last_external = now
                log.info("periodic external refresh: %s", await refresh_external())
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("periodic task failed")


async def run() -> None:
    log.info("worker started")
    await asyncio.gather(_consumer(), _ticker())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    asyncio.run(run())
