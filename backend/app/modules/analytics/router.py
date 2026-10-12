from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.catalog import OPEN_STATUSES, SLA_HOURS, category_label
from app.core.db import get_db
from app.core.deps import require
from app.models import User

router = APIRouter(prefix="/analytics", tags=["analytics"])
OPEN_SQL = "('" + "','".join(OPEN_STATUSES) + "')"
# Resolution targets per priority as an inline table: JOIN {SLA_SQL} ON sla.p = <priority>.
SLA_SQL = "(VALUES " + ",".join(f"('{p}', {h})" for p, h in SLA_HOURS.items()) + ") AS sla(p, h)"
OVERDUE_SQL = f"(status IN {OPEN_SQL} AND first_reported_at < now() - make_interval(hours => sla.h))"


@router.get("/overview")
async def overview(
    days: int = Query(30, ge=7, le=365),
    _: User = Depends(require("analytics.view")),
    db: AsyncSession = Depends(get_db),
):
    p = {"days": days}
    period = "make_interval(days => :days)"
    totals = (
        await db.execute(
            text(
                f"""
                SELECT
                  (SELECT count(*) FROM reports WHERE created_at >= now() - {period}) reports,
                  (SELECT count(*) FROM reports WHERE created_at >= now() - 2 * {period} AND created_at < now() - {period}) reports_prev,
                  (SELECT count(*) FROM incidents WHERE first_reported_at >= now() - {period}) incidents,
                  (SELECT count(*) FROM incidents WHERE resolved_at >= now() - {period}) resolved,
                  (SELECT count(*) FROM incidents WHERE status IN {OPEN_SQL}) open,
                  (SELECT count(*) FROM incidents JOIN {SLA_SQL} ON sla.p = priority WHERE {OVERDUE_SQL}) overdue,
                  (SELECT avg(CASE WHEN i.resolved_at <= i.first_reported_at + make_interval(hours => sla.h) THEN 1.0 ELSE 0 END)
                     FROM incidents i
                     CROSS JOIN LATERAL (
                       SELECT e.data->>'priority' p FROM incident_events e
                       WHERE e.incident_id = i.id AND e.kind = 'prioritized' AND e.created_at <= i.resolved_at
                       ORDER BY e.created_at DESC LIMIT 1) pe
                     JOIN {SLA_SQL} ON sla.p = pe.p
                     WHERE i.resolved_at >= now() - {period}) on_time_share,
                  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM resolved_at - first_reported_at)/86400)
                     FROM incidents WHERE resolved_at >= now() - {period}) median_resolution_days,
                  (SELECT avg(CASE WHEN status = 'citizen_verified' THEN 1.0 ELSE 0 END)
                     FROM incidents WHERE resolved_at >= now() - {period}) citizen_confirmed_share,
                  (SELECT count(DISTINCT user_id) FROM reports WHERE created_at >= now() - {period}) active_reporters,
                  (SELECT avg(CASE WHEN status = 'merged' THEN 1.0 ELSE 0 END) FROM reports WHERE created_at >= now() - {period}) duplicate_share
                """
            ),
            p,
        )
    ).one()
    daily = await db.execute(
        text(
            f"""SELECT date_trunc('day', r.created_at)::date d, c.domain, count(*) FROM reports r JOIN categories c ON c.slug = r.category
                WHERE r.created_at >= now() - {period} GROUP BY 1, 2 ORDER BY 1"""
        ),
        p,
    )
    by_category = await db.execute(
        text(
            f"""SELECT category, count(*) n,
                       count(*) FILTER (WHERE status IN {OPEN_SQL}) open,
                       avg(extract(epoch FROM resolved_at - first_reported_at)/86400) FILTER (WHERE resolved_at IS NOT NULL) avg_days
                FROM incidents WHERE first_reported_at >= now() - {period} GROUP BY 1 ORDER BY 2 DESC"""
        ),
        p,
    )
    by_location = await db.execute(
        text(
            f"""SELECT l.id, l.name, count(i.id) FILTER (WHERE i.status IN {OPEN_SQL}) open,
                       count(i.id) FILTER (WHERE i.first_reported_at >= now() - {period}) new,
                       count(i.id) FILTER (WHERE i.resolved_at >= now() - {period}) resolved,
                       max(s.overall) score
                FROM locations l LEFT JOIN incidents i ON i.location_id = l.id
                LEFT JOIN environmental_scores s ON s.location_id = l.id AND s.is_current
                GROUP BY l.id, l.name ORDER BY open DESC"""
        ),
        p,
    )
    funnel = dict(
        (await db.execute(text("SELECT status, count(*) FROM incidents GROUP BY status"))).all()
    )
    teams = await db.execute(
        text(
            f"""SELECT assigned_team, count(*) FILTER (WHERE status IN {OPEN_SQL}) open,
                       count(*) FILTER (WHERE resolved_at >= now() - {period}) resolved,
                       count(*) FILTER (WHERE {OVERDUE_SQL}) overdue
                FROM incidents LEFT JOIN {SLA_SQL} ON sla.p = priority
                WHERE assigned_team IS NOT NULL GROUP BY 1 ORDER BY 2 DESC"""
        ),
        p,
    )
    return {
        "period_days": days,
        "totals": {
            "reports": totals.reports,
            "reports_change_pct": round((totals.reports - totals.reports_prev) / max(totals.reports_prev, 1) * 100, 1),
            "incidents": totals.incidents,
            "resolved": totals.resolved,
            "open": totals.open,
            "overdue": totals.overdue,
            "on_time_share": round(float(totals.on_time_share), 2) if totals.on_time_share is not None else None,
            "median_resolution_days": round(totals.median_resolution_days, 1) if totals.median_resolution_days else None,
            "citizen_confirmed_share": round(float(totals.citizen_confirmed_share), 2) if totals.citizen_confirmed_share is not None else None,
            "active_reporters": totals.active_reporters,
            "duplicate_share": round(float(totals.duplicate_share or 0), 2),
        },
        "daily_by_domain": [{"day": d, "domain": dom, "reports": n} for d, dom, n in daily],
        "by_category": [
            {"category": c, "label": category_label(c), "incidents": n, "open": o, "avg_days_to_resolve": round(a, 1) if a else None}
            for c, n, o, a in by_category
        ],
        "by_location": [{"id": i, "name": nm, "open": o, "new": nw, "resolved": rs, "score": sc} for i, nm, o, nw, rs, sc in by_location],
        "status_funnel": funnel,
        "teams": [{"team": t, "open": o, "resolved": r, "overdue": od} for t, o, r, od in teams],
    }
