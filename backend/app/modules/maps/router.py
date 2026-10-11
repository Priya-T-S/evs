"""Map data API. Every endpoint is viewport-bounded (bbox) and zoom-aware; the browser
never receives the whole city.

Zoom intelligence for incidents:
    zoom < 11        server-side H3 aggregation (r6 below z9, r7 for z9–10): one feature per cell
    zoom ≥ 11        individual incidents (public coordinates), top-N by risk; the client
                     clusters them up to z14 and shows single markers beyond
"""

import json
from typing import Literal

import h3 as h3lib
import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.catalog import OPEN_STATUSES
from app.core.db import get_db
from app.core.deps import optional_user
from app.core.errors import AppError
from app.core.geo import bbox_valid
from app.core.security import has_permission
from app.models import User
from app.providers.base import USER_AGENT

router = APIRouter(prefix="/map", tags=["map"])

INCIDENT_LIMIT = 1500
OPEN_SQL = "('" + "','".join(OPEN_STATUSES) + "')"


def _bbox(bbox: str) -> list[float]:
    try:
        parts = [float(x) for x in bbox.split(",")]
    except ValueError:
        raise AppError("bbox must be 'west,south,east,north'.", code="validation_error", status_code=422)
    if not bbox_valid(parts):
        raise AppError("bbox is out of range.", code="validation_error", status_code=422)
    return parts


def _fc(features: list, **meta) -> dict:
    return {"type": "FeatureCollection", "features": features, "meta": meta}


def _simplify_tolerance(zoom: float) -> float:
    return 0.0 if zoom >= 15 else 0.00002 * 2 ** (15 - zoom)


