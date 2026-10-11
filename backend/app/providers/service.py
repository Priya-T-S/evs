"""Refresh orchestration for external data, with labelled demo fallbacks."""

import logging
import math

import h3
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.intelligence import grid as gridlib
from app.models import ExternalData
from app.providers import open_meteo, overpass
from app.providers.base import registry

log = logging.getLogger("ecopulse.external")

DEMO_SOURCE = "EcoPulse demo generator"


async def _location_points(db: AsyncSession) -> list[tuple[int, float, float]]:
    rows = await db.execute(text("SELECT id, ST_X(centroid), ST_Y(centroid) FROM locations ORDER BY id"))
    return [(i, x, y) for i, x, y in rows]


def _demo_aqi(i: int, now: datetime) -> dict:
    # Smooth, deterministic pattern: spatial variation + diurnal peak around 9:00 and 21:00 local.
    hour = (now.hour + 5.5) % 24
    diurnal = 18 * math.cos((hour - 9) / 24 * 2 * math.pi) + 10 * math.cos((hour - 21) / 12 * math.pi)
    aqi = max(25, 85 + 35 * math.sin(i * 1.7) + diurnal)
    return {"us_aqi": round(aqi), "pm2_5": round(aqi * 0.33, 1), "pm10": round(aqi * 0.6, 1), "no2": None, "o3": None, "observed_at": now}


def _demo_weather(i: int, now: datetime) -> dict:
    day = now.timetuple().tm_yday
    monsoon = max(0.0, math.sin((day - 150) / 365 * 2 * math.pi))  # wetter Jun–Oct
    rain_next = round(monsoon * (18 + 10 * math.sin(i)), 1)
    return {
        "temperature_c": round(26 + 4 * math.sin(i), 1),
        "humidity_pct": 70,
        "precip_now_mm": 0,
        "wind_kmh": 9,
        "weather_code": 3,
        "precip_past_24h_mm": round(rain_next * 0.6, 1),
        "precip_next_48h_mm": rain_next,
        "precip_max_probability_48h": round(60 * monsoon),
        "observed_at": now,
    }


async def refresh_conditions(db: AsyncSession) -> dict:
    """AQI + weather for every location centroid (one batched request per provider)."""
    locs = await _location_points(db)
    if not locs:
        return {}
    points = [(x, y) for _, x, y in locs]
    now = datetime.now(UTC)
    aqi = await open_meteo.fetch_aqi(points) if settings.external_data_enabled else None
    weather = await open_meteo.fetch_weather(points) if settings.external_data_enabled else None
    if not settings.external_data_enabled:
        open_meteo.AQI.using_demo = open_meteo.WEATHER.using_demo = True
        open_meteo.AQI.notes = open_meteo.WEATHER.notes = "External data disabled by configuration."

    for idx, (loc_id, x, y) in enumerate(locs):
        a = aqi[idx] if aqi and idx < len(aqi) and aqi[idx].get("us_aqi") is not None else None
        a_demo = a is None
        a = a or _demo_aqi(loc_id, now)
        w = weather[idx] if weather and idx < len(weather) else None
        w_demo = w is None
        w = w or _demo_weather(loc_id, now)
        for kind, val, demo, src in (
            ("aqi", a, a_demo, open_meteo.AQI.source),
            ("weather", w, w_demo, open_meteo.WEATHER.source),
        ):
            observed = val.pop("observed_at")
            db.add(
                ExternalData(
                    provider="open-meteo" if not demo else "demo",
                    kind=kind,
                    source_name=src if not demo else DEMO_SOURCE,
                    is_demo=demo,
                    geom=f"SRID=4326;POINT({x} {y})",
                    location_id=loc_id,
                    observed_at=observed,
                    value=val,
                )
            )
    await db.execute(text("DELETE FROM external_data WHERE fetched_at < now() - interval '7 days' AND kind IN ('aqi','weather')"))
    await db.commit()
    return {"locations": len(locs), "aqi_live": aqi is not None, "weather_live": weather is not None}


async def load_geodata(db: AsyncSession, bbox: tuple[float, float, float, float]) -> dict:
    """Green zones, sensitive sites and waste points from OSM; demo set if unavailable."""
    from app.seed import demo_geo

    stats = {"green": 0, "sites": 0, "waste_points": 0, "source": "osm"}
    green = await overpass.fetch_green(bbox) if settings.external_data_enabled else None
    pois = await overpass.fetch_pois(bbox) if settings.external_data_enabled else None

    if green is None or len(green) < 5:
        green = demo_geo.green_zones()
        source_g, demo_g = "demo", True
        stats["source"] = "demo"
    else:
        source_g, demo_g = "osm", False
    for g in green:
        await db.execute(
            text(
                """INSERT INTO green_zones (name, kind, geom, area_m2, source, source_ref, is_demo)
                   VALUES (:name, :kind, ST_Multi(ST_GeomFromText(:wkt, 4326)), ST_Area(ST_GeomFromText(:wkt, 4326)::geography), :src, :ref, :demo)
                   ON CONFLICT (source_ref) DO NOTHING"""
            ),
            {**g, "src": source_g, "demo": demo_g},
        )
    stats["green"] = len(green)

    if pois is None or len(pois[0]) < 5:
        sites, waste = demo_geo.sensitive_sites(), demo_geo.waste_points()
        source_p, demo_p = "demo", True
        stats["source"] = "demo" if stats["source"] == "demo" else "mixed"
    else:
        sites, waste = pois
        source_p, demo_p = "osm", False
    for s in sites:
        await db.execute(
            text(
                """INSERT INTO sensitive_sites (kind, name, geom, source, source_ref, is_demo)
                   VALUES (:kind, :name, ST_SetSRID(ST_MakePoint(:lon,:lat),4326), :src, :ref, :demo) ON CONFLICT (source_ref) DO NOTHING"""
            ),
            {**s, "src": source_p, "demo": demo_p},
        )
    for w in waste:
        await db.execute(
            text(
                """INSERT INTO waste_points (kind, name, geom, source, source_ref, is_demo)
                   VALUES (:kind, :name, ST_SetSRID(ST_MakePoint(:lon,:lat),4326), :src, :ref, :demo) ON CONFLICT (source_ref) DO NOTHING"""
            ),
            {**w, "src": source_p, "demo": demo_p},
        )
    stats["sites"], stats["waste_points"] = len(sites), len(waste)
    await db.commit()
    return stats


