import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import get_db
from app.core.deps import client_ip, require
from app.core.errors import NotFound
from app.models import Intervention, Recommendation, User

router = APIRouter(tags=["recommendations"])


def rec_out(r: Recommendation, location_name: str | None = None, geometry: dict | None = None) -> dict:
    return {
        "id": str(r.id),
        "kind": r.kind,
        "title": r.title,
        "status": r.status,
        "target_type": r.target_type,
        "target_id": r.target_id,
        "location_id": r.location_id,
        "location_name": location_name,
        "observed": r.observed,
        "inference": r.inference,
        "actions": r.actions,
        "expected_impact": r.expected_impact,
        "confidence": r.confidence,
        "priority_score": r.priority_score,
        "model_version": r.model_version,
        "geometry": geometry,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }


@router.get("/recommendations")
async def list_recommendations(
    kind: str | None = None,
    status: str = "open",
    location_id: int | None = None,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Recommendation).order_by(Recommendation.priority_score.desc()).limit(limit)
    if status != "all":
        stmt = stmt.where(Recommendation.status.in_(status.split(",")))
    if kind:
        stmt = stmt.where(Recommendation.kind.in_(kind.split(",")))
    if location_id:
        stmt = stmt.where(Recommendation.location_id == location_id)
    recs = (await db.execute(stmt)).scalars().all()
    names = dict((await db.execute(text("SELECT id, name FROM locations"))).all())
    geoms = {}
    if recs:
        for rid, g in await db.execute(
            text("SELECT id, ST_AsGeoJSON(geom, 6) FROM recommendations WHERE id = ANY(:ids) AND geom IS NOT NULL"), {"ids": [r.id for r in recs]}
        ):
            geoms[rid] = json.loads(g)
    kinds = dict((await db.execute(text("SELECT kind, count(*) FROM recommendations WHERE status='open' GROUP BY kind"))).all())
    return {"items": [rec_out(r, names.get(r.location_id), geoms.get(r.id)) for r in recs], "open_by_kind": kinds}


@router.get("/recommendations/{rec_id}")
async def get_recommendation(rec_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    r = await db.get(Recommendation, rec_id)
    if r is None:
        raise NotFound("Recommendation not found.")
    g = await db.scalar(text("SELECT ST_AsGeoJSON(geom, 6) FROM recommendations WHERE id=:i"), {"i": r.id})
    name = await db.scalar(text("SELECT name FROM locations WHERE id=:i"), {"i": r.location_id}) if r.location_id else None
    return rec_out(r, name, json.loads(g) if g else None)


class DecisionIn(BaseModel):
    decision: Literal["accept", "dismiss", "reopen"]
    note: str | None = Field(default=None, max_length=500)


@router.post("/recommendations/{rec_id}/decision")
async def decide(
    rec_id: uuid.UUID,
    body: DecisionIn,
    request: Request,
    user: User = Depends(require("recommendation.manage")),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(Recommendation, rec_id)
    if r is None:
        raise NotFound("Recommendation not found.")
    intervention_id = None
    if body.decision == "accept":
        r.status = "accepted"
        iv = Intervention(
            recommendation_id=r.id, kind=r.kind, title=r.actions[0]["title"] if r.actions else r.title, status="planned",
            geom=r.geom, location_id=r.location_id, owner_id=user.id, notes=body.note,
        )
        db.add(iv)
        await db.flush()
        intervention_id = str(iv.id)
    elif body.decision == "dismiss":
        r.status = "dismissed"
    else:
        r.status = "open"
    audit(db, f"recommendation.{body.decision}", actor_id=user.id, target_type="recommendation", target_id=r.id, ip=client_ip(request), note=body.note)
    await db.commit()
    return {"status": r.status, "intervention_id": intervention_id}


@router.get("/interventions")
async def list_interventions(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        text(
            """SELECT i.id, i.kind, i.title, i.status, i.notes, i.created_at, l.name loc, ST_AsGeoJSON(i.geom, 6) g, r.title rec_title
               FROM interventions i LEFT JOIN locations l ON l.id = i.location_id LEFT JOIN recommendations r ON r.id = i.recommendation_id
               ORDER BY i.created_at DESC LIMIT 200"""
        )
    )
    return {
        "items": [
            {"id": str(r.id), "kind": r.kind, "title": r.title, "status": r.status, "notes": r.notes, "created_at": r.created_at,
             "location_name": r.loc, "recommendation": r.rec_title, "geometry": json.loads(r.g) if r.g else None}
            for r in rows
        ]
    }


class InterventionUpdate(BaseModel):
    status: Literal["planned", "in_progress", "completed"]
    notes: str | None = Field(default=None, max_length=1000)


@router.patch("/interventions/{iv_id}")
async def update_intervention(
    iv_id: uuid.UUID, body: InterventionUpdate, request: Request,
    user: User = Depends(require("recommendation.manage")), db: AsyncSession = Depends(get_db),
):
    iv = await db.get(Intervention, iv_id)
    if iv is None:
        raise NotFound("Intervention not found.")
    iv.status = body.status
    if body.notes is not None:
        iv.notes = body.notes
    audit(db, "intervention.update", actor_id=user.id, target_type="intervention", target_id=iv.id, ip=client_ip(request), status=body.status)
    await db.commit()
    return {"status": iv.status}