LAYERS = [
    {
        "id": "risk", "label": "Environmental risk", "group": "Overview", "provenance": "model",
        "description": "Combined risk of open incidents per ~0.7 km² hexagon (grid-1: root-sum-square of incident risk).",
        "render": "grid", "endpoint": "/map/grid?layer=risk",
        "legend": {"type": "gradient", "stops": [[0, "#f1e9c6"], [35, "#eab14d"], [60, "#dd6b2f"], [80, "#b3261e"]], "unit": "risk 0–100"},
    },
    {
        "id": "incidents", "label": "Incidents", "group": "Overview", "provenance": "observed",
        "description": "Citizen-reported incidents. Clustered when zoomed out; positions are rounded to ~120 m for privacy.",
        "render": "points", "endpoint": "/map/incidents",
        "legend": {"type": "categorical", "items": [["P1", "#b3261e"], ["P2", "#dd6b2f"], ["P3", "#d9a521"], ["P4", "#6b8f71"]], "shape": "priority"},
    },
    {
        "id": "hotspots", "label": "Hotspots", "group": "Overview", "provenance": "model",
        "description": "Clusters found by hotspot-1 (weighted DBSCAN, 350 m). Dashed outlines are forecasts.",
        "render": "polygons", "endpoint": "/hotspots?format=geojson",
        "legend": {"type": "categorical", "items": [["Observed", "solid"], ["Forecast (next 14 days)", "dashed"]]},
    },
    {
        "id": "waste", "label": "Waste", "group": "Domains", "provenance": "observed",
        "description": "Density of garbage, dumping, plastic and e-waste reports weighted by severity.",
        "render": "heatmap", "endpoint": "/map/heatmap?layer=waste",
        "legend": {"type": "gradient", "stops": [[0, "rgba(196,140,64,0)"], [0.5, "#c48c40"], [1, "#7a4a12"]], "unit": "relative density"},
    },
    {
        "id": "air", "label": "Air", "group": "Domains", "provenance": "observed+external",
        "description": "Air pollution, burning and dust reports, and AQI per neighbourhood from Open-Meteo (CAMS).",
        "render": "heatmap+points", "endpoint": "/map/heatmap?layer=air", "secondary_endpoint": "/map/aqi",
        "legend": {"type": "gradient", "stops": [[0, "#4c9a6a"], [100, "#e3b23c"], [150, "#dd6b2f"], [200, "#9c2a4a"]], "unit": "US AQI"},
    },
    {
        "id": "water", "label": "Water", "group": "Domains", "provenance": "observed",
        "description": "Water pollution and sewage reports.",
        "render": "heatmap", "endpoint": "/map/heatmap?layer=water",
        "legend": {"type": "gradient", "stops": [[0, "rgba(46,111,149,0)"], [0.5, "#2e6f95"], [1, "#123b57"]], "unit": "relative density"},
    },
    {
        "id": "noise", "label": "Noise", "group": "Domains", "provenance": "observed",
        "description": "Noise reports; measured phone readings (dB) weigh more than unmeasured ones.",
        "render": "heatmap", "endpoint": "/map/heatmap?layer=noise",
        "legend": {"type": "gradient", "stops": [[0, "rgba(124,92,168,0)"], [0.5, "#7c5ca8"], [1, "#3f2a63"]], "unit": "relative density"},
    },
    {
        "id": "green", "label": "Green cover", "group": "Domains", "provenance": "external",
        "description": "Parks, woods and grassland from OpenStreetMap, and green share per hexagon.",
        "render": "polygons+grid", "endpoint": "/map/green-zones", "secondary_endpoint": "/map/grid?layer=green",
        "legend": {"type": "gradient", "stops": [[0, "#efe9dc"], [0.15, "#b9d3a3"], [0.4, "#5f9a5b"]], "unit": "green share"},
    },
    {
        "id": "flood", "label": "Flood risk", "group": "Domains", "provenance": "observed+model",
        "description": "Predicted risk (flood-1: rain forecast, elevation, history, drainage) shaded; observed flooding in the last 72 h outlined.",
        "render": "grid", "endpoint": "/map/grid?layer=flood_predicted", "secondary_endpoint": "/map/grid?layer=flood_observed",
        "legend": {"type": "gradient", "stops": [[0, "rgba(46,111,149,0)"], [0.3, "#8fb8d6"], [0.6, "#2e6f95"], [0.85, "#123b57"]], "unit": "predicted risk"},
    },
    {
        "id": "interventions", "label": "Interventions", "group": "Planning", "provenance": "recommendation",
        "description": "Recommended collection points, green corridors, flood preparedness areas and silence zones. These are suggestions, not facts.",
        "render": "mixed", "endpoint": "/map/recommendations",
        "legend": {"type": "categorical", "items": [["Collection point", "star"], ["Green corridor", "line"], ["Flood preparedness", "area"], ["Silence zone", "ring"]]},
    },
    {
        "id": "infrastructure", "label": "Collection points", "group": "Planning", "provenance": "external",
        "description": "Known waste collection / recycling points from OpenStreetMap.",
        "render": "points", "endpoint": "/map/waste-points",
        "legend": {"type": "categorical", "items": [["Existing point", "dot"]]},
    },
    {
        "id": "neighbourhoods", "label": "Neighbourhood scores", "group": "Overview", "provenance": "model",
        "description": "Environmental Pulse (pulse-1) per neighbourhood. Boundaries are synthetic demo boundaries.",
        "render": "polygons", "endpoint": "/map/locations",
        "legend": {"type": "gradient", "stops": [[0, "#b3261e"], [35, "#dd6b2f"], [55, "#d9a521"], [75, "#4c9a6a"]], "unit": "score 0–100"},
    },
]


@router.get("/layers")
async def layers():
    return {"layers": LAYERS}


