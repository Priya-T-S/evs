"""Intervention recommendation engine (``rec-1``).

Every recommendation separates three layers so nobody mistakes a suggestion for a fact:

* ``observed``  — counts and measurements taken directly from EcoPulse data
* ``inference`` — model outputs (risk, trend, forecast) with the model version
* ``actions``   — ranked recommended interventions, each with the rule that triggered it

Generators:

1. Persistent hotspot playbooks (waste, water, air, noise)
2. Waste infrastructure siting — greedy maximal-coverage selection of new collection
   points for open waste incidents farther than 250 m from any known waste point
3. Green corridors — shortest links between nearby green zones scored by how little
   green the link crosses, how many people live along it and air risk
4. Flood preparedness — locations whose predicted flood risk (flood-1) is elevated
5. Silence zones — noise incidents within 300 m of schools / hospitals

Recommendations are upserted by a stable key, so re-running never duplicates them and
accepted/dismissed decisions are preserved.
"""

import logging
import math
import uuid
from collections import Counter
from datetime import UTC, datetime

import h3
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.catalog import category_label
from app.models import Hotspot, Recommendation

log = logging.getLogger("ecopulse.recs")

MODEL = "rec-1"
COVERAGE_M = 250


def _impact(score: float) -> str:
    return "high" if score >= 70 else "medium" if score >= 45 else "low"


def _confidence(evidence: float, scale: float = 20, bonus: float = 0.0) -> float:
    return round(min(0.92, 0.35 + 0.45 * (1 - math.exp(-evidence / scale)) + bonus), 2)


async def _upsert(db: AsyncSession, key: str, **values) -> None:
    rec = (await db.execute(select(Recommendation).where(Recommendation.key == key))).scalar_one_or_none()
    values["updated_at"] = datetime.now(UTC)
    values["model_version"] = MODEL
    if rec is None:
        db.add(Recommendation(id=uuid.uuid4(), key=key, status="open", **values))
    else:
        status = rec.status
        for k, v in values.items():
            setattr(rec, k, v)
        rec.status = "open" if status == "superseded" else status


