"""Hotspot engine (``hotspot-1``).

Observed hotspots
    Per environmental domain, incidents from the last 45 days are clustered with
    weighted DBSCAN on the haversine metric (eps = 350 m). Each incident's weight is
    severity/2 · √reporters (resolved incidents ×0.3, they still indicate recurrence);
    a cluster needs a total weight ≥ 4 and at least two incidents (or one incident
    reported 12+ times).

    Hotspot risk = 100 · (0.45·top-risk + 0.25·density + 0.15·trend + 0.15·persistence)
        top-risk    mean risk of the five riskiest open incidents / 100
        density     1 − e^(−open incidents / 8)
        trend       clamp(report growth, last 14 d vs previous 14 d, 0..100 %);
                    growth = (recent − prior) / (prior + 2), capped at ±400 %
        persistence days since the cluster's first report / 30

    Identity is stable: a new cluster inherits the id of the existing hotspot it overlaps
    most, so the map and UI can animate updates instead of replacing everything.
    Hotspots that disappear become "cooling", then "resolved" after 14 days.

Predicted hotspots
    For each H3 cell and domain, weekly report counts over 8 weeks are fitted with a
    least-squares line. Cells whose 14-day forecast ≥ 4 reports, with a rising slope,
    and no active observed hotspot become *predicted* hotspots with a confidence that
    reflects how much history supports the fit. They are always labelled as predictions.
"""

import logging
import math
import uuid
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta

import h3
import numpy as np
from sklearn.cluster import DBSCAN
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.catalog import CATEGORY_BY_SLUG, TERMINAL
from app.core.geo import EARTH_R, GRID_RES
from app.models import Hotspot, Incident, Location
from app.realtime import bus

log = logging.getLogger("ecopulse.hotspots")

MODEL = "hotspot-1"
EPS_M = 350
MIN_WEIGHT = 4
DOMAIN_LABEL = {"waste": "Waste", "air": "Air", "water": "Water", "noise": "Noise", "green": "Green cover", "flood": "Flooding"}


def _clamp(v: float) -> float:
    return max(0.0, min(1.0, v))


async def _hotspot_summary(h: Hotspot, lon: float, lat: float) -> dict:
    return {
        "id": str(h.id),
        "name": h.name,
        "domain": h.domain,
        "kind": h.kind,
        "status": h.status,
        "risk_score": h.risk_score,
        "report_count": h.report_count,
        "active_incidents": h.active_incidents,
        "trend_pct": h.trend_pct,
        "primary_category": h.primary_category,
        "lon": lon,
        "lat": lat,
    }


