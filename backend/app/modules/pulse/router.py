"""City Pulse: a compact, always-current summary of what is happening right now."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.catalog import OPEN_STATUSES, category_label
from app.core.config import settings
from app.core.db import get_db
from app.realtime.hub import hub

router = APIRouter(prefix="/pulse", tags=["pulse"])
OPEN_SQL = "('" + "','".join(OPEN_STATUSES) + "')"


@router.get("")
async def pulse(
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    radius_m: int = Query(3000, ge=200, le=20000),
    db: AsyncSession = Depends(get_db),
):
    stats = (
        await db.execute(
            text(
                f"""
                SELECT
                  count(*) FILTER (WHERE first_reported_at >= now() - interval '24 hours') new_24h,
                  count(*) FILTER (WHERE resolved_at >= now() - interval '24 hours') resolved_24h,
                  count(*) FILTER (WHERE status IN {OPEN_SQL}) open,
                  count(*) FILTER (WHERE status IN {OPEN_SQL} AND priority = 'P1') p1,
                  count(*) FILTER (WHERE status IN {OPEN_SQL} AND severity >= 4) critical
                FROM incidents
                """
            )
        )
    ).one()
    reports_24h = await db.scalar(text("SELECT count(*) FROM reports WHERE created_at >= now() - interval '24 hours'"))
    hotspots = await db.scalar(text("SELECT count(*) FROM hotspots WHERE status='active' AND kind='observed'"))

    geo_filter, params = "", {}
    if lat is not None and lon is not None:
        geo_filter = "AND ST_DWithin(i.public_geom::geography, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography, :r)"
        params = {"lon": lon, "lat": lat, "r": radius_m}

    # Feed: most recent meaningful changes (created, escalated, resolved), newest first.
    feed_rows = await db.execute(
        text(
            f"""
            SELECT DISTINCT ON (i.id) i.id, i.ref, i.title, i.category, i.domain, i.severity, i.priority, i.status,
                   i.reporter_count, i.risk_score, l.name loc, e.kind, e.created_at at,
                   ST_X(i.public_geom) x, ST_Y(i.public_geom) y, i.is_demo
            FROM incident_events e JOIN incidents i ON i.id = e.incident_id LEFT JOIN locations l ON l.id = i.location_id
            WHERE e.kind IN ('created','resolved','citizen_verified','auto_verified','community_verified','reopened','report_merged','assigned')
              AND e.created_at >= now() - interval '14 days' {geo_filter}
            ORDER BY i.id, e.created_at DESC
            """
        ),
        params,
    )
    feed = sorted(
        (
            {
                "incident_id": str(r.id),
                "ref": r.ref,
                "title": r.title,
                "category": r.category,
                "category_label": category_label(r.category),
                "domain": r.domain,
                "severity": r.severity,
                "priority": r.priority,
                "status": r.status,
                "reporter_count": r.reporter_count,
                "risk_score": r.risk_score,
                "location_name": r.loc,
                "event": r.kind,
                "at": r.at,
                "lon": r.x,
                "lat": r.y,
                "level": "resolved" if r.status in ("resolved", "citizen_verified") else ("critical" if r.priority == "P1" or r.severity >= 4 else "elevated" if r.priority == "P2" else "normal"),
                "is_demo": r.is_demo,
            }
            for r in feed_rows
        ),
        key=lambda f: f["at"],
        reverse=True,
    )[:40]

    movers = await db.execute(
        text(
            """SELECT id, name, domain, risk_score, trend_pct, active_incidents FROM hotspots
               WHERE status='active' AND kind='observed' ORDER BY trend_pct DESC, risk_score DESC LIMIT 5"""
        )
    )
    weekly = await db.execute(
        text(
            """SELECT date_trunc('day', created_at) d, count(*) FROM reports
               WHERE created_at >= now() - interval '14 days' GROUP BY 1 ORDER BY 1"""
        )
    )
    return {
        "city": settings.city_name,
        "stats": {
            "new_incidents_24h": stats.new_24h,
            "resolved_24h": stats.resolved_24h,
            "reports_24h": reports_24h,
            "open_incidents": stats.open,
            "p1_open": stats.p1,
            "critical_open": stats.critical,
            "active_hotspots": hotspots,
            "live_viewers": hub.size,
        },
        "feed": feed,
        "rising_hotspots": [
            {"id": str(r.id), "name": r.name, "domain": r.domain, "risk_score": r.risk_score, "trend_pct": r.trend_pct, "active_incidents": r.active_incidents}
            for r in movers
        ],
        "daily_reports": [{"day": d, "reports": n} for d, n in weekly],
    }
