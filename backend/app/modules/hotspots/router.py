import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.catalog import category_label
from app.core.db import get_db
from app.core.errors import NotFound
from app.models import Hotspot, Incident, Recommendation
from app.modules.incidents.service import serialize_many

router = APIRouter(prefix="/hotspots", tags=["hotspots"])


def _out(h: Hotspot, lon: float, lat: float) -> dict:
    return {
        "id": str(h.id),
        "name": h.name,
        "domain": h.domain,
        "kind": h.kind,
        "status": h.status,
        "primary_category": h.primary_category,
        "primary_category_label": category_label(h.primary_category),
        "risk_score": h.risk_score,
        "report_count": h.report_count,
        "incident_count": h.incident_count,
        "active_incidents": h.active_incidents,
        "trend_pct": h.trend_pct,
        "confidence": h.confidence,
        "category_mix": {category_label(k): v for k, v in sorted((h.category_mix or {}).items(), key=lambda kv: -kv[1])},
        "method": h.method,
        "location_id": h.location_id,
        "lon": lon,
        "lat": lat,
        "detected_at": h.created_at,
        "updated_at": h.updated_at,
    }


@router.get("")
async def list_hotspots(
    bbox: str | None = None,
    domain: str | None = None,
    kind: Literal["observed", "predicted", "all"] = "all",
    status: Literal["active", "cooling", "all"] = "active",
    format: Literal["json", "geojson"] = "json",
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    where, params = ["true"], {}
    if status != "all":
        where.append("status = :status")
        params["status"] = status
    if kind != "all":
        where.append("kind = :kind")
        params["kind"] = kind
    if domain:
        where.append("domain = ANY(:domains)")
        params["domains"] = domain.split(",")
    if bbox:
        w, s, e, n = (float(x) for x in bbox.split(","))
        where.append("ST_Intersects(geom, ST_MakeEnvelope(:w,:s,:e,:n,4326))")
        params.update(w=w, s=s, e=e, n=n)
    rows = (
        await db.execute(
            text(
                f"""SELECT id, ST_X(centroid) x, ST_Y(centroid) y, ST_AsGeoJSON(geom, 6) g FROM hotspots
                    WHERE {' AND '.join(where)} ORDER BY kind, risk_score DESC LIMIT {limit}"""
            ),
            params,
        )
    ).all()
    objs = {h.id: h for h in (await db.execute(select(Hotspot).where(Hotspot.id.in_([r.id for r in rows])))).scalars()}
    items = [(_out(objs[r.id], r.x, r.y), r.g) for r in rows]
    if format == "geojson":
        return {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "id": o["id"], "geometry": json.loads(g), "properties": {k: v for k, v in o.items() if k not in ("category_mix",)}}
                for o, g in items
            ],
            "meta": {"provenance": "model"},
        }
    return {"items": [o for o, _ in items]}


@router.get("/{hotspot_id}")
async def get_hotspot(hotspot_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    h = await db.get(Hotspot, hotspot_id)
    if h is None:
        raise NotFound("Hotspot not found.")
    r = (await db.execute(text("SELECT ST_X(centroid), ST_Y(centroid), ST_AsGeoJSON(geom, 6) FROM hotspots WHERE id=:i"), {"i": h.id})).one()
    out = _out(h, r[0], r[1])
    out["geometry"] = json.loads(r[2])
    out["risk"] = h.risk_components
    incs = (
        await db.execute(select(Incident).where(Incident.hotspot_id == h.id).order_by(Incident.risk_score.desc()).limit(25))
    ).scalars().all()
    out["incidents"] = await serialize_many(db, incs)
    trend = await db.execute(
        text(
            """SELECT date_trunc('week', r.created_at) wk, count(*) FROM reports r JOIN incidents i ON i.id = r.incident_id
               WHERE i.hotspot_id = :h AND r.created_at >= now() - interval '12 weeks' GROUP BY 1 ORDER BY 1"""
        ),
        {"h": h.id},
    )
    out["weekly_reports"] = [{"week": wk, "reports": n} for wk, n in trend]
    recs = (
        await db.execute(
            select(Recommendation).where(Recommendation.target_type == "hotspot", Recommendation.target_id == str(h.id), Recommendation.status != "superseded")
        )
    ).scalars().all()
    out["recommendations"] = [
        {"id": str(x.id), "title": x.title, "kind": x.kind, "confidence": x.confidence, "expected_impact": x.expected_impact, "status": x.status, "actions": x.actions}
        for x in recs
    ]
    return out
