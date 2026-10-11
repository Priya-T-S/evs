"""Data tools for the environmental assistant. Every answer is built from these results."""

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.catalog import OPEN_STATUSES, category_label
from app.intelligence.scores import grade
from app.models import EnvironmentalScore, Location
from app.modules.incidents.service import location_for_point

OPEN_SQL = "('" + "','".join(OPEN_STATUSES) + "')"
DOMAINS = ["waste", "air", "water", "noise", "green", "flood"]


async def resolve_location(db: AsyncSession, name: str | None = None, lat: float | None = None, lon: float | None = None) -> Location | None:
    if name:
        loc = (
            await db.execute(select(Location).where(Location.name.ilike(f"%{name.strip()}%")).limit(1))
        ).scalar_one_or_none()
        if loc:
            return loc
    if lat is not None and lon is not None:
        return await location_for_point(db, lon, lat)
    return None


async def area_score(db: AsyncSession, location: str | None = None, lat: float | None = None, lon: float | None = None) -> dict:
    loc = await resolve_location(db, location, lat, lon)
    if loc is None:
        return {"error": "Location not found in EcoPulse coverage.", "known_locations": await _location_names(db)}
    s = (
        await db.execute(select(EnvironmentalScore).where(EnvironmentalScore.location_id == loc.id, EnvironmentalScore.is_current))
    ).scalar_one_or_none()
    top = await db.execute(
        text(
            f"""SELECT ref, title, category, priority, risk_score, reporter_count FROM incidents
                WHERE location_id=:l AND status IN {OPEN_SQL} ORDER BY risk_score DESC LIMIT 5"""
        ),
        {"l": loc.id},
    )
    rank = await db.scalar(
        text("SELECT count(*) + 1 FROM environmental_scores WHERE is_current AND overall > :o"), {"o": s.overall if s else 0}
    )
    total = await db.scalar(text("SELECT count(*) FROM environmental_scores WHERE is_current"))
    return {
        "location": loc.name,
        "provenance": "MODEL (pulse-1) computed from OBSERVED citizen reports and EXTERNAL AQI data",
        "overall": s.overall if s else None,
        "grade": grade(s.overall) if s else None,
        "city_rank": f"{rank} of {total}" if s else None,
        "dimensions": {k: getattr(s, k) for k in ("air", "water", "waste", "noise", "green", "clean")} if s else None,
        "weakest_dimensions": (s.explanation or {}).get("weakest") if s else None,
        "explanation": (s.explanation or {}).get("dimensions") if s else None,
        "top_open_incidents": [
            {"ref": r.ref, "title": r.title, "category": category_label(r.category), "priority": r.priority, "risk": r.risk_score, "reporters": r.reporter_count}
            for r in top
        ],
    }


async def worst_hotspots(db: AsyncSession, domain: str | None = None, limit: int = 5) -> dict:
    where = "status='active' AND kind='observed'"
    params: dict = {"lim": max(1, min(limit, 10))}
    if domain in DOMAINS:
        where += " AND domain=:d"
        params["d"] = domain
    rows = await db.execute(
        text(
            f"""SELECT name, domain, risk_score, report_count, active_incidents, trend_pct, primary_category
                FROM hotspots WHERE {where} ORDER BY risk_score DESC LIMIT :lim"""
        ),
        params,
    )
    return {
        "provenance": "MODEL (hotspot-1: weighted DBSCAN over OBSERVED incidents)",
        "domain": domain or "all",
        "hotspots": [
            {"name": r.name, "domain": r.domain, "risk": r.risk_score, "reports": r.report_count, "active_incidents": r.active_incidents,
             "trend_pct_14d": r.trend_pct, "primary_issue": category_label(r.primary_category)}
            for r in rows
        ],
    }