@router.get("/incidents")
async def map_incidents(
    bbox: str,
    zoom: float = Query(12, ge=0, le=22),
    domain: str | None = None,
    status: Literal["open", "resolved", "all"] = "open",
    days: int | None = Query(None, ge=1, le=365),
    user: User | None = Depends(optional_user),
    db: AsyncSession = Depends(get_db),
):
    w, s, e, n = _bbox(bbox)
    exact = bool(user and has_permission(user.role, "incident.view_exact"))
    geom = "geom" if exact else "public_geom"
    where = [f"ST_Intersects({geom}, ST_MakeEnvelope(:w,:s,:e,:n,4326))"]
    params: dict = {"w": w, "s": s, "e": e, "n": n}
    if status == "open":
        where.append(f"status IN {OPEN_SQL}")
    elif status == "resolved":
        where.append("status IN ('resolved','citizen_verified')")
    if domain:
        where.append("domain = ANY(:domains)")
        params["domains"] = domain.split(",")
    if days:
        where.append("last_reported_at >= now() - make_interval(days => :days)")
        params["days"] = days
    cond = " AND ".join(where)

    if zoom < 11:
        res = 6 if zoom < 9 else 7
        rows = await db.execute(
            text(
                f"""SELECT h3, risk_score, reporter_count, domain, ST_X({geom}) x, ST_Y({geom}) y
                    FROM incidents WHERE {cond}"""
            ),
            params,
        )
        agg: dict[str, dict] = {}
        for r in rows:
            if not r.h3:
                continue
            p = h3lib.cell_to_parent(r.h3, res)
            a = agg.setdefault(p, {"n": 0, "max_risk": 0.0, "reporters": 0, "x": 0.0, "y": 0.0, "domains": {}})
            a["n"] += 1
            a["max_risk"] = max(a["max_risk"], r.risk_score)
            a["reporters"] += r.reporter_count
            a["x"] += r.x
            a["y"] += r.y
            a["domains"][r.domain] = a["domains"].get(r.domain, 0) + 1
        feats = [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(a["x"] / a["n"], 5), round(a["y"] / a["n"], 5)]},
                "properties": {
                    "cell": c,
                    "count": a["n"],
                    "max_risk": round(a["max_risk"], 1),
                    "reporters": a["reporters"],
                    "domain": max(a["domains"], key=a["domains"].get),
                },
            }
            for c, a in agg.items()
        ]
        return _fc(feats, mode="aggregate", resolution=res, total=sum(a["n"] for a in agg.values()))

    rows = (
        await db.execute(
            text(
                f"""
                SELECT id, ref, title, category, domain, severity, priority, risk_score, status, reporter_count,
                       last_reported_at, is_demo, ST_X({geom}) x, ST_Y({geom}) y
                FROM incidents WHERE {cond}
                ORDER BY risk_score DESC LIMIT {INCIDENT_LIMIT + 1}
                """
            ),
            params,
        )
    ).all()
    feats = [
        {
            "type": "Feature",
            "id": str(r.id),
            "geometry": {"type": "Point", "coordinates": [round(r.x, 6), round(r.y, 6)]},
            "properties": {
                "id": str(r.id),
                "ref": r.ref,
                "title": r.title,
                "category": r.category,
                "domain": r.domain,
                "severity": r.severity,
                "priority": r.priority,
                "risk": r.risk_score,
                "status": r.status,
                "reporters": r.reporter_count,
                "last_reported_at": r.last_reported_at.isoformat(),
                "is_demo": r.is_demo,
            },
        }
        for r in rows[:INCIDENT_LIMIT]
    ]
    return _fc(feats, mode="points", truncated=len(rows) > INCIDENT_LIMIT, total=len(feats))


HEAT_DOMAINS = {"waste": ["waste"], "air": ["air"], "water": ["water"], "noise": ["noise"], "flood": ["flood"], "green": ["green"]}


