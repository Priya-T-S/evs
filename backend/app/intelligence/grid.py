"""H3 analytic grid (resolution 8).

The grid is the common spatial unit for heatmaps, the city risk surface and the flood
model. ``build_grid`` creates cells covering every location polygon; ``refresh_grid``
recomputes per-cell metrics from incidents and external data.

Cell risk (``grid-1``) is the root-sum-square of the risk scores of open incidents in
the cell — one 80-risk incident gives 80, two 60-risk incidents give 85 — capped at 100.

Flood model (``flood-1``), per cell, all components ∈ [0, 1]:

    observed  = 1 − e^(−w/2)  where w = severity-weighted flooding/waterlogging reports, last 72 h
    predicted = (0.25 + 0.75·rain) · (0.30·low_lying + 0.35·history + 0.20·drainage + 0.15·impervious)

    rain        = (forecast next 48 h + ½ · past 24 h) / 80 mm
    low_lying   = (city median elevation − cell elevation) / 25 m
    history     = 1 − e^(−flood/waterlogging incidents ever recorded in the cell / 3)
    drainage    = 1 − e^(−open drainage incidents / 2)
    impervious  = 1 − green fraction

Observed flooding and predicted flood risk are kept in separate columns and are never mixed.
"""

import json
import logging
import math
import statistics

import h3
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.geo import GRID_RES
from app.models import ExternalData, GridCell

log = logging.getLogger("ecopulse.grid")

GRID_MODEL = "grid-1"
FLOOD_MODEL = "flood-1"


async def build_grid(db: AsyncSession) -> int:
    union = await db.scalar(text("SELECT ST_AsGeoJSON(ST_Union(geom)) FROM locations"))
    if not union:
        return 0
    shape = h3.geo_to_h3shape(json.loads(union))
    cells = h3.h3shape_to_cells(shape, GRID_RES)
    rows = []
    for c in cells:
        boundary = h3.cell_to_boundary(c)
        ring = ", ".join(f"{lng} {lat}" for lat, lng in boundary) + f", {boundary[0][1]} {boundary[0][0]}"
        lat, lng = h3.cell_to_latlng(c)
        rows.append({"h3": c, "poly": f"SRID=4326;POLYGON(({ring}))", "pt": f"SRID=4326;POINT({lng} {lat})"})
    await db.execute(text("DELETE FROM grid_cells"))
    for i in range(0, len(rows), 500):
        await db.execute(
            text(
                "INSERT INTO grid_cells (h3, geom, centroid, population, green_fraction, metrics, risk, flood_observed, flood_predicted, updated_at)"
                " VALUES (:h3, ST_GeomFromEWKT(:poly), ST_GeomFromEWKT(:pt), 0, 0, '{}'::jsonb, 0, 0, 0, now())"
            ),
            rows[i : i + 500],
        )
    # Attach each cell to the location containing its centroid; allocate population by area share.
    await db.execute(
        text(
            """
            UPDATE grid_cells g SET location_id = l.id,
                population = round(l.population * ST_Area(g.geom::geography) / NULLIF(l.area_km2 * 1e6, 0))
            FROM locations l WHERE ST_Contains(l.geom, g.centroid)
            """
        )
    )
    await refresh_green(db)
    await db.commit()
    log.info("grid built: %d cells", len(rows))
    return len(rows)


async def refresh_green(db: AsyncSession) -> None:
    await db.execute(
        text(
            """
            UPDATE grid_cells g SET green_fraction = LEAST(1, COALESCE((
                SELECT ST_Area(ST_Intersection(g.geom, ST_Union(z.geom))::geography)
                FROM green_zones z WHERE ST_Intersects(z.geom, g.geom)
            ), 0) / ST_Area(g.geom::geography))
            """
        )
    )


async def set_elevations(db: AsyncSession, elevations: dict[str, float]) -> None:
    await db.execute(
        text("UPDATE grid_cells SET elevation_m = :e WHERE h3 = :h"), [{"h": k, "e": v} for k, v in elevations.items()]
    )


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


