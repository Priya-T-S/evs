import uuid
from collections import Counter
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.audit import audit
from app.core.catalog import CATEGORY_BY_SLUG, OPEN_STATUSES, TERMINAL, category_domain
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import client_ip, current_user, optional_user, require
from app.core.errors import AppError, Conflict, NotFound
from app.core.geo import bbox_valid, haversine_m, point_xy
from app.core.security import has_permission
from app.core.storage import storage
from app.models import (
    Assignment,
    Hotspot,
    Incident,
    IncidentEvent,
    Media,
    Recommendation,
    Report,
    ResolutionUpdate,
    User,
    Verification,
)
from app.modules.incidents import service as svc
from app.modules.notifications import service as notifications
from app.realtime.jobs import enqueue

router = APIRouter(prefix="/incidents", tags=["incidents"])


def _parse_bbox(bbox: str | None) -> list[float] | None:
    if not bbox:
        return None
    try:
        parts = [float(x) for x in bbox.split(",")]
    except ValueError:
        raise AppError("bbox must be 'west,south,east,north'.", code="validation_error", status_code=422)
    if not bbox_valid(parts):
        raise AppError("bbox is out of range.", code="validation_error", status_code=422)
    return parts


@router.get("")
async def list_incidents(
    bbox: str | None = None,
    status: str = Query("open", description="open | resolved | all | <status>"),
    domain: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    location_id: int | None = None,
    hotspot_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=80),
    since: datetime | None = None,
    sort: Literal["risk", "recent"] = "risk",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0, le=10_000),
    user: User | None = Depends(optional_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Incident)
    if status == "open":
        stmt = stmt.where(Incident.status.in_(OPEN_STATUSES))
    elif status == "resolved":
        stmt = stmt.where(Incident.status.in_(list(TERMINAL)))
    elif status != "all":
        stmt = stmt.where(Incident.status == status)
    if (box := _parse_bbox(bbox)) is not None:
        stmt = stmt.where(func.ST_Intersects(Incident.public_geom, func.ST_MakeEnvelope(*box, 4326)))
    if domain:
        stmt = stmt.where(Incident.domain.in_(domain.split(",")))
    if category:
        stmt = stmt.where(Incident.category.in_(category.split(",")))
    if priority:
        stmt = stmt.where(Incident.priority.in_(priority.split(",")))
    if location_id:
        stmt = stmt.where(Incident.location_id == location_id)
    if hotspot_id:
        stmt = stmt.where(Incident.hotspot_id == hotspot_id)
    if since:
        stmt = stmt.where(Incident.last_reported_at >= since)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Incident.ref.ilike(like), Incident.title.ilike(like)))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    order = (Incident.risk_score.desc(), Incident.last_reported_at.desc()) if sort == "risk" else (Incident.last_reported_at.desc(),)
    rows = (await db.execute(stmt.order_by(*order).limit(limit).offset(offset))).scalars().all()
    exact = bool(user and has_permission(user.role, "incident.view_exact"))
    return {"items": await svc.serialize_many(db, rows, exact=exact), "total": total, "limit": limit, "offset": offset}


async def _get(db: AsyncSession, incident_id: uuid.UUID) -> Incident:
    inc = await db.get(Incident, incident_id)
    if inc is None:
        raise NotFound("Incident not found.")
    return inc