async def upgrade_demo_geodata(db: AsyncSession, bbox: tuple[float, float, float, float]) -> dict | None:
    """If demo geodata is in use (OSM was unreachable at seed time), retry OSM and swap it in."""
    using_demo = await db.scalar(text("SELECT coalesce(bool_and(is_demo), false) FROM green_zones"))
    if not using_demo or not settings.external_data_enabled:
        return None
    green = await overpass.fetch_green(bbox)
    if green is None or len(green) < 5:
        return {"upgraded": False}
    await db.execute(text("DELETE FROM green_zones WHERE is_demo"))
    await db.execute(text("DELETE FROM sensitive_sites WHERE is_demo"))
    await db.execute(text("DELETE FROM waste_points WHERE is_demo"))
    await db.commit()
    stats = await load_geodata(db, bbox)
    await gridlib.refresh_green(db)
    await db.commit()
    return {"upgraded": True, **stats}


async def load_elevation(db: AsyncSession) -> dict:
    rows = (await db.execute(text("SELECT h3, ST_X(centroid), ST_Y(centroid) FROM grid_cells WHERE elevation_m IS NULL"))).all()
    if not rows:
        return {"cells": 0}
    # Sample at H3 r7 parents (~5 km²): ~7x fewer requests, ample for a relative low-lying index.
    parents = sorted({h3.cell_to_parent(h, 7) for h, _, _ in rows})
    parent_pts = [h3.cell_to_latlng(p)[::-1] for p in parents]
    elev_p = await open_meteo.fetch_elevation(parent_pts) if settings.external_data_enabled else None
    demo = elev_p is None
    if demo:
        # Synthetic terrain: gentle ridge through the centre, valleys towards lakes (labelled demo).
        elev = [900 + 25 * math.sin(y * 40) * math.cos(x * 35) - 15 * math.exp(-((x - 77.66) ** 2 + (y - 12.93) ** 2) * 900) for _, x, y in rows]
    else:
        by_parent = dict(zip(parents, elev_p))
        elev = [by_parent[h3.cell_to_parent(h, 7)] for h, _, _ in rows]
    await gridlib.set_elevations(db, {h: float(e) for (h, _, _), e in zip(rows, elev)})
    db.add(
        ExternalData(
            provider="open-meteo" if not demo else "demo",
            kind="elevation",
            source_name=open_meteo.ELEVATION.source if not demo else DEMO_SOURCE,
            is_demo=demo,
            observed_at=datetime.now(UTC),
            value={"cells": len(rows)},
        )
    )
    await db.commit()
    return {"cells": len(rows), "demo": demo}


async def status(db: AsyncSession) -> list[dict]:
    latest = {}
    for kind in ("aqi", "weather", "elevation"):
        row = (
            await db.execute(select(ExternalData).where(ExternalData.kind == kind).order_by(ExternalData.fetched_at.desc()).limit(1))
        ).scalar_one_or_none()
        latest[kind] = row
    geo_demo = await db.scalar(text("SELECT bool_and(is_demo) FROM green_zones"))
    out = []
    for p in registry.providers.values():
        row = latest.get(p.kind)
        using_demo = row.is_demo if row is not None else p.using_demo
        if p.kind == "geospatial" and geo_demo is not None:
            using_demo = bool(geo_demo)
        out.append(
            {
                "name": p.name,
                "kind": p.kind,
                "source": p.source,
                "requires_key": p.requires_key,
                "configured": p.configured,
                "status": "not_configured" if not p.configured else ("demo" if using_demo else "live"),
                "last_success": p.last_success or (row.fetched_at if row is not None and not row.is_demo else None),
                "last_error": p.last_error,
                "last_data_at": row.fetched_at if row is not None else None,
                "notes": p.notes,
            }
        )
    return out


async def latest_for_location(db: AsyncSession, location_id: int) -> dict:
    out = {}
    for kind in ("aqi", "weather"):
        row = (
            await db.execute(
                select(ExternalData)
                .where(ExternalData.kind == kind, ExternalData.location_id == location_id)
                .order_by(ExternalData.observed_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        out[kind] = (
            {"value": row.value, "source": row.source_name, "is_demo": row.is_demo, "observed_at": row.observed_at}
            if row
            else None
        )
    return out