async def recent_changes(db: AsyncSession, days: int = 30, location: str | None = None) -> dict:
    days = max(7, min(days, 120))
    loc = await resolve_location(db, location) if location else None
    lf = "AND r.location_id = :l" if loc else ""
    params: dict = {"d": days}
    if loc:
        params["l"] = loc.id
    rows = await db.execute(
        text(
            f"""SELECT c.domain,
                       count(*) FILTER (WHERE r.created_at >= now() - make_interval(days => :d)) cur,
                       count(*) FILTER (WHERE r.created_at < now() - make_interval(days => :d) AND r.created_at >= now() - make_interval(days => 2 * :d)) prev
                FROM reports r JOIN categories c ON c.slug = r.category WHERE r.created_at >= now() - make_interval(days => 2 * :d) {lf}
                GROUP BY c.domain ORDER BY cur DESC"""
        ),
        params,
    )
    lf2 = "AND location_id = :l" if loc else ""
    res = (
        await db.execute(
            text(
                f"""SELECT count(*) FILTER (WHERE resolved_at >= now() - make_interval(days => :d)) resolved,
                           count(*) FILTER (WHERE first_reported_at >= now() - make_interval(days => :d)) new
                    FROM incidents WHERE true {lf2}"""
            ),
            params,
        )
    ).one()
    movers = await db.execute(
        text(
            f"""SELECT l.name, cur.overall now, old.overall before FROM locations l
                JOIN environmental_scores cur ON cur.location_id = l.id AND cur.is_current
                JOIN LATERAL (SELECT overall FROM environmental_scores o WHERE o.location_id = l.id
                              AND o.computed_at <= now() - make_interval(days => :d) ORDER BY computed_at DESC LIMIT 1) old ON true
                {'WHERE l.id = :l' if loc else ''}
                ORDER BY abs(cur.overall - old.overall) DESC LIMIT 5"""
        ),
        params,
    )
    rising = await db.execute(
        text("SELECT name, trend_pct, risk_score FROM hotspots WHERE status='active' AND kind='observed' AND trend_pct > 20 ORDER BY trend_pct DESC LIMIT 5")
    )
    return {
        "provenance": "OBSERVED report counts; score changes are MODEL outputs",
        "period_days": days,
        "scope": loc.name if loc else "city",
        "reports_by_domain": [
            {"domain": d, "this_period": c, "previous_period": p, "change_pct": round((c - p) / max(p, 1) * 100)} for d, c, p in rows
        ],
        "incidents_new": res.new,
        "incidents_resolved": res.resolved,
        "score_changes": [{"location": n, "now": a, "before": b, "change": round(a - b, 1)} for n, a, b in movers],
        "rising_hotspots": [{"name": n, "trend_pct_14d": t, "risk": r} for n, t, r in rising],
    }


async def green_cover_needs(db: AsyncSession, limit: int = 5) -> dict:
    rows = await db.execute(
        text(
            """SELECT l.name, s.green, (s.explanation->'dimensions'->'green'->>'green_area_share')::float share, l.population
               FROM environmental_scores s JOIN locations l ON l.id = s.location_id WHERE s.is_current ORDER BY s.green ASC LIMIT :n"""
        ),
        {"n": max(1, min(limit, 10))},
    )
    corridors = await db.execute(
        text("SELECT title, observed, priority_score FROM recommendations WHERE kind='green_corridor' AND status='open' ORDER BY priority_score DESC LIMIT 3")
    )
    return {
        "provenance": "EXTERNAL green areas (OpenStreetMap) → MODEL green score; corridors are RECOMMENDATIONS",
        "lowest_green_scores": [{"location": n, "green_score": g, "green_area_share": share, "population_estimate": p} for n, g, share, p in rows],
        "recommended_corridors": [{"title": t, "observed": o, "priority": pr} for t, o, pr in corridors],
    }