@router.get("/heatmap")
async def heatmap(
    layer: Literal["waste", "air", "water", "noise", "flood", "green", "incidents", "risk"],
    bbox: str,
    zoom: float = Query(12, ge=0, le=22),
    days: int = Query(60, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
):
    """Weighted points for a MapLibre heatmap layer. Aggregated to H3 r8/r9 when zoomed out."""
    w, s, e, n = _bbox(bbox)
    params = {"w": w, "s": s, "e": e, "n": n, "days": days}
    cond = "ST_Intersects(public_geom, ST_MakeEnvelope(:w,:s,:e,:n,4326)) AND last_reported_at >= now() - make_interval(days => :days)"
    if layer in HEAT_DOMAINS:
        cond += " AND domain = ANY(:domains)"
        params["domains"] = HEAT_DOMAINS[layer]
    if layer != "incidents":
        cond += " AND status NOT IN ('resolved','citizen_verified','dismissed')"
    weight_sql = {
        "risk": "risk_score / 25.0",
        "noise": "severity * sqrt(greatest(reporter_count,1)) * CASE WHEN noise_db IS NOT NULL THEN 1 + greatest(noise_db - 60, 0) / 20 ELSE 1 END",
    }.get(layer, "severity * sqrt(greatest(reporter_count,1))")
    rows = (
        await db.execute(
            text(f"SELECT ST_X(public_geom) x, ST_Y(public_geom) y, h3, {weight_sql} wt FROM incidents WHERE {cond}"),
            params,
        )
    ).all()
    if zoom < 13 and len(rows) > 400:
        res = 8 if zoom < 12 else 9
        agg: dict[str, float] = {}
        for r in rows:
            c = h3lib.latlng_to_cell(r.y, r.x, res)
            agg[c] = agg.get(c, 0.0) + float(r.wt)
        pts = [(h3lib.cell_to_latlng(c), wt) for c, wt in agg.items()]
        feats = [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lng, 5), round(lat, 5)]}, "properties": {"w": round(wt, 2)}}
            for (lat, lng), wt in pts
        ]
    else:
        feats = [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(r.x, 5), round(r.y, 5)]}, "properties": {"w": round(float(r.wt), 2)}}
            for r in rows
        ]
    max_w = max((f["properties"]["w"] for f in feats), default=1)
    return _fc(feats, layer=layer, max_weight=max_w, provenance="observed", synthetic_share=await _demo_share(db))


async def _demo_share(db: AsyncSession) -> float:
    v = await db.scalar(text("SELECT avg(CASE WHEN is_demo THEN 1.0 ELSE 0 END) FROM incidents"))
    return round(float(v or 0), 2)


GRID_LAYERS = {
    "risk": ("risk", "risk > 0"),
    "flood_predicted": ("flood_predicted", "flood_predicted >= 0.12"),
    "flood_observed": ("flood_observed", "flood_observed > 0.05"),
    "green": ("green_fraction", "true"),
}


@router.get("/grid")
async def grid(
    layer: Literal["risk", "flood_predicted", "flood_observed", "green"],
    bbox: str,
    db: AsyncSession = Depends(get_db),
):
    w, s, e, n = _bbox(bbox)
    col, filt = GRID_LAYERS[layer]
    rows = await db.execute(
        text(
            f"""SELECT h3, ST_AsGeoJSON(geom, 6) g, {col} v, population, elevation_m, metrics
                FROM grid_cells WHERE {filt} AND ST_Intersects(geom, ST_MakeEnvelope(:w,:s,:e,:n,4326))"""
        ),
        {"w": w, "s": s, "e": e, "n": n},
    )
    feats = []
    for r in rows:
        props = {"h3": r.h3, "value": round(float(r.v), 3), "population": r.population}
        if layer.startswith("flood"):
            fl = (r.metrics or {}).get("flood", {})
            props["components"] = fl.get("components")
            props["rain_mm"] = fl.get("rain_mm")
            props["elevation_m"] = r.elevation_m
            props["kind"] = "observed" if layer == "flood_observed" else "predicted"
        feats.append({"type": "Feature", "geometry": json.loads(r.g), "properties": props})
    provenance = {"risk": "model", "flood_predicted": "model", "flood_observed": "observed", "green": "external"}[layer]
    return _fc(feats, layer=layer, provenance=provenance, model={"risk": "grid-1", "green": None}.get(layer, "flood-1"))