async def _hotspot_playbooks(db: AsyncSession, keys: set[str]) -> None:
    hotspots = (
        await db.execute(select(Hotspot).where(Hotspot.kind == "observed", Hotspot.status == "active"))
    ).scalars().all()
    for h in hotspots:
        mix = Counter(h.category_mix or {})
        total = sum(mix.values()) or 1
        share = {k: v / total for k, v in mix.items()}
        days = max(1, (datetime.now(UTC) - h.created_at).days)
        cx, cy = (await db.execute(text("SELECT ST_X(centroid), ST_Y(centroid) FROM hotspots WHERE id=:i"), {"i": h.id})).one()
        nearest_bin = await db.scalar(
            text(
                """SELECT min(ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(:x,:y),4326)::geography))
                   FROM waste_points WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(:x,:y),4326)::geography, 2000)"""
            ),
            {"x": cx, "y": cy},
        )
        sensitive = await db.scalar(
            text(
                """SELECT count(*) FROM sensitive_sites WHERE ST_DWithin(geom::geography,
                   ST_SetSRID(ST_MakePoint(:x,:y),4326)::geography, 400)"""
            ),
            {"x": cx, "y": cy},
        )
        persistent = h.report_count >= 10 and h.active_incidents >= 3
        actions: list[dict] = []

        def act(title: str, detail: str, rule: str) -> None:
            actions.append({"rank": len(actions) + 1, "title": title, "detail": detail, "rule": rule})

        if h.domain == "waste":
            if share.get("garbage", 0) + share.get("plastic_waste", 0) >= 0.4:
                act("Increase waste collection frequency", "Add at least one extra collection round per week for the streets inside this hotspot.", "garbage+plastic ≥ 40% of incidents")
            if nearest_bin is None or nearest_bin > 300:
                act("Add a waste collection point", f"Nearest known collection point is {'over 2 km' if nearest_bin is None else f'{round(nearest_bin)} m'} away.", "no collection point within 300 m")
            if share.get("plastic_waste", 0) >= 0.15 or share.get("garbage", 0) >= 0.4:
                act("Add segregation bins", "Separate wet, dry and recyclable streams at the collection point.", "plastic ≥ 15% or garbage ≥ 40%")
            if share.get("illegal_dumping", 0) >= 0.2:
                act("Schedule enforcement inspections", "Inspect at the times dumping is reported most often.", "illegal dumping ≥ 20%")
            if share.get("e_waste", 0) > 0:
                act("Organise an e-waste collection drive", "Hazardous electronics were reported in this cluster.", "any e-waste incident")
            act("Post awareness signage", "Signage with collection timings and the penalty for dumping.", "default for waste hotspots")
            title = f"{'Persistent' if persistent else 'Emerging'} waste hotspot: {h.name.split(' · ')[0]}"
            kind = "waste_hotspot_playbook"
        elif h.domain == "water":
            act("Inspect outfalls and sewage connections upstream", "Trace discharge points feeding the affected water body or drain.", "water hotspot")
            if share.get("sewage", 0) >= 0.3:
                act("Repair overflowing sewer lines", "Sewage overflows are a large share of reports here.", "sewage ≥ 30%")
            act("Issue a public health advisory", "Advise residents against contact with the affected water.", "water hotspot")
            title = f"Water contamination cluster: {h.name.split(' · ')[0]}"
            kind = "water_hotspot_playbook"
        elif h.domain == "air":
            if share.get("open_burning", 0) >= 0.25:
                act("Open-burning patrols", "Target evening hours when burning reports peak.", "open burning ≥ 25%")
            if share.get("construction_dust", 0) >= 0.25:
                act("Enforce construction dust controls", "Require screening, water sprinkling and covered transport of material at active sites.", "construction dust ≥ 25%")
            act("Publish an air-quality advisory for the area", "Recommend sensitive groups limit outdoor exertion.", "air hotspot")
            title = f"Air pollution cluster: {h.name.split(' · ')[0]}"
            kind = "air_hotspot_playbook"
        elif h.domain == "noise":
            act("Enforce permitted noise hours", "Night-time noise reports dominate this cluster.", "noise hotspot")
            if sensitive:
                act("Designate a silence zone", f"{sensitive} school/hospital site(s) within 400 m.", "sensitive site within 400 m")
            title = f"Noise hotspot: {h.name.split(' · ')[0]}"
            kind = "noise_hotspot_playbook"
        elif h.domain == "flood":
            act("Clear drain inlets before the next rain", "Blocked inlets are the most common driver of local waterlogging.", "flood hotspot")
            act("Desilt the local drain network", "Repeated waterlogging indicates reduced drain capacity.", "flood hotspot")
            title = f"Recurring waterlogging: {h.name.split(' · ')[0]}"
            kind = "flood_hotspot_playbook"
        else:
            act("Protect remaining trees and replant", "Tree loss is clustered here.", "green hotspot")
            title = f"Tree loss cluster: {h.name.split(' · ')[0]}"
            kind = "green_hotspot_playbook"
        act("Ask nearby citizens to re-verify weekly", "EcoPulse will prompt citizens nearby to confirm whether issues persist, so you can track the effect of these actions.", "software monitoring for every hotspot")

        key = f"{kind}:{h.id}"
        keys.add(key)
        await _upsert(
            db,
            key,
            kind=kind,
            title=title,
            target_type="hotspot",
            target_id=str(h.id),
            location_id=h.location_id,
            geom=f"SRID=4326;POINT({cx} {cy})",
            observed={
                "reports": h.report_count,
                "active_incidents": h.active_incidents,
                "incidents_total": h.incident_count,
                "days_detected": days,
                "category_mix": {category_label(k): v for k, v in mix.most_common()},
                "nearest_collection_point_m": round(nearest_bin) if nearest_bin is not None else None,
                "sensitive_sites_400m": sensitive,
            },
            inference={
                "hotspot_risk": h.risk_score,
                "trend_pct_14d": h.trend_pct,
                "persistence": "persistent" if persistent else "emerging",
                "model": h.method,
            },
            actions=actions,
            expected_impact=_impact(h.risk_score),
            confidence=_confidence(h.report_count, bonus=0.05 if persistent else 0.0),
            priority_score=round(h.risk_score * (1 + max(0, min(h.trend_pct, 100)) / 200), 1),
        )


