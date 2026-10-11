"""Environmental Pulse score (``pulse-1``). Every number is reproducible from stored data.

Scores are 0–100 where higher is better. For each location:

* **Load** for a domain = Σ over open incidents of severity × hazard × √reporters, per km².
  ``domain score = 100 · e^(−load / k)``; k is the load at which the score falls to 37.

| dimension | inputs                                                                       | k   |
|-----------|------------------------------------------------------------------------------|-----|
| air       | 60 % external AQI (100 − AQI/3) + 40 % citizen air load (burning, dust…)     | 6   |
| water     | citizen water load (water pollution, sewage)                                  | 5   |
| waste     | citizen waste load (garbage, dumping, plastic, e-waste)                       | 8   |
| noise     | citizen noise load, minus 0.8 pt per dB that measured levels average over 55 | 5   |
| green     | green-area share (25 % share ⇒ 100) − 4 pt per tree-loss incident per km²     | —   |
| clean     | 60 % share of last-60-day incidents resolved + 40 % speed, where speed =       | —   |
|           | e^(−median days each incident stayed open (resolved or still open)/14)         |     |

overall = 0.22 air + 0.18 water + 0.20 waste + 0.12 noise + 0.15 green + 0.13 clean

When the external AQI is unavailable the air score uses citizen data only, and the
explanation says so.
"""

import logging
import math
from datetime import UTC, datetime

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EnvironmentalScore, ExternalData, Location
from app.realtime import bus

log = logging.getLogger("ecopulse.scores")

MODEL = "pulse-1"
K = {"air": 6.0, "water": 5.0, "waste": 8.0, "noise": 5.0}
RISK_ALERT_DROP = 5.0  # points of Pulse lost between recomputes that trigger a resident alert
OVERALL_WEIGHTS = {"air": 0.22, "water": 0.18, "waste": 0.20, "noise": 0.12, "green": 0.15, "clean": 0.13}


def _score_from_load(load: float, k: float) -> float:
    return 100 * math.exp(-load / k)


def grade(score: float) -> str:
    return "good" if score >= 75 else "fair" if score >= 55 else "poor" if score >= 35 else "critical"