async def refresh_grid(db: AsyncSession) -> dict:
    """Recompute risk + flood metrics for every cell. Returns a short summary."""
    open_sql = "status NOT IN ('resolved','citizen_verified','dismissed')"
    per_cell = await db.execute(
        text(
            f"""
            SELECT h3,
              sqrt(sum(power(risk_score, 2)) FILTER (WHERE {open_sql})) AS risk_rss,
              sum(CASE WHEN category IN ('flooding','waterlogging') AND last_reported_at > now() - interval '72 hours'
                       THEN severity / 2.0 ELSE 0 END) AS flood_recent,
              count(*) FILTER (WHERE category IN ('flooding','waterlogging')) AS flood_hist,
              count(*) FILTER (WHERE category = 'drainage' AND {open_sql}) AS drain_open
            FROM incidents WHERE h3 IS NOT NULL GROUP BY h3
            """
        )
    )
    by_domain: dict[str, dict[str, int]] = {}
    for h, dom, n in await db.execute(
        text(f"SELECT h3, domain, count(*) FROM incidents WHERE h3 IS NOT NULL AND {open_sql} GROUP BY h3, domain")
    ):
        by_domain.setdefault(h, {})[dom] = n
    stats = {r.h3: r for r in per_cell}

    cells = (await db.execute(select(GridCell))).scalars().all()
    elevs = [c.elevation_m for c in cells if c.elevation_m is not None]
    median_elev = statistics.median(elevs) if elevs else None

    weather = {}
    for row in (
        await db.execute(
            select(ExternalData)
            .where(ExternalData.kind == "weather")
            .order_by(ExternalData.location_id, ExternalData.observed_at.desc())
            .distinct(ExternalData.location_id)
        )
    ).scalars():
        weather[row.location_id] = row

    updates = []
    for c in cells:
        s = stats.get(c.h3)
        risk = min(100.0, float(s.risk_rss or 0)) if s else 0.0
        w = weather.get(c.location_id)
        rain_mm = ((w.value.get("precip_next_48h_mm") or 0) + 0.5 * (w.value.get("precip_past_24h_mm") or 0)) if w else 0.0
        comps = {
            "rain": _clamp(rain_mm / 80),
            "low_lying": _clamp((median_elev - c.elevation_m) / 25) if (median_elev is not None and c.elevation_m is not None) else 0.0,
            "history": _clamp(1 - math.exp(-(float(s.flood_hist or 0) if s else 0) / 3)),
            "drainage": _clamp(1 - math.exp(-(float(s.drain_open or 0) if s else 0) / 2)),
            "impervious": _clamp(1 - c.green_fraction),
        }
        susceptibility = 0.30 * comps["low_lying"] + 0.35 * comps["history"] + 0.20 * comps["drainage"] + 0.15 * comps["impervious"]
        predicted = (0.25 + 0.75 * comps["rain"]) * susceptibility
        observed = 1 - math.exp(-(float(s.flood_recent or 0) if s else 0) / 2)
        metrics = {
            "model": GRID_MODEL,
            "by_domain": by_domain.get(c.h3, {}),
            "flood": {
                "model": FLOOD_MODEL,
                "components": {k: round(v, 3) for k, v in comps.items()},
                "rain_mm": round(rain_mm, 1),
                "rain_source": (w.source_name + (" (demo)" if w.is_demo else "")) if w else None,
                "elevation_m": c.elevation_m,
                "median_elevation_m": median_elev,
            },
        }
        updates.append(
            {"h": c.h3, "risk": round(risk, 1), "fo": round(observed, 3), "fp": round(predicted, 3), "m": json.dumps(metrics)}
        )
    if updates:
        await db.execute(
            text(
                "UPDATE grid_cells SET risk=:risk, flood_observed=:fo, flood_predicted=:fp, metrics=CAST(:m AS jsonb), updated_at=now() WHERE h3=:h"
            ),
            updates,
        )
    await db.commit()
    return {
        "cells": len(updates),
        "max_risk": max((u["risk"] for u in updates), default=0),
        "max_flood_predicted": max((u["fp"] for u in updates), default=0),
    }