@router.get("/{incident_id}")
async def get_incident(
    incident_id: uuid.UUID, user: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)
):
    inc = await _get(db, incident_id)
    exact = bool(user and has_permission(user.role, "incident.view_exact"))
    names = await svc.location_names(db, {inc.location_id})
    out = svc.serialize(inc, exact=exact, location_name=names.get(inc.location_id))
    out["summary"] = inc.summary
    out["risk"] = inc.risk_components
    out["sensitive_nearby"] = inc.sensitive_nearby
    out["noise_db"] = inc.noise_db
    out["updated_at"] = inc.updated_at

    reports = (
        await db.execute(select(Report).where(Report.incident_id == inc.id).order_by(Report.created_at.desc()).limit(60))
    ).scalars().all()
    report_ids = [r.id for r in reports]
    media = (
        (await db.execute(select(Media).where(or_(Media.report_id.in_(report_ids), Media.incident_id == inc.id))))
        .scalars()
        .all()
        if report_ids
        else (await db.execute(select(Media).where(Media.incident_id == inc.id))).scalars().all()
    )
    reporters = {}
    if exact:
        uids = {r.user_id for r in reports if r.user_id and not r.is_anonymous}
        if uids:
            reporters = dict((await db.execute(select(User.id, User.display_name).where(User.id.in_(uids)))).all())
    out["reports"] = [
        {
            "id": str(r.id),
            "created_at": r.created_at,
            "description": r.description,
            "reporter": reporters.get(r.user_id) if exact and not r.is_anonymous else None,
            "is_mine": bool(user and r.user_id == user.id),
            "ai_label": r.ai_label,
            "ai_confidence": r.ai_confidence,
            "duplicate_score": r.duplicate_score,
            "noise_db": r.noise_db,
        }
        for r in reports
    ]
    out["evidence"] = [
        {"id": str(m.id), "url": storage.url(m.storage_key), "thumb_url": storage.url(m.thumb_key), "purpose": m.purpose, "created_at": m.created_at}
        for m in sorted(media, key=lambda m: m.created_at)
    ]

    # AI classification summary across all reports
    labelled = [r for r in reports if r.ai_provider]
    labels = Counter(r.ai_label for r in labelled)
    out["ai"] = {
        "label": inc.ai_label,
        "confidence": inc.ai_confidence,
        "providers": sorted({r.ai_provider for r in labelled}),
        "label_distribution": labels.most_common(4),
        "agreement": round(sum(1 for r in labelled if r.ai_category == inc.category) / len(labelled), 2) if labelled else None,
        "rationale": next(((r.ai_payload or {}).get("rationale") for r in labelled if r.ai_payload), None),
        "subtype": next(((r.ai_payload or {}).get("subtype") for r in labelled if (r.ai_payload or {}).get("subtype")), None),
    }

    events = (
        await db.execute(select(IncidentEvent).where(IncidentEvent.incident_id == inc.id).order_by(IncidentEvent.created_at))
    ).scalars().all()
    actor_names = {}
    if exact:
        aids = {e.actor_id for e in events if e.actor_id}
        if aids:
            actor_names = dict((await db.execute(select(User.id, User.display_name).where(User.id.in_(aids)))).all())
    out["timeline"] = [
        {
            "kind": e.kind,
            "from_status": e.from_status,
            "to_status": e.to_status,
            "note": e.note,
            "actor": actor_names.get(e.actor_id) if e.actor_id else ("System" if e.actor_id is None else None),
            "data": {k: v for k, v in (e.data or {}).items() if k not in ("data_report",)},
            "created_at": e.created_at,
        }
        for e in events
    ]

    assignment = (
        await db.execute(
            select(Assignment).where(Assignment.incident_id == inc.id, Assignment.active).order_by(Assignment.created_at.desc()).limit(1)
        )
    ).scalar_one_or_none()
    out["assignment"] = (
        {
            "team": assignment.team,
            "assignee": (await db.get(User, assignment.assignee_id)).display_name if exact and assignment.assignee_id else None,
            "due_at": assignment.due_at,
            "note": assignment.note if exact else None,
            "created_at": assignment.created_at,
        }
        if assignment
        else None
    )
    updates = (
        await db.execute(select(ResolutionUpdate).where(ResolutionUpdate.incident_id == inc.id).order_by(ResolutionUpdate.created_at))
    ).scalars().all()
    out["resolution"] = [{"status": u.status, "note": u.note, "created_at": u.created_at} for u in updates]

    lon, lat = point_xy(inc.geom)
    related = (
        await db.execute(
            select(Incident)
            .where(
                Incident.id != inc.id,
                Incident.status.in_(OPEN_STATUSES),
                func.ST_DWithin(func.Geography(Incident.geom), func.Geography(func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)), 1200),
            )
            .order_by(func.ST_Distance(Incident.geom, func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)))
            .limit(6)
        )
    ).scalars().all()
    rel = await svc.serialize_many(db, related, exact=exact)
    for r, ri in zip(rel, related):
        rlon, rlat = point_xy(ri.geom)
        r["distance_m"] = round(haversine_m(lat, lon, rlat, rlon), -1)
    out["related"] = rel

    if inc.hotspot_id:
        hs = await db.get(Hotspot, inc.hotspot_id)
        out["hotspot"] = {"id": str(hs.id), "name": hs.name, "risk_score": hs.risk_score, "trend_pct": hs.trend_pct} if hs else None
    else:
        out["hotspot"] = None
    recs = (
        await db.execute(
            select(Recommendation)
            .where(
                Recommendation.status == "open",
                or_(
                    (Recommendation.target_type == "incident") & (Recommendation.target_id == str(inc.id)),
                    (Recommendation.target_type == "hotspot") & (Recommendation.target_id == str(inc.hotspot_id)),
                ),
            )
            .limit(3)
        )
    ).scalars().all()
    out["recommendations"] = [{"id": str(r.id), "title": r.title, "kind": r.kind, "confidence": r.confidence} for r in recs]

    out["my_verification"] = None
    if user:
        v = (
            await db.execute(
                select(Verification).where(Verification.incident_id == inc.id, Verification.user_id == user.id).order_by(Verification.created_at.desc()).limit(1)
            )
        ).scalar_one_or_none()
        out["my_verification"] = {"response": v.response, "phase": v.phase, "created_at": v.created_at} if v else None
    out["can"] = {
        "moderate": bool(user and has_permission(user.role, "incident.moderate")),
        "assign": bool(user and has_permission(user.role, "incident.assign")),
        "resolve": bool(user and has_permission(user.role, "incident.resolve")),
    }
    return out