async def _waste_sites(db: AsyncSession, keys: set[str]) -> None:
    """Greedy maximal coverage: place up to 8 collection points for uncovered waste incidents."""
    rows = (
        await db.execute(
            text(
                f"""
                SELECT i.id, ST_X(i.geom) x, ST_Y(i.geom) y, i.report_count, i.severity
                FROM incidents i
                WHERE i.domain='waste' AND i.status NOT IN ('resolved','citizen_verified','dismissed')
                  AND NOT EXISTS (SELECT 1 FROM waste_points w
                                  WHERE ST_DWithin(w.geom::geography, i.geom::geography, {COVERAGE_M}))
                """
            )
        )
    ).all()
    if not rows:
        return
    pts = [(r.y, r.x, r.report_count * r.severity, r.id) for r in rows]
    candidates = {h3.latlng_to_cell(lat, lon, 9) for lat, lon, _, _ in pts}
    cand_xy = {c: h3.cell_to_latlng(c) for c in candidates}

    def covers(c: str, p) -> bool:
        lat, lon = cand_xy[c]
        dlat = math.radians(p[0] - lat)
        dlon = math.radians(p[1] - lon) * math.cos(math.radians(lat))
        return 6_371_000 * math.hypot(dlat, dlon) <= COVERAGE_M

    remaining = list(pts)
    for n in range(8):
        best, best_w, best_cov = None, 0.0, []
        for c in candidates:
            cov = [p for p in remaining if covers(c, p)]
            w = sum(p[2] for p in cov)
            if w > best_w:
                best, best_w, best_cov = c, w, cov
        if best is None or len(best_cov) < 3:
            break
        remaining = [p for p in remaining if p not in best_cov]
        lat, lon = cand_xy[best]
        loc = (
            await db.execute(
                text("SELECT id, name FROM locations WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(:x,:y),4326)) LIMIT 1"),
                {"x": lon, "y": lat},
            )
        ).first()
        pop = await db.scalar(
            text("SELECT population FROM grid_cells WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(:x,:y),4326))"),
            {"x": lon, "y": lat},
        )
        key = f"waste_collection_point:{best}"
        keys.add(key)
        reports = sum(p[2] for p in best_cov)
        await _upsert(
            db,
            key,
            kind="waste_collection_point",
            title=f"New waste collection point · {loc.name if loc else 'unnamed area'}",
            target_type="location",
            target_id=str(loc.id) if loc else None,
            location_id=loc.id if loc else None,
            geom=f"SRID=4326;POINT({lon} {lat})",
            observed={
                "uncovered_waste_incidents_within_250m": len(best_cov),
                "severity_weighted_reports": reports,
                "existing_points_within_250m": 0,
                "residents_in_cell_estimate": pop,
            },
            inference={
                "method": "greedy maximal-coverage over H3 r9 candidate sites",
                "coverage_radius_m": COVERAGE_M,
                "selection_order": n + 1,
            },
            actions=[
                {"rank": 1, "title": "Site a collection point here", "detail": "Covers incidents that currently have no collection point within 250 m.", "rule": "max coverage"},
                {"rank": 2, "title": "Pair with a fixed collection schedule", "detail": "Publish collection times so residents use the point.", "rule": "default"},
            ],
            expected_impact=_impact(min(100, 20 + 6 * len(best_cov))),
            confidence=_confidence(len(best_cov), scale=8),
            priority_score=round(min(100, 20 + 6 * len(best_cov)), 1),
        )