async def detect(db: AsyncSession, *, emit: bool = True) -> dict:
    now = datetime.now(UTC)
    incidents = (
        await db.execute(
            select(Incident).where(Incident.last_reported_at >= now - timedelta(days=45), Incident.status != "dismissed")
        )
    ).scalars().all()
    if not incidents:
        return {"clusters": 0}

    coords = {
        r.id: (r.lon, r.lat)
        for r in await db.execute(
            text("SELECT id, ST_X(geom) lon, ST_Y(geom) lat FROM incidents WHERE id = ANY(:ids)"),
            {"ids": [i.id for i in incidents]},
        )
    }
    by_domain: dict[str, list[Incident]] = defaultdict(list)
    for inc in incidents:
        if inc.domain != "other":
            by_domain[inc.domain].append(inc)

    existing = (
        await db.execute(select(Hotspot).where(Hotspot.kind == "observed", Hotspot.status.in_(["active", "cooling"])))
    ).scalars().all()
    seen: set[uuid.UUID] = set()
    member_map: dict[uuid.UUID, uuid.UUID] = {}
    created, updated = 0, 0
    events: list[tuple[str, Hotspot]] = []

    for domain, items in by_domain.items():
        if len(items) < 2:
            continue
        X = np.radians(np.array([[coords[i.id][1], coords[i.id][0]] for i in items]))
        weights = np.array(
            [(i.severity / 2) * math.sqrt(max(i.reporter_count, 1)) * (0.3 if i.status in TERMINAL else 1.0) for i in items]
        )
        labels = DBSCAN(eps=EPS_M / EARTH_R, min_samples=MIN_WEIGHT, metric="haversine", algorithm="ball_tree").fit(
            X, sample_weight=weights
        ).labels_

        for label in set(labels) - {-1}:
            members = [items[k] for k in np.where(labels == label)[0]]
            ids = [m.id for m in members]
            open_members = [m for m in members if m.status not in TERMINAL]
            # A hotspot is a spatial concentration: several incidents, or one issue reported by very many people.
            if not open_members or (len(members) < 2 and sum(m.report_count for m in members) < 12):
                continue
            geo = (
                await db.execute(
                    text(
                        """SELECT ST_AsEWKT(ST_Buffer(ST_ConvexHull(ST_Collect(geom))::geography, 120)::geometry) poly,
                                  ST_AsEWKT(ST_Centroid(ST_Collect(geom))) c,
                                  ST_X(ST_Centroid(ST_Collect(geom))) lon, ST_Y(ST_Centroid(ST_Collect(geom))) lat
                           FROM incidents WHERE id = ANY(:ids)"""
                    ),
                    {"ids": ids},
                )
            ).one()
            trend_rows = (
                await db.execute(
                    text(
                        """SELECT count(*) FILTER (WHERE created_at >= now() - interval '14 days') recent,
                                  count(*) FILTER (WHERE created_at < now() - interval '14 days' AND created_at >= now() - interval '28 days') prior
                           FROM reports WHERE incident_id = ANY(:ids)"""
                    ),
                    {"ids": ids},
                )
            ).one()
            recent, prior = trend_rows.recent, trend_rows.prior
            # Smoothed growth (+2 in the denominator) so tiny prior counts do not explode; capped at ±400 %.
            trend_pct = round(max(-100.0, min(400.0, (recent - prior) / (prior + 2) * 100)), 1)
            top = sorted((m.risk_score for m in open_members), reverse=True)[:5]
            first = min(m.first_reported_at for m in members)
            comps = {
                "top_risk": _clamp(sum(top) / len(top) / 100),
                "density": _clamp(1 - math.exp(-len(open_members) / 8)),
                "trend": _clamp(trend_pct / 100),
                "persistence": _clamp((now - first).days / 30),
            }
            weights_h = {"top_risk": 0.45, "density": 0.25, "trend": 0.15, "persistence": 0.15}
            risk = round(100 * sum(weights_h[k] * v for k, v in comps.items()), 1)
            mix = Counter(m.category for m in members)
            primary = mix.most_common(1)[0][0]

            # Identity: reuse the overlapping existing hotspot of the same domain, if any.
            match = None
            best_overlap = 0.0
            for h in existing:
                if h.domain != domain or h.id in seen:
                    continue
                overlap = await db.scalar(
                    text("SELECT ST_Area(ST_Intersection(geom, ST_GeomFromEWKT(:p))) FROM hotspots WHERE id=:id"),
                    {"p": geo.poly, "id": h.id},
                )
                if overlap and overlap > best_overlap:
                    match, best_overlap = h, overlap

            loc_name = await db.scalar(
                select(Location.name).where(text("ST_Contains(locations.geom, ST_GeomFromEWKT(:c))")).params(c=geo.c).limit(1)
            )
            loc_id = await db.scalar(
                select(Location.id).where(text("ST_Contains(locations.geom, ST_GeomFromEWKT(:c))")).params(c=geo.c).limit(1)
            )
            values = dict(
                name=f"{loc_name or 'Unnamed area'} · {DOMAIN_LABEL.get(domain, domain.title())}",
                domain=domain,
                primary_category=primary,
                geom=geo.poly,
                centroid=geo.c,
                location_id=loc_id,
                h3_cells=sorted({h3.latlng_to_cell(geo.lat, geo.lon, GRID_RES)} | {m.h3 for m in members if m.h3}),
                risk_score=risk,
                risk_components={
                    "model": MODEL,
                    "components": {k: round(v, 3) for k, v in comps.items()},
                    "weights": weights_h,
                    "inputs": {"open_incidents": len(open_members), "reports_14d": recent, "reports_prev_14d": prior},
                },
                report_count=sum(m.report_count for m in members),
                incident_count=len(members),
                active_incidents=len(open_members),
                trend_pct=trend_pct,
                category_mix=dict(mix),
                status="active",
                kind="observed",
                confidence=round(min(0.95, 0.5 + 0.05 * len(members)), 2),
                method=f"{MODEL}:dbscan-haversine-{EPS_M}m",
                updated_at=now,
            )
            if match is not None:
                changed = abs(match.risk_score - risk) >= 1 or match.active_incidents != len(open_members) or match.status != "active"
                for k, v in values.items():
                    setattr(match, k, v)
                hs = match
                updated += 1
                if changed:
                    events.append(("hotspot.updated", hs))
            else:
                hs = Hotspot(id=uuid.uuid4(), key=f"{domain}:{uuid.uuid4().hex[:12]}", **values)
                db.add(hs)
                created += 1
                events.append(("hotspot.created", hs))
            seen.add(hs.id)
            for m in members:
                member_map[m.id] = hs.id

    # Hotspots that no longer form a cluster cool down, then resolve.
    for h in existing:
        if h.id in seen:
            continue
        if h.status == "active":
            h.status = "cooling"
            h.updated_at = now
            events.append(("hotspot.cooled", h))
        elif h.status == "cooling" and h.updated_at < now - timedelta(days=14):
            h.status = "resolved"

    await db.flush()
    await db.execute(update(Incident).where(Incident.hotspot_id.isnot(None)).values(hotspot_id=None))
    for iid, hid in member_map.items():
        await db.execute(update(Incident).where(Incident.id == iid).values(hotspot_id=hid))
    await db.commit()

    if emit:
        for etype, h in events:
            xy = (await db.execute(text("SELECT ST_X(centroid), ST_Y(centroid) FROM hotspots WHERE id=:i"), {"i": h.id})).one()
            await bus.emit(etype, await _hotspot_summary(h, xy[0], xy[1]), lon=xy[0], lat=xy[1])

    predicted = await predict(db)
    return {"created": created, "updated": updated, "active": len(seen), "predicted": predicted}