async def list_recommendations(db: AsyncSession, kind: str | None = None, location: str | None = None, limit: int = 5) -> dict:
    where, params = "r.status='open'", {"n": max(1, min(limit, 10))}
    if kind:
        where += " AND r.kind ILIKE :k"
        params["k"] = f"%{kind}%"
    if location:
        where += " AND l.name ILIKE :loc"
        params["loc"] = f"%{location}%"
    rows = await db.execute(
        text(
            f"""SELECT r.title, r.kind, r.expected_impact, r.confidence, r.actions, r.observed, l.name loc
                FROM recommendations r LEFT JOIN locations l ON l.id = r.location_id WHERE {where}
                ORDER BY r.priority_score DESC LIMIT :n"""
        ),
        params,
    )
    return {
        "provenance": "RECOMMENDATION (rec-1). These are suggestions derived from observed data, not facts.",
        "recommendations": [
            {"title": t, "kind": k, "location": loc, "expected_impact": i, "confidence": c, "top_actions": [a["title"] for a in (acts or [])[:3]], "based_on": obs}
            for t, k, i, c, acts, obs, loc in rows
        ],
    }


async def flood_outlook(db: AsyncSession) -> dict:
    rows = await db.execute(
        text(
            """SELECT l.name, max(g.flood_predicted) peak, max(g.flood_observed) observed, max((g.metrics->'flood'->>'rain_mm')::float) rain,
                      bool_or(e.is_demo) demo
               FROM grid_cells g JOIN locations l ON l.id = g.location_id
               LEFT JOIN LATERAL (SELECT is_demo FROM external_data WHERE kind='weather' AND location_id = l.id ORDER BY observed_at DESC LIMIT 1) e ON true
               GROUP BY l.name ORDER BY peak DESC LIMIT 6"""
        )
    )
    return {
        "provenance": "PREDICTED flood risk is a MODEL (flood-1); OBSERVED flooding comes from citizen reports in the last 72 h",
        "areas": [
            {"location": n, "predicted_risk_peak": round(p, 2), "observed_flooding_72h": round(o, 2), "rain_mm_window": r, "weather_is_demo": d}
            for n, p, o, r, d in rows
        ],
    }


async def _location_names(db: AsyncSession) -> list[str]:
    return [n for (n,) in await db.execute(text("SELECT name FROM locations ORDER BY name"))]


TOOLS = {
    "area_score": area_score,
    "worst_hotspots": worst_hotspots,
    "recent_changes": recent_changes,
    "green_cover_needs": green_cover_needs,
    "list_recommendations": list_recommendations,
    "flood_outlook": flood_outlook,
}

TOOL_SCHEMAS = [
    {
        "name": "area_score",
        "description": "Environmental Pulse score for a neighbourhood with per-dimension breakdown, the model's explanation of each dimension, and the riskiest open incidents. Use for 'why is my area's score low' questions. Pass the location name, or omit it to use the user's current position.",
        "input_schema": {"type": "object", "properties": {"location": {"type": "string", "description": "Neighbourhood name, e.g. 'Koramangala'"}}, "additionalProperties": False},
    },
    {
        "name": "worst_hotspots",
        "description": "Highest-risk active environmental hotspots, optionally filtered to one domain.",
        "input_schema": {
            "type": "object",
            "properties": {"domain": {"type": "string", "enum": DOMAINS}, "limit": {"type": "integer", "minimum": 1, "maximum": 10}},
            "additionalProperties": False,
        },
    },
    {
        "name": "recent_changes",
        "description": "What changed over a period: reports by domain vs the previous period, new and resolved incidents, score changes, rising hotspots. Optionally scoped to one neighbourhood.",
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 7, "maximum": 120}, "location": {"type": "string"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "green_cover_needs",
        "description": "Neighbourhoods with the lowest green-cover scores and the top recommended green corridors.",
        "input_schema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}}, "additionalProperties": False},
    },
    {
        "name": "list_recommendations",
        "description": "Open intervention recommendations, optionally filtered by kind (e.g. 'waste', 'green_corridor', 'flood') or neighbourhood.",
        "input_schema": {
            "type": "object",
            "properties": {"kind": {"type": "string"}, "location": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 10}},
            "additionalProperties": False,
        },
    },
    {
        "name": "flood_outlook",
        "description": "Predicted flood risk (model) and observed flooding (citizen reports, last 72 h) by neighbourhood, with the rain window used.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]