async def _green_corridors(db: AsyncSession, keys: set[str]) -> None:
    rows = (
        await db.execute(
            text(
                """
                WITH big AS (SELECT id, name, geom, area_m2 FROM green_zones WHERE area_m2 >= 30000
                             ORDER BY area_m2 DESC LIMIT 400)
                SELECT a.id a_id, b.id b_id, a.name a_name, b.name b_name,
                       ST_AsEWKT(ST_ShortestLine(a.geom, b.geom)) line,
                       ST_Length(ST_ShortestLine(a.geom, b.geom)::geography) len
                FROM big a JOIN big b ON a.id < b.id
                 AND ST_DWithin(a.geom, b.geom, 0.017)
                 AND ST_DWithin(a.geom::geography, b.geom::geography, 1800)
                 AND NOT ST_DWithin(a.geom::geography, b.geom::geography, 250)
                ORDER BY a.area_m2 + b.area_m2 DESC
                LIMIT 120
                """
            )
        )
    ).all()
    scored = []
    for r in rows:
        stats = (
            await db.execute(
                text(
                    """SELECT avg(green_fraction) g, sum(population) pop, avg(risk) risk, max(location_id) loc
                       FROM grid_cells WHERE ST_Intersects(geom, ST_Buffer(ST_GeomFromEWKT(:l)::geography, 150)::geometry)"""
                ),
                {"l": r.line},
            )
        ).one()
        if stats.g is None:
            continue
        air = await db.scalar(
            text(
                """SELECT avg(e.air) FROM environmental_scores e JOIN grid_cells c ON c.location_id = e.location_id
                   WHERE e.is_current AND ST_Intersects(c.geom, ST_GeomFromEWKT(:l))"""
            ),
            {"l": r.line},
        )
        green_gap = 1 - min(1.0, float(stats.g) / 0.3)
        pop_norm = 1 - math.exp(-float(stats.pop or 0) / 40000)
        air_need = 1 - float(air or 70) / 100
        score = 100 * (0.4 * green_gap + 0.35 * pop_norm + 0.25 * air_need)
        scored.append((score, r, stats, air, green_gap, pop_norm))
    scored.sort(key=lambda s: -s[0])
    used: set[int] = set()
    picked = 0
    for score, r, stats, air, green_gap, pop_norm in scored:
        if picked >= 6 or r.a_id in used or r.b_id in used:
            continue
        used.update({r.a_id, r.b_id})
        picked += 1
        key = f"green_corridor:{r.a_id}-{r.b_id}"
        keys.add(key)
        loc_name = await db.scalar(text("SELECT name FROM locations WHERE id=:i"), {"i": stats.loc}) if stats.loc else None
        if r.a_name and r.b_name:
            title = f"Green corridor: {r.a_name} ↔ {r.b_name}"
        elif r.a_name or r.b_name:
            title = f"Green corridor from {r.a_name or r.b_name}" + (f" · {loc_name}" if loc_name else "")
        else:
            title = f"Green corridor · {loc_name or 'unnamed area'}"
        await _upsert(
            db,
            key,
            kind="green_corridor",
            title=title,
            target_type="location",
            target_id=str(stats.loc) if stats.loc else None,
            location_id=stats.loc,
            geom=r.line,
            observed={
                "corridor_length_m": round(r.len),
                "green_share_along_route": round(float(stats.g), 3),
                "residents_along_route_estimate": int(stats.pop or 0),
            },
            inference={
                "green_gap": round(green_gap, 2),
                "population_benefit": round(pop_norm, 2),
                "air_score_nearby": round(float(air), 1) if air is not None else None,
                "method": "0.40 green gap + 0.35 population + 0.25 air need",
            },
            actions=[
                {"rank": 1, "title": "Plant street trees along the link", "detail": f"About {round(r.len / 8)} trees at 8 m spacing.", "rule": "corridor length"},
                {"rank": 2, "title": "Add shaded walking and cycling space", "detail": "Connect the two green areas for people as well as biodiversity.", "rule": "default"},
                {"rank": 3, "title": "Protect existing trees on the route", "detail": "Flag the route for tree-cutting permit review.", "rule": "default"},
            ],
            expected_impact=_impact(score),
            confidence=0.55,
            priority_score=round(score, 1),
        )