async def predict(db: AsyncSession) -> int:
    """Trend-extrapolated hotspot forecast per H3 cell (next 14 days)."""
    rows = await db.execute(
        text(
            """
            SELECT r.h3, c.domain, floor(extract(epoch FROM now() - r.created_at) / 604800)::int AS wk, count(*) n
            FROM reports r JOIN categories c ON c.slug = r.category
            WHERE r.created_at >= now() - interval '56 days' AND r.h3 IS NOT NULL AND c.domain <> 'other'
            GROUP BY 1, 2, 3
            """
        )
    )
    series: dict[tuple[str, str], np.ndarray] = defaultdict(lambda: np.zeros(8))
    for h, dom, wk, n in rows:
        if 0 <= wk < 8:
            series[(h, dom)][7 - wk] = n  # oldest → newest

    active_cells = set()
    for (cells,) in await db.execute(
        text("SELECT h3_cells FROM hotspots WHERE kind='observed' AND status='active'")
    ):
        active_cells.update(cells or [])

    now = datetime.now(UTC)
    keep_keys = set()
    t = np.arange(8)
    for (cell_id, domain), y in series.items():
        if y.sum() < 4 or cell_id in active_cells:
            continue
        slope, intercept = np.polyfit(t, y, 1)
        level = intercept + slope * 7
        forecast_14d = max(0.0, 2 * (level + 1.5 * slope))
        if forecast_14d < 4 or slope <= 0.15:
            continue
        weeks_with_data = int((y > 0).sum())
        resid = y - (intercept + slope * t)
        fit = 1 - (resid.var() / y.var()) if y.var() > 0 else 0
        confidence = round(max(0.15, min(0.8, 0.15 + 0.06 * weeks_with_data + 0.25 * max(fit, 0))), 2)
        key = f"pred:{domain}:{cell_id}"
        keep_keys.add(key)
        boundary = h3.cell_to_boundary(cell_id)
        ring = ", ".join(f"{lng} {lat}" for lat, lng in boundary) + f", {boundary[0][1]} {boundary[0][0]}"
        lat, lng = h3.cell_to_latlng(cell_id)
        hs = (await db.execute(select(Hotspot).where(Hotspot.key == key))).scalar_one_or_none()
        loc = await db.scalar(
            text("SELECT name FROM locations WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(:x,:y),4326)) LIMIT 1"),
            {"x": lng, "y": lat},
        )
        values = dict(
            name=f"{loc or 'Unnamed area'} · {DOMAIN_LABEL.get(domain, domain)} (forecast)",
            domain=domain,
            primary_category=max(
                (c for c in CATEGORY_BY_SLUG if CATEGORY_BY_SLUG[c][2] == domain), key=lambda c: CATEGORY_BY_SLUG[c][4]
            ),
            geom=f"SRID=4326;POLYGON(({ring}))",
            centroid=f"SRID=4326;POINT({lng} {lat})",
            h3_cells=[cell_id],
            risk_score=round(min(100, forecast_14d * 6), 1),
            risk_components={
                "model": f"{MODEL}:forecast",
                "inputs": {"weekly_reports_oldest_to_newest": [int(v) for v in y]},
                "slope_per_week": round(float(slope), 2),
                "forecast_reports_14d": round(float(forecast_14d), 1),
                "fit_r2": round(float(fit), 2),
            },
            report_count=int(y.sum()),
            trend_pct=round(float(slope / max(y.mean(), 0.5) * 100), 1),
            status="active",
            kind="predicted",
            confidence=confidence,
            method=f"{MODEL}:linear-trend-8w",
            updated_at=now,
        )
        if hs is None:
            db.add(Hotspot(id=uuid.uuid4(), key=key, **values))
        else:
            for k, v in values.items():
                setattr(hs, k, v)
    await db.execute(
        update(Hotspot)
        .where(Hotspot.kind == "predicted", Hotspot.status == "active", Hotspot.key.notin_(keep_keys or {"-"}))
        .values(status="resolved")
    )
    await db.commit()
    return len(keep_keys)