@router.get("/locations")
async def locations(bbox: str | None = None, zoom: float = Query(12, ge=0, le=22), db: AsyncSession = Depends(get_db)):
    params: dict = {"tol": _simplify_tolerance(zoom)}
    cond = "true"
    if bbox:
        w, s, e, n = _bbox(bbox)
        cond = "ST_Intersects(l.geom, ST_MakeEnvelope(:w,:s,:e,:n,4326))"
        params.update(w=w, s=s, e=e, n=n)
    rows = await db.execute(
        text(
            f"""
            SELECT l.id, l.name, l.slug, l.population, l.area_km2, l.is_demo,
                   ST_AsGeoJSON(ST_SimplifyPreserveTopology(l.geom, :tol), 6) g, ST_X(l.centroid) cx, ST_Y(l.centroid) cy,
                   s.overall, s.air, s.water, s.waste, s.noise, s.green, s.clean
            FROM locations l LEFT JOIN environmental_scores s ON s.location_id = l.id AND s.is_current
            WHERE {cond}
            """
        ),
        params,
    )
    feats = [
        {
            "type": "Feature",
            "id": r.id,
            "geometry": json.loads(r.g),
            "properties": {
                "id": r.id, "name": r.name, "slug": r.slug, "population": r.population, "area_km2": round(r.area_km2, 2),
                "boundary_is_demo": r.is_demo, "center": [r.cx, r.cy],
                "overall": r.overall, "air": r.air, "water": r.water, "waste": r.waste, "noise": r.noise, "green": r.green, "clean": r.clean,
            },
        }
        for r in rows
    ]
    return _fc(feats)


@router.get("/green-zones")
async def green_zones(bbox: str, zoom: float = Query(13, ge=0, le=22), db: AsyncSession = Depends(get_db)):
    w, s, e, n = _bbox(bbox)
    min_area = 0 if zoom >= 14 else 2000 if zoom >= 12 else 20000
    rows = await db.execute(
        text(
            """SELECT id, name, kind, area_m2, source, is_demo, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, :tol), 6) g
               FROM green_zones WHERE area_m2 >= :min AND ST_Intersects(geom, ST_MakeEnvelope(:w,:s,:e,:n,4326)) LIMIT 4000"""
        ),
        {"w": w, "s": s, "e": e, "n": n, "min": min_area, "tol": _simplify_tolerance(zoom)},
    )
    feats = [
        {"type": "Feature", "geometry": json.loads(r.g), "properties": {"id": r.id, "name": r.name, "kind": r.kind, "area_m2": round(r.area_m2), "source": r.source, "is_demo": r.is_demo}}
        for r in rows
    ]
    return _fc(feats, provenance="external", attribution="© OpenStreetMap contributors (ODbL)")


async def _points(db: AsyncSession, table: str, bbox: str, limit: int = 3000) -> dict:
    w, s, e, n = _bbox(bbox)
    rows = await db.execute(
        text(
            f"""SELECT id, kind, name, source, is_demo, ST_X(geom) x, ST_Y(geom) y FROM {table}
                WHERE ST_Intersects(geom, ST_MakeEnvelope(:w,:s,:e,:n,4326)) LIMIT {limit}"""
        ),
        {"w": w, "s": s, "e": e, "n": n},
    )
    feats = [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [r.x, r.y]}, "properties": {"id": r.id, "kind": r.kind, "name": r.name, "source": r.source, "is_demo": r.is_demo}}
        for r in rows
    ]
    return _fc(feats, provenance="external")


@router.get("/sensitive-sites")
async def sensitive_sites(bbox: str, db: AsyncSession = Depends(get_db)):
    return await _points(db, "sensitive_sites", bbox)


@router.get("/waste-points")
async def waste_points(bbox: str, db: AsyncSession = Depends(get_db)):
    return await _points(db, "waste_points", bbox)