async def compute_location(db: AsyncSession, loc: Location) -> EnvironmentalScore:
    area = max(loc.area_km2, 0.25)
    loads = {
        d: float(v or 0)
        for d, v in await db.execute(
            text(
                """
                SELECT i.domain, sum(i.severity * c.hazard_weight * sqrt(greatest(i.reporter_count, 1)))
                FROM incidents i JOIN categories c ON c.slug = i.category
                WHERE i.location_id = :loc AND i.status NOT IN ('resolved','citizen_verified','dismissed')
                GROUP BY i.domain
                """
            ),
            {"loc": loc.id},
        )
    }
    counts = {
        d: n
        for d, n in await db.execute(
            text(
                """SELECT domain, count(*) FROM incidents WHERE location_id=:loc
                   AND status NOT IN ('resolved','citizen_verified','dismissed') GROUP BY domain"""
            ),
            {"loc": loc.id},
        )
    }
    density = {d: loads.get(d, 0.0) / area for d in ("air", "water", "waste", "noise", "green")}
    explanation: dict = {"model": MODEL, "area_km2": round(area, 2), "dimensions": {}}

    # Air: external AQI blended with citizen reports
    aqi_row = (
        await db.execute(
            select(ExternalData)
            .where(ExternalData.kind == "aqi", ExternalData.location_id == loc.id)
            .order_by(ExternalData.observed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    citizen_air = _score_from_load(density["air"], K["air"])
    if aqi_row and aqi_row.value.get("us_aqi") is not None:
        aqi = float(aqi_row.value["us_aqi"])
        ext_air = max(0.0, 100 - aqi / 3)
        air = 0.6 * ext_air + 0.4 * citizen_air
        explanation["dimensions"]["air"] = {
            "external": {"us_aqi": round(aqi), "pm2_5": aqi_row.value.get("pm2_5"), "source": aqi_row.source_name, "is_demo": aqi_row.is_demo},
            "citizen_load_per_km2": round(density["air"], 2),
            "open_incidents": counts.get("air", 0),
            "method": "0.6 × (100 − AQI/3) + 0.4 × citizen score",
        }
    else:
        air = citizen_air
        explanation["dimensions"]["air"] = {
            "external": None,
            "citizen_load_per_km2": round(density["air"], 2),
            "open_incidents": counts.get("air", 0),
            "method": "citizen reports only (no AQI data available)",
        }

    water = _score_from_load(density["water"], K["water"])
    waste = _score_from_load(density["waste"], K["waste"])
    for name in ("water", "waste"):
        explanation["dimensions"][name] = {
            "citizen_load_per_km2": round(density[name], 2),
            "open_incidents": counts.get(name, 0),
            "method": f"100 · e^(−load/{K[name]:g})",
        }

    mean_db = await db.scalar(
        text(
            """SELECT avg(noise_db) FROM reports WHERE location_id=:loc AND noise_db IS NOT NULL
               AND created_at >= now() - interval '30 days'"""
        ),
        {"loc": loc.id},
    )
    noise = _score_from_load(density["noise"], K["noise"])
    if mean_db is not None and mean_db > 55:
        noise -= 0.8 * (float(mean_db) - 55)
    explanation["dimensions"]["noise"] = {
        "citizen_load_per_km2": round(density["noise"], 2),
        "open_incidents": counts.get("noise", 0),
        "mean_measured_db_30d": round(float(mean_db), 1) if mean_db is not None else None,
        "method": "100 · e^(−load/5) − 0.8 per dB above 55",
    }

    green_share = float(
        await db.scalar(
            text(
                """SELECT COALESCE(ST_Area(ST_Intersection(l.geom, ST_Union(z.geom))::geography), 0) / NULLIF(ST_Area(l.geom::geography), 0)
                   FROM locations l JOIN green_zones z ON ST_Intersects(z.geom, l.geom) WHERE l.id=:loc GROUP BY l.geom"""
            ),
            {"loc": loc.id},
        )
        or 0
    )
    tree_loss_density = counts.get("green", 0) / area
    green = min(100.0, 100 * green_share / 0.25) - 4 * tree_loss_density
    explanation["dimensions"]["green"] = {
        "green_area_share": round(green_share, 3),
        "tree_loss_incidents": counts.get("green", 0),
        "method": "share of area that is green (25% ⇒ 100) − 4 per tree-loss incident/km²",
    }

    res = (
        await db.execute(
            text(
                """
                SELECT count(*) total,
                       count(*) FILTER (WHERE status IN ('resolved','citizen_verified')) resolved,
                       percentile_cont(0.5) WITHIN GROUP (
                         ORDER BY extract(epoch FROM coalesce(resolved_at, now()) - first_reported_at) / 86400) median_days
                FROM incidents WHERE location_id=:loc AND first_reported_at >= now() - interval '60 days' AND status <> 'dismissed'
                """
            ),
            {"loc": loc.id},
        )
    ).one()
    if res.total:
        ratio = res.resolved / res.total
        speed = math.exp(-(res.median_days or 0) / 14)
        clean = 100 * (0.6 * ratio + 0.4 * speed)
    else:
        ratio, speed, clean = None, None, 70.0
    explanation["dimensions"]["clean"] = {
        "incidents_60d": res.total,
        "resolved_share": round(ratio, 2) if ratio is not None else None,
        "median_days_open": round(res.median_days, 1) if res.median_days is not None else None,
        "method": "0.6 × resolved share + 0.4 × e^(−median days open/14)" if res.total else "no incidents in 60 days: neutral 70",
    }

    raw = {"air": air, "water": water, "waste": waste, "noise": noise, "green": green, "clean": clean}
    dims = {k: round(max(0.0, min(100.0, v)), 1) for k, v in raw.items()}
    overall = round(sum(OVERALL_WEIGHTS[k] * v for k, v in dims.items()), 1)
    explanation["weights"] = OVERALL_WEIGHTS
    explanation["weakest"] = sorted(dims, key=dims.get)[:2]
    return EnvironmentalScore(location_id=loc.id, overall=overall, explanation=explanation, model_version=MODEL, **dims)


async def recompute(db: AsyncSession, location_ids: list[int] | None = None, *, emit: bool = True) -> int:
    stmt = select(Location)
    if location_ids:
        stmt = stmt.where(Location.id.in_(location_ids))
    locs = (await db.execute(stmt)).scalars().all()
    changed = []
    for loc in locs:
        new = await compute_location(db, loc)
        prev = (
            await db.execute(
                select(EnvironmentalScore).where(EnvironmentalScore.location_id == loc.id, EnvironmentalScore.is_current)
            )
        ).scalar_one_or_none()
        if prev is not None and all(
            abs(getattr(prev, k) - getattr(new, k)) < 0.5 for k in ("overall", "air", "water", "waste", "noise", "green", "clean")
        ):
            prev.explanation = new.explanation
            continue
        await db.execute(
            update(EnvironmentalScore).where(EnvironmentalScore.location_id == loc.id).values(is_current=False)
        )
        new.computed_at = datetime.now(UTC)
        db.add(new)
        changed.append((loc, new, prev))
    await db.commit()
    if emit:
        from app.modules.notifications.service import notify_residents

        for loc, new, prev in changed:
            if prev is not None and new.overall <= prev.overall - RISK_ALERT_DROP:
                weakest = sorted(
                    ("air", "water", "waste", "noise", "green", "clean"), key=lambda k: getattr(new, k) - getattr(prev, k)
                )[0]
                await notify_residents(
                    db, loc.id, "risk_increased", f"Environmental risk increased in {loc.name}",
                    f"Pulse fell from {prev.overall:.0f} to {new.overall:.0f}, mostly {weakest}.",
                    f"risk:{loc.id}:{datetime.now(UTC):%Y%m%d}", location_id=str(loc.id),
                )
        await db.commit()
        for loc, new, prev in changed:
            cx = await db.scalar(text("SELECT ST_X(centroid) FROM locations WHERE id=:i"), {"i": loc.id})
            cy = await db.scalar(text("SELECT ST_Y(centroid) FROM locations WHERE id=:i"), {"i": loc.id})
            await bus.emit(
                "environmental_score.updated",
                {
                    "location_id": loc.id,
                    "location_name": loc.name,
                    "overall": new.overall,
                    "previous": prev.overall if prev else None,
                    "grade": grade(new.overall),
                    "dimensions": {k: getattr(new, k) for k in ("air", "water", "waste", "noise", "green", "clean")},
                },
                lon=cx,
                lat=cy,
            )
    return len(changed)


def score_out(s: EnvironmentalScore | None) -> dict | None:
    if s is None:
        return None
    return {
        "overall": s.overall,
        "grade": grade(s.overall),
        "dimensions": {k: getattr(s, k) for k in ("air", "water", "waste", "noise", "green", "clean")},
        "explanation": s.explanation,
        "model_version": s.model_version,
        "computed_at": s.computed_at,
    }

