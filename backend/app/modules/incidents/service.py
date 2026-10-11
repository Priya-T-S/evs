import random
import string
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.catalog import CATEGORY_BY_SLUG, SEVERITY_LABELS, TERMINAL, category_label, priority_for
from app.core.config import settings
from app.core.geo import cell, point_xy, snap_public, wkt_point
from app.core.storage import storage
from app.intelligence import risk as riskmodel
from app.models import ExternalData, GridCell, Incident, IncidentEvent, Location, Media, Report
from app.realtime import bus

GRID_CELL_KM2 = 0.737
EXPOSURE_RADIUS_KM2 = 0.785  # 500 m radius


def new_ref() -> str:
    return "EP-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def make_title(category: str, location_name: str | None) -> str:
    label = category_label(category)
    return f"{label} near {location_name}" if location_name else label


async def location_for_point(db: AsyncSession, lon: float, lat: float) -> Location | None:
    stmt = (
        select(Location)
        .where(func.ST_Intersects(Location.geom, func.ST_GeomFromEWKT(wkt_point(lon, lat))))
        .limit(1)
    )
    loc = (await db.execute(stmt)).scalar_one_or_none()
    if loc is None:
        # Points just outside every polygon attach to the nearest area within 3 km.
        stmt = (
            select(Location)
            .where(
                func.ST_DWithin(
                    func.Geography(Location.geom), func.Geography(func.ST_GeomFromEWKT(wkt_point(lon, lat))), 3000
                )
            )
            .order_by(func.ST_Distance(Location.geom, func.ST_GeomFromEWKT(wkt_point(lon, lat))))
            .limit(1)
        )
        loc = (await db.execute(stmt)).scalar_one_or_none()
    return loc


async def sensitive_sites_near(db: AsyncSession, lon: float, lat: float, radius_m: int = 300) -> list[dict]:
    rows = await db.execute(
        text(
            """
            SELECT kind, name, ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography) AS d
            FROM sensitive_sites
            WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography, :r)
            ORDER BY d LIMIT 8
            """
        ),
        {"lon": lon, "lat": lat, "r": radius_m},
    )
    return [{"kind": k, "name": n, "distance_m": round(d)} for k, n, d in rows]