@router.get("/aqi")
async def aqi(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        text(
            """SELECT DISTINCT ON (e.location_id) e.location_id, l.name, e.value, e.is_demo, e.source_name, e.observed_at,
                      ST_X(l.centroid) x, ST_Y(l.centroid) y
               FROM external_data e JOIN locations l ON l.id = e.location_id
               WHERE e.kind = 'aqi' ORDER BY e.location_id, e.observed_at DESC"""
        )
    )
    feats = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [r.x, r.y]},
            "properties": {"location_id": r.location_id, "name": r.name, "us_aqi": r.value.get("us_aqi"), "pm2_5": r.value.get("pm2_5"),
                           "source": r.source_name, "is_demo": r.is_demo, "observed_at": r.observed_at.isoformat()},
        }
        for r in rows
    ]
    return _fc(feats, provenance="external")


@router.get("/recommendations")
async def map_recommendations(bbox: str, db: AsyncSession = Depends(get_db)):
    w, s, e, n = _bbox(bbox)
    rows = await db.execute(
        text(
            """SELECT id, kind, title, confidence, expected_impact, priority_score, ST_AsGeoJSON(geom, 6) g
               FROM recommendations WHERE status IN ('open','accepted') AND geom IS NOT NULL
               AND kind NOT LIKE '%_playbook' -- playbooks belong to their hotspot, not a separate marker
               AND ST_Intersects(geom, ST_MakeEnvelope(:w,:s,:e,:n,4326))"""
        ),
        {"w": w, "s": s, "e": e, "n": n},
    )
    feats = [
        {"type": "Feature", "geometry": json.loads(r.g), "properties": {"id": str(r.id), "kind": r.kind, "title": r.title, "confidence": r.confidence, "impact": r.expected_impact, "priority": r.priority_score}}
        for r in rows
    ]
    return _fc(feats, provenance="recommendation")


@router.get("/search")
async def search(q: str = Query(..., min_length=2, max_length=80), db: AsyncSession = Depends(get_db)):
    like = f"%{q.strip()}%"
    results = []
    for r in await db.execute(
        text("SELECT id, name, ST_X(centroid) x, ST_Y(centroid) y FROM locations WHERE name ILIKE :q ORDER BY length(name) LIMIT 5"), {"q": like}
    ):
        results.append({"type": "neighbourhood", "id": r.id, "label": r.name, "lon": r.x, "lat": r.y, "zoom": 13.5})
    for r in await db.execute(
        text("SELECT id, ref, title, ST_X(public_geom) x, ST_Y(public_geom) y FROM incidents WHERE ref ILIKE :q OR title ILIKE :q ORDER BY risk_score DESC LIMIT 5"),
        {"q": like},
    ):
        results.append({"type": "incident", "id": str(r.id), "label": f"{r.ref} · {r.title}", "lon": r.x, "lat": r.y, "zoom": 16})
    for r in await db.execute(
        text("SELECT id, name, ST_X(centroid) x, ST_Y(centroid) y FROM hotspots WHERE status='active' AND name ILIKE :q LIMIT 3"), {"q": like}
    ):
        results.append({"type": "hotspot", "id": str(r.id), "label": r.name, "lon": r.x, "lat": r.y, "zoom": 15})
    if len(results) < 3:
        await ratelimit.enforce("nominatim", 1, 1)
        try:
            async with httpx.AsyncClient(timeout=6, headers={"User-Agent": USER_AGENT}) as client:
                resp = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"q": q, "format": "jsonv2", "limit": 5, "viewbox": "77.45,13.13,77.79,12.82", "bounded": 1},
                )
                for p in resp.json():
                    results.append({"type": "place", "id": p.get("place_id"), "label": p.get("display_name", "")[:90], "lon": float(p["lon"]), "lat": float(p["lat"]), "zoom": 16})
        except Exception:
            pass  # geocoding is a convenience; internal results still return
    return {"results": results}