async def _flood_prep(db: AsyncSession, keys: set[str]) -> None:
    rows = (
        await db.execute(
            text(
                """
                SELECT l.id, l.name, count(*) cells, max(g.flood_predicted) peak, avg(g.flood_predicted) mean,
                       ST_AsEWKT(ST_Union(g.geom)) geom,
                       max((g.metrics->'flood'->>'rain_mm')::float) rain,
                       sum((g.metrics->'flood'->'components'->>'history')::float) hist
                FROM grid_cells g JOIN locations l ON l.id = g.location_id
                WHERE g.flood_predicted >= 0.3
                GROUP BY l.id, l.name
                """
            )
        )
    ).all()
    for r in rows:
        drains = await db.scalar(
            text("SELECT count(*) FROM incidents WHERE location_id=:l AND category='drainage' AND status NOT IN ('resolved','citizen_verified','dismissed')"),
            {"l": r.id},
        )
        floods = await db.scalar(
            text("SELECT count(*) FROM incidents WHERE location_id=:l AND category IN ('flooding','waterlogging')"), {"l": r.id}
        )
        key = f"flood_preparedness:{r.id}"
        keys.add(key)
        score = 100 * float(r.peak)
        await _upsert(
            db,
            key,
            kind="flood_preparedness",
            title=f"Flood preparedness · {r.name}",
            target_type="location",
            target_id=str(r.id),
            location_id=r.id,
            geom=r.geom,
            observed={
                "flood_or_waterlogging_reports_all_time": floods,
                "open_drainage_problems": drains,
                "rain_mm_past24h_plus_next48h": round(r.rain or 0, 1),
            },
            inference={"predicted_flood_risk_peak": round(float(r.peak), 2), "cells_at_risk": r.cells, "model": "flood-1"},
            actions=[
                {"rank": 1, "title": "Clear drain inlets in the at-risk cells", "detail": "Prioritise cells with open drainage reports.", "rule": "predicted risk ≥ 0.3"},
                {"rank": 2, "title": "Pre-position pumping crews", "detail": "Low-lying cells with flooding history flood first.", "rule": "history + low elevation"},
                {"rank": 3, "title": "Send a flood-risk notice to residents", "detail": "EcoPulse can notify residents whose home area is in the at-risk cells.", "rule": "default"},
            ],
            expected_impact=_impact(score),
            confidence=_confidence(floods + drains, scale=10),
            priority_score=round(score, 1),
        )


async def _silence_zones(db: AsyncSession, keys: set[str]) -> None:
    rows = (
        await db.execute(
            text(
                """
                SELECT s.id, s.kind, coalesce(s.name, initcap(s.kind)) name, ST_X(s.geom) x, ST_Y(s.geom) y,
                       count(i.id) n, max(i.noise_db) peak_db, max(i.location_id) loc
                FROM sensitive_sites s JOIN incidents i
                  ON i.domain='noise' AND i.status NOT IN ('resolved','citizen_verified','dismissed')
                 AND ST_DWithin(i.geom::geography, s.geom::geography, 300)
                WHERE s.kind IN ('school','hospital','kindergarten')
                GROUP BY s.id HAVING count(i.id) >= 2
                """
            )
        )
    ).all()
    for r in rows:
        key = f"silence_zone:{r.id}"
        keys.add(key)
        await _upsert(
            db,
            key,
            kind="silence_zone",
            title=f"Silence zone around {r.name}",
            target_type="location",
            target_id=str(r.loc) if r.loc else None,
            location_id=r.loc,
            geom=f"SRID=4326;POINT({r.x} {r.y})",
            observed={"noise_incidents_within_300m": r.n, "peak_measured_db": r.peak_db, "site_kind": r.kind},
            inference={"rule": "≥ 2 open noise incidents within 300 m of a school or hospital"},
            actions=[
                {"rank": 1, "title": "Declare and sign a silence zone", "detail": "100 m radius around the site.", "rule": "sensitive site"},
                {"rank": 2, "title": "Restrict honking and amplified sound", "detail": "During school or visiting hours.", "rule": "default"},
            ],
            expected_impact="medium",
            confidence=_confidence(r.n, scale=5),
            priority_score=round(40 + 8 * r.n, 1),
        )


async def generate(db: AsyncSession) -> dict:
    keys: set[str] = set()
    for gen in (_hotspot_playbooks, _waste_sites, _green_corridors, _flood_prep, _silence_zones):
        try:
            await gen(db, keys)
            await db.commit()
        except Exception:
            log.exception("recommendation generator %s failed", gen.__name__)
            await db.rollback()
    await db.execute(
        update(Recommendation)
        .where(Recommendation.status == "open", Recommendation.key.notin_(keys or {"-"}))
        .values(status="superseded")
    )
    await db.commit()
    return {"open": len(keys)}