async def external_signal(db: AsyncSession, domain: str, location_id: int | None) -> tuple[float | None, str | None]:
    if location_id is None or domain not in ("air", "flood"):
        return None, None
    kind = "aqi" if domain == "air" else "weather"
    row = (
        await db.execute(
            select(ExternalData)
            .where(ExternalData.kind == kind, ExternalData.location_id == location_id)
            .order_by(ExternalData.observed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None, None
    tag = " (demo)" if row.is_demo else ""
    if domain == "air":
        aqi = row.value.get("us_aqi")
        if aqi is None:
            return None, None
        return min(1.0, aqi / 300), f"US AQI {round(aqi)} · {row.source_name}{tag}"
    rain = (row.value.get("precip_next_48h_mm") or 0) + 0.5 * (row.value.get("precip_past_24h_mm") or 0)
    return min(1.0, rain / 60), f"{round(rain, 1)} mm rain (past 24 h + next 48 h) · {row.source_name}{tag}"


async def recompute_risk(db: AsyncSession, inc: Incident) -> None:
    lon, lat = point_xy(inc.geom)
    cat = CATEGORY_BY_SLUG.get(inc.category, CATEGORY_BY_SLUG["other"])
    loc = await db.get(Location, inc.location_id) if inc.location_id else None

    grid = await db.get(GridCell, inc.h3) if inc.h3 else None
    if grid is not None and grid.population:
        population = int(grid.population / GRID_CELL_KM2 * EXPOSURE_RADIUS_KM2)
    elif loc is not None and loc.area_km2:
        population = int(loc.population / loc.area_km2 * EXPOSURE_RADIUS_KM2)
    else:
        population = 0

    sites = await sensitive_sites_near(db, lon, lat)
    recent = await db.scalar(
        select(func.count(Report.id)).where(
            Report.incident_id == inc.id, Report.created_at >= datetime.now(UTC) - timedelta(hours=72)
        )
    )
    ext, ext_note = await external_signal(db, inc.domain, inc.location_id)
    first = inc.first_reported_at or datetime.now(UTC)
    end = inc.resolved_at or datetime.now(UTC)
    score, explanation = riskmodel.compute(
        riskmodel.RiskInputs(
            severity=inc.severity,
            hazard_weight=cat[4],
            reporters=max(inc.reporter_count, 1),
            population_exposed=population,
            age_days=max(0.0, (end - first).total_seconds() / 86400),
            persistence_days=cat[5],
            sensitive_sites=sites,
            area_sensitivity=loc.sensitivity if loc else 1.0,
            recent_reports_72h=recent or 0,
            external_signal=ext,
            external_note=ext_note,
        )
    )
    if inc.status in TERMINAL:
        score = round(score * 0.25, 1)  # resolved issues stay visible but stop competing for attention
        explanation["note"] = "Resolved: residual risk shown at 25%."
    inc.risk_score = score
    inc.risk_components = explanation
    inc.population_exposed = population
    inc.sensitive_nearby = sites
    inc.priority = priority_for(score)


def confidence_from(inc: Incident) -> float:
    """Blend of AI confidence, independent corroboration and community verification."""
    ai = inc.ai_confidence if inc.ai_confidence is not None else 0.5
    corroboration = 1 - 0.6 ** max(inc.reporter_count, 1)
    votes = inc.verify_yes + inc.verify_no
    community = (inc.verify_yes + 1) / (votes + 2)  # Laplace-smoothed share saying "still present"
    weight_votes = min(votes / 6, 1) * 0.35
    base = 0.45 * ai + 0.55 * corroboration
    return round((1 - weight_votes) * base + weight_votes * community, 3)


async def add_event(
    db: AsyncSession,
    inc: Incident,
    kind: str,
    *,
    to_status: str | None = None,
    actor_id: uuid.UUID | None = None,
    note: str | None = None,
    **data,
) -> None:
    from_status = inc.status
    if to_status and to_status != inc.status:
        inc.status = to_status
    db.add(
        IncidentEvent(
            incident_id=inc.id,
            kind=kind,
            from_status=from_status if to_status else None,
            to_status=to_status,
            actor_id=actor_id,
            note=note,
            data=data,
        )
    )


def set_location(inc: Incident, lon: float, lat: float) -> None:
    inc.geom = wkt_point(lon, lat)
    plat, plon = snap_public(lat, lon, settings.public_location_precision_m)
    inc.public_geom = wkt_point(plon, plat)
    inc.h3 = cell(lat, lon)


def serialize(inc: Incident, *, exact: bool = False, location_name: str | None = None, thumb: str | None = None) -> dict:
    lon, lat = point_xy(inc.public_geom if not exact else inc.geom) or (None, None)
    return {
        "id": str(inc.id),
        "ref": inc.ref,
        "title": inc.title,
        "category": inc.category,
        "category_label": category_label(inc.category),
        "domain": inc.domain,
        "status": inc.status,
        "severity": inc.severity,
        "severity_label": SEVERITY_LABELS.get(inc.severity, "moderate"),
        "priority": inc.priority,
        "risk_score": inc.risk_score,
        "confidence": inc.confidence,
        "lon": lon,
        "lat": lat,
        "location_precision": "exact" if exact else f"~{settings.public_location_precision_m} m",
        "location_id": inc.location_id,
        "location_name": location_name,
        "hotspot_id": str(inc.hotspot_id) if inc.hotspot_id else None,
        "report_count": inc.report_count,
        "reporter_count": inc.reporter_count,
        "verify": {"yes": inc.verify_yes, "no": inc.verify_no, "unsure": inc.verify_unsure},
        "ai_label": inc.ai_label,
        "ai_confidence": inc.ai_confidence,
        "population_exposed": inc.population_exposed,
        "near_sensitive": bool(inc.sensitive_nearby),
        "first_reported_at": inc.first_reported_at,
        "last_reported_at": inc.last_reported_at,
        "resolved_at": inc.resolved_at,
        "assigned_team": inc.assigned_team,
        "thumb_url": thumb,
        "is_demo": inc.is_demo,
    }


async def location_names(db: AsyncSession, ids: set[int]) -> dict[int, str]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    rows = await db.execute(select(Location.id, Location.name).where(Location.id.in_(ids)))
    return dict(rows.all())


async def thumbs_for(db: AsyncSession, incident_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Most recent evidence thumbnail per incident (one query)."""
    if not incident_ids:
        return {}
    rows = await db.execute(
        select(Report.incident_id, Media.thumb_key)
        .join(Media, Media.report_id == Report.id)
        .where(Report.incident_id.in_(incident_ids), Media.purpose == "evidence")
        .order_by(Report.incident_id, Media.created_at.desc())
        .ext(distinct_on(Report.incident_id))
    )
    return {iid: storage.url(key) for iid, key in rows.all()}


async def serialize_many(db: AsyncSession, incidents: list[Incident], *, exact: bool = False) -> list[dict]:
    names = await location_names(db, {i.location_id for i in incidents})
    thumbs = await thumbs_for(db, [i.id for i in incidents])
    return [serialize(i, exact=exact, location_name=names.get(i.location_id), thumb=thumbs.get(i.id)) for i in incidents]


async def broadcast(db: AsyncSession, inc: Incident, event_type: str, **extra) -> None:
    """Publish an incident event. Always uses the public (snapped) coordinate."""
    names = await location_names(db, {inc.location_id})
    thumbs = await thumbs_for(db, [inc.id])
    payload = serialize(inc, location_name=names.get(inc.location_id), thumb=thumbs.get(inc.id))
    payload.update(extra)
    await bus.emit(event_type, payload, lon=payload["lon"], lat=payload["lat"])
    if inc.severity >= 4 and event_type == "incident.created":
        await bus.emit(
            "alert.created",
            {
                "level": "critical",
                "title": f"Critical: {payload['title']}",
                "incident_id": payload["id"],
                "location_name": payload["location_name"],
            },
            lon=payload["lon"],
            lat=payload["lat"],
        )