# --------------------------------------------------------------------------- community verification


class VerifyIn(BaseModel):
    response: Literal["yes", "no", "unsure"]
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)


@router.post("/{incident_id}/verify")
async def verify(
    incident_id: uuid.UUID, body: VerifyIn, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    """Answer "Is this issue still present?". Votes from people nearby count more."""
    await ratelimit.enforce(f"verify:{user.id}", 60, 3600)
    inc = await _get(db, incident_id)
    phase = "resolution" if inc.status in ("resolved", "citizen_verified") else "active"
    distance = None
    if body.lat is not None and body.lon is not None:
        ilon, ilat = point_xy(inc.geom)
        distance = round(haversine_m(body.lat, body.lon, ilat, ilon))
    existing = (
        await db.execute(
            select(Verification).where(Verification.incident_id == inc.id, Verification.user_id == user.id, Verification.phase == phase)
        )
    ).scalar_one_or_none()
    if existing:
        existing.response = body.response
        existing.distance_m = distance
    else:
        db.add(Verification(incident_id=inc.id, user_id=user.id, response=body.response, distance_m=distance, phase=phase))
    await db.flush()

    counts = dict(
        (
            await db.execute(
                select(Verification.response, func.count())
                .where(Verification.incident_id == inc.id, Verification.phase == phase)
                .group_by(Verification.response)
            )
        ).all()
    )
    yes, no, unsure = counts.get("yes", 0), counts.get("no", 0), counts.get("unsure", 0)
    inc.verify_yes, inc.verify_no, inc.verify_unsure = yes, no, unsure
    inc.confidence = svc.confidence_from(inc)
    reason = "resolution_confirmed" if phase == "resolution" and body.response == "no" else "verification"
    await notifications.award(db, user.id, reason, f"{inc.id}:{phase}")

    if phase == "active" and inc.status in ("reported", "ai_classified") and yes >= 3 and yes > 2 * no:
        await svc.add_event(db, inc, "community_verified", to_status="verified", yes=yes, no=no)
        await svc.recompute_risk(db, inc)
        await svc.add_event(db, inc, "prioritized", to_status="prioritized", priority=inc.priority, risk=inc.risk_score)
    elif phase == "resolution" and inc.status == "resolved" and no >= 3 and no > 2 * yes:
        await svc.add_event(db, inc, "citizen_verified", to_status="citizen_verified", confirmations=no)
        await _notify_reporters(db, inc, "report_resolved", "Fix confirmed by citizens", f"{no} citizens confirmed {inc.title} is fixed.", "confirmed")
    elif phase == "resolution" and yes >= 3 and yes > 2 * no:
        inc.resolved_at = None
        await svc.add_event(db, inc, "reopened", to_status="verified", note="Citizens report the issue is still present", yes=yes)
        await svc.recompute_risk(db, inc)
        await svc.add_event(db, inc, "prioritized", to_status="prioritized", priority=inc.priority, risk=inc.risk_score)
        await _notify_reporters(db, inc, "incident_reopened", "Issue reopened", f"Citizens report {inc.title} is still present.", "reopened")
    audit(db, "incident.verify", actor_id=user.id, target_type="incident", target_id=inc.id, ip=client_ip(request), response=body.response, phase=phase)
    await db.commit()
    await svc.broadcast(db, inc, "incident.updated")
    return {"phase": phase, "counts": {"yes": yes, "no": no, "unsure": unsure}, "status": inc.status, "confidence": inc.confidence}


async def _notify_reporters(db: AsyncSession, inc: Incident, kind: str, title: str, body: str, tag: str) -> None:
    uids = (await db.execute(select(Report.user_id).where(Report.incident_id == inc.id, Report.user_id.isnot(None)).distinct())).scalars()
    for uid in uids:
        await notifications.notify(db, uid, kind, title, body, f"{tag}:{inc.id}:{inc.updated_at:%Y%m%d%H%M}", incident_id=str(inc.id))


# --------------------------------------------------------------------------- authority actions


class ModerateIn(BaseModel):
    action: Literal["verify", "dismiss", "reopen"]
    note: str | None = Field(default=None, max_length=500)
    severity: int | None = Field(default=None, ge=1, le=4)
    category: str | None = None


@router.post("/{incident_id}/moderate")
async def moderate(
    incident_id: uuid.UUID,
    body: ModerateIn,
    request: Request,
    user: User = Depends(require("incident.moderate")),
    db: AsyncSession = Depends(get_db),
):
    inc = await _get(db, incident_id)
    if body.category and body.category in CATEGORY_BY_SLUG and body.category != inc.category:
        await svc.add_event(db, inc, "recategorized", actor_id=user.id, before=inc.category, after=body.category)
        inc.category, inc.domain = body.category, category_domain(body.category)
    if body.severity and body.severity != inc.severity:
        await svc.add_event(db, inc, "severity_changed", actor_id=user.id, before=inc.severity, after=body.severity)
        inc.severity = body.severity
    if body.action == "verify":
        if inc.status in TERMINAL:
            raise Conflict("Resolved incidents cannot be verified; reopen first.")
        if inc.status in ("reported", "ai_classified"):
            await svc.add_event(db, inc, "moderator_verified", to_status="verified", actor_id=user.id, note=body.note)
        await svc.recompute_risk(db, inc)
        if inc.status == "verified":
            await svc.add_event(db, inc, "prioritized", to_status="prioritized", priority=inc.priority, risk=inc.risk_score)
            await _notify_reporters(db, inc, "report_verified", "Your report was verified", f"{inc.title} was verified and prioritised {inc.priority}.", "verified")
            for uid in (await db.execute(select(Report.user_id).where(Report.incident_id == inc.id).distinct())).scalars():
                await notifications.award(db, uid, "report_verified", str(inc.id))
    elif body.action == "dismiss":
        await svc.add_event(db, inc, "dismissed", to_status="dismissed", actor_id=user.id, note=body.note)
        await svc.recompute_risk(db, inc)
    elif body.action == "reopen":
        inc.resolved_at = None
        await svc.add_event(db, inc, "reopened", to_status="verified", actor_id=user.id, note=body.note)
        await svc.recompute_risk(db, inc)
        await svc.add_event(db, inc, "prioritized", to_status="prioritized", priority=inc.priority, risk=inc.risk_score)
    audit(db, f"incident.{body.action}", actor_id=user.id, target_type="incident", target_id=inc.id, ip=client_ip(request), note=body.note)
    await db.commit()
    await svc.broadcast(db, inc, "incident.updated")
    await enqueue("refresh_area", location_id=inc.location_id)
    return {"status": inc.status, "priority": inc.priority, "risk_score": inc.risk_score}


class AssignIn(BaseModel):
    team: str = Field(min_length=2, max_length=80)
    assignee_id: uuid.UUID | None = None
    note: str | None = Field(default=None, max_length=500)
    due_at: datetime | None = None


@router.post("/{incident_id}/assign")
async def assign(
    incident_id: uuid.UUID, body: AssignIn, request: Request, user: User = Depends(require("incident.assign")), db: AsyncSession = Depends(get_db)
):
    inc = await _get(db, incident_id)
    if inc.status in TERMINAL:
        raise Conflict("This incident is already closed.")
    if body.assignee_id and await db.get(User, body.assignee_id) is None:
        raise NotFound("Assignee not found.")
    await db.execute(text("UPDATE assignments SET active=false WHERE incident_id=:i"), {"i": inc.id})
    db.add(Assignment(incident_id=inc.id, assignee_id=body.assignee_id, team=body.team, assigned_by=user.id, note=body.note, due_at=body.due_at))
    inc.assignee_id, inc.assigned_team = body.assignee_id, body.team
    if inc.status in ("reported", "ai_classified", "verified"):
        await svc.add_event(db, inc, "moderator_verified", to_status="verified", actor_id=user.id, note="Verified on assignment")
        await svc.add_event(db, inc, "prioritized", to_status="prioritized", priority=inc.priority, risk=inc.risk_score)
    await svc.add_event(db, inc, "assigned", to_status="assigned", actor_id=user.id, note=body.note, team=body.team)
    audit(db, "incident.assign", actor_id=user.id, target_type="incident", target_id=inc.id, ip=client_ip(request), team=body.team)
    await db.commit()
    await svc.broadcast(db, inc, "incident.updated")
    return {"status": inc.status, "assigned_team": inc.assigned_team}


class StartIn(BaseModel):
    note: str | None = Field(default=None, max_length=500)


@router.post("/{incident_id}/start")
async def start_action(
    incident_id: uuid.UUID, body: StartIn, request: Request, user: User = Depends(require("incident.resolve")), db: AsyncSession = Depends(get_db)
):
    inc = await _get(db, incident_id)
    if inc.status in TERMINAL:
        raise Conflict("This incident is already closed.")
    await svc.add_event(db, inc, "action_started", to_status="action_started", actor_id=user.id, note=body.note)
    db.add(ResolutionUpdate(incident_id=inc.id, author_id=user.id, status="action_started", note=body.note))
    audit(db, "incident.start", actor_id=user.id, target_type="incident", target_id=inc.id, ip=client_ip(request))
    await db.commit()
    await svc.broadcast(db, inc, "incident.updated")
    return {"status": inc.status}


@router.post("/{incident_id}/resolve")
async def resolve(
    incident_id: uuid.UUID,
    request: Request,
    note: str = Form(..., min_length=3, max_length=1000),
    photo: UploadFile | None = File(None),
    user: User = Depends(require("incident.resolve")),
    db: AsyncSession = Depends(get_db),
):
    inc = await _get(db, incident_id)
    if inc.status in TERMINAL:
        raise Conflict("This incident is already closed.")
    media_id = None
    if photo is not None:
        raw = await photo.read(settings.max_upload_mb * 1024 * 1024 + 1)
        if raw:
            stored = await storage.store_image(raw, f"resolutions/{datetime.now(UTC):%Y/%m}")
            m = Media(
                incident_id=inc.id, purpose="after", storage_key=stored.key, thumb_key=stored.thumb_key, content_type="image/jpeg",
                width=stored.width, height=stored.height, size_bytes=stored.size_bytes, image_hash=stored.image_hash, uploaded_by=user.id,
            )
            db.add(m)
            await db.flush()
            media_id = m.id
    inc.resolved_at = datetime.now(UTC)
    db.add(ResolutionUpdate(incident_id=inc.id, author_id=user.id, status="resolved", note=note, media_id=media_id))
    await svc.add_event(db, inc, "resolved", to_status="resolved", actor_id=user.id, note=note, has_after_photo=media_id is not None)
    await db.execute(text("UPDATE assignments SET active=false WHERE incident_id=:i"), {"i": inc.id})
    await svc.recompute_risk(db, inc)
    audit(db, "incident.resolve", actor_id=user.id, target_type="incident", target_id=inc.id, ip=client_ip(request))
    await db.flush()
    await _notify_reporters(
        db, inc, "report_resolved", "Your reported issue was resolved",
        f"{inc.title} was marked resolved. Is it fixed? Confirm on the ground to help.", "resolved",
    )
    await db.commit()
    await svc.broadcast(db, inc, "incident.resolved")
    await enqueue("refresh_area", location_id=inc.location_id)
    return {"status": inc.status, "resolved_at": inc.resolved_at}
