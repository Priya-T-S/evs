"""Community clean-up drives: citizens organise and join clean-ups at reported problems.

A drive is public by design (the organiser picks the meeting point), so it carries an exact
point. Drives created from an incident use the incident's snapped public point, never the
reporter's exact coordinate. Completing a drive records what was collected, awards EcoPoints
to the volunteers and adds a note to the linked incident's timeline for staff.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.audit import audit
from app.core.db import get_db
from app.core.deps import client_ip, current_user, optional_user
from app.core.errors import AppError, Conflict, Forbidden, NotFound
from app.core.geo import haversine_m, point_xy, wkt_point
from app.core.security import has_permission
from app.models import CleanupDrive, DriveParticipant, Hotspot, Incident, Report, User
from app.modules.incidents import service as incidents
from app.modules.notifications import service as notifications

router = APIRouter(prefix="/drives", tags=["drives"])

NEARBY_NOTIFY_M = 1500


def _can_manage(d: CleanupDrive, user: User | None) -> bool:
    return bool(user and (d.organizer_id == user.id or has_permission(user.role, "incident.moderate")))


async def _serialize_many(db: AsyncSession, drives: list[CleanupDrive], user: User | None, near: tuple[float, float] | None = None) -> list[dict]:
    if not drives:
        return []
    ids = [d.id for d in drives]
    counts = dict(
        (await db.execute(select(DriveParticipant.drive_id, func.count()).where(DriveParticipant.drive_id.in_(ids)).group_by(DriveParticipant.drive_id))).all()
    )
    joined = set()
    if user:
        joined = set((await db.execute(select(DriveParticipant.drive_id).where(DriveParticipant.drive_id.in_(ids), DriveParticipant.user_id == user.id))).scalars())
    names = await incidents.location_names(db, {d.location_id for d in drives})
    organizers = dict((await db.execute(select(User.id, User.display_name).where(User.id.in_({d.organizer_id for d in drives if d.organizer_id})))).all())
    incs = {i.id: i for i in (await db.execute(select(Incident).where(Incident.id.in_({d.incident_id for d in drives if d.incident_id})))).scalars()}
    hss = dict((await db.execute(select(Hotspot.id, Hotspot.name).where(Hotspot.id.in_({d.hotspot_id for d in drives if d.hotspot_id})))).all())
    out = []
    for d in drives:
        lon, lat = point_xy(d.geom)
        n = counts.get(d.id, 0)
        inc = incs.get(d.incident_id)
        row = {
            "id": str(d.id),
            "title": d.title,
            "description": d.description,
            "starts_at": d.starts_at,
            "ends_at": d.starts_at + timedelta(minutes=d.duration_min),
            "duration_min": d.duration_min,
            "lon": lon,
            "lat": lat,
            "location_id": d.location_id,
            "location_name": names.get(d.location_id),
            "incident": {"id": str(inc.id), "ref": inc.ref, "title": inc.title, "category": inc.category, "status": inc.status} if inc else None,
            "hotspot": {"id": str(d.hotspot_id), "name": hss[d.hotspot_id]} if d.hotspot_id in hss else None,
            "organizer": organizers.get(d.organizer_id),
            "is_organizer": bool(user and d.organizer_id == user.id),
            "joined": d.id in joined,
            "volunteers": n,
            "max_volunteers": d.max_volunteers,
            "spots_left": max(0, d.max_volunteers - n) if d.max_volunteers else None,
            "status": d.status,
            "bags_collected": d.bags_collected,
            "attended": d.attended,
            "outcome_note": d.outcome_note,
            "completed_at": d.completed_at,
            "created_at": d.created_at,
            "can_manage": _can_manage(d, user),
            "is_demo": d.is_demo,
        }
        if near:
            row["distance_m"] = round(haversine_m(near[0], near[1], lat, lon), -1)
        out.append(row)
    return out


@router.get("")
async def list_drives(
    when: Literal["upcoming", "past", "all"] = "upcoming",
    incident_id: uuid.UUID | None = None,
    hotspot_id: uuid.UUID | None = None,
    location_id: int | None = None,
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    radius_m: int = Query(5000, ge=100, le=50_000),
    mine: bool = False,
    limit: int = Query(20, ge=1, le=100),
    user: User | None = Depends(optional_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(UTC)
    ends = CleanupDrive.starts_at + func.make_interval(0, 0, 0, 0, 0, CleanupDrive.duration_min)
    stmt = select(CleanupDrive)
    if when == "upcoming":
        stmt = stmt.where(CleanupDrive.status == "scheduled", ends >= now).order_by(CleanupDrive.starts_at)
    elif when == "past":
        stmt = stmt.where((CleanupDrive.status != "scheduled") | (ends < now)).order_by(CleanupDrive.starts_at.desc())
    else:
        stmt = stmt.order_by(CleanupDrive.starts_at.desc())
    if incident_id:
        stmt = stmt.where(CleanupDrive.incident_id == incident_id)
    if hotspot_id:
        # Drives at the hotspot itself or at any of its incidents.
        stmt = stmt.where(
            (CleanupDrive.hotspot_id == hotspot_id)
            | CleanupDrive.incident_id.in_(select(Incident.id).where(Incident.hotspot_id == hotspot_id))
        )
    if location_id:
        stmt = stmt.where(CleanupDrive.location_id == location_id)
    near = None
    if lat is not None and lon is not None:
        near = (lat, lon)
        stmt = stmt.where(func.ST_DWithin(func.Geography(CleanupDrive.geom), func.Geography(func.ST_GeomFromEWKT(wkt_point(lon, lat))), radius_m))
    if mine:
        if user is None:
            return {"items": []}
        stmt = stmt.where(
            (CleanupDrive.organizer_id == user.id)
            | CleanupDrive.id.in_(select(DriveParticipant.drive_id).where(DriveParticipant.user_id == user.id))
        )
    rows = (await db.execute(stmt.limit(limit))).scalars().all()
    return {"items": await _serialize_many(db, rows, user, near)}


async def _get(db: AsyncSession, drive_id: uuid.UUID) -> CleanupDrive:
    d = await db.get(CleanupDrive, drive_id)
    if d is None:
        raise NotFound("Clean-up drive not found.")
    return d


@router.get("/{drive_id}")
async def get_drive(drive_id: uuid.UUID, user: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)):
    return (await _serialize_many(db, [await _get(db, drive_id)], user))[0]


class DriveIn(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    starts_at: datetime
    duration_min: int = Field(default=120, ge=30, le=480)
    max_volunteers: int | None = Field(default=None, ge=2, le=500)
    incident_id: uuid.UUID | None = None
    hotspot_id: uuid.UUID | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode="after")
    def _place(self):
        if not (self.incident_id or self.hotspot_id or (self.lat is not None and self.lon is not None)):
            raise ValueError("Choose a place: an incident, a hotspot, or lat/lon.")
        if self.starts_at.tzinfo is None:
            raise ValueError("starts_at must include a time zone.")
        return self


@router.post("", status_code=201)
async def create_drive(body: DriveIn, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if user.is_guest:
        raise Forbidden("Create a free account to organise a clean-up drive, so volunteers know who is hosting.", code="account_required")
    await ratelimit.enforce(f"drive:{user.id}", 5, 86400)
    now = datetime.now(UTC)
    if not (now - timedelta(minutes=5) <= body.starts_at <= now + timedelta(days=90)):
        raise AppError("Pick a start time between now and 90 days from now.", code="validation_error", status_code=422)

    inc = hs = None
    if body.incident_id:
        inc = await db.get(Incident, body.incident_id)
        if inc is None:
            raise NotFound("Incident not found.")
        lon, lat = point_xy(inc.public_geom)
    elif body.hotspot_id:
        hs = await db.get(Hotspot, body.hotspot_id)
        if hs is None:
            raise NotFound("Hotspot not found.")
        lon, lat = point_xy(hs.centroid)
    else:
        lon, lat = body.lon, body.lat
    loc = await incidents.location_for_point(db, lon, lat)

    d = CleanupDrive(
        title=body.title.strip(),
        description=(body.description or "").strip() or None,
        starts_at=body.starts_at,
        duration_min=body.duration_min,
        geom=wkt_point(lon, lat),
        location_id=loc.id if loc else None,
        incident_id=inc.id if inc else None,
        hotspot_id=hs.id if hs else (inc.hotspot_id if inc else None),
        organizer_id=user.id,
        max_volunteers=body.max_volunteers,
    )
    db.add(d)
    await db.flush()
    db.add(DriveParticipant(drive_id=d.id, user_id=user.id))
    if inc:
        await incidents.add_event(db, inc, "cleanup_scheduled", actor_id=user.id, note=d.title, drive_id=str(d.id), starts_at=d.starts_at.isoformat())
    audit(db, "drive.create", actor_id=user.id, target_type="drive", target_id=d.id, ip=client_ip(request))

    when = d.starts_at.strftime("%a %d %b")  # date only: notification text cannot know the reader's time zone
    await notifications.notify_nearby(
        db, lon, lat, NEARBY_NOTIFY_M, "drive_nearby", "Clean-up drive near you",
        f"{d.title} · {when}. Join to help.", f"drive:{d.id}", exclude={user.id}, drive_id=str(d.id),
    )
    if inc:
        uids = (await db.execute(select(Report.user_id).where(Report.incident_id == inc.id, Report.user_id.isnot(None)).distinct())).scalars()
        for uid in uids:
            if uid != user.id:
                await notifications.notify(
                    db, uid, "drive_update", "Clean-up drive for your report",
                    f"Volunteers are organising a clean-up of {inc.title} on {when}.", f"drive:{d.id}", drive_id=str(d.id), incident_id=str(inc.id),
                )
    await db.commit()
    return (await _serialize_many(db, [d], user))[0]


@router.post("/{drive_id}/join")
async def join(drive_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await ratelimit.enforce(f"drive-join:{user.id}", 60, 3600)
    d = await _get(db, drive_id)
    if d.status != "scheduled" or d.starts_at + timedelta(minutes=d.duration_min) < datetime.now(UTC):
        raise Conflict("This drive is no longer taking volunteers.")
    if await db.get(DriveParticipant, (d.id, user.id)) is None:
        # Lock the drive row so two last-minute joins cannot both take the final spot.
        await db.execute(select(CleanupDrive.id).where(CleanupDrive.id == d.id).with_for_update())
        n = await db.scalar(select(func.count()).where(DriveParticipant.drive_id == d.id))
        if d.max_volunteers and n >= d.max_volunteers:
            raise Conflict("This drive is full.", code="drive_full")
        await db.execute(insert(DriveParticipant).values(drive_id=d.id, user_id=user.id).on_conflict_do_nothing())
        await db.commit()
    return (await _serialize_many(db, [d], user))[0]


@router.delete("/{drive_id}/join")
async def leave(drive_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    d = await _get(db, drive_id)
    if d.organizer_id == user.id:
        raise Conflict("You are organising this drive. Cancel it instead.")
    if d.status != "scheduled":
        raise Conflict("This drive has already finished.")
    p = await db.get(DriveParticipant, (d.id, user.id))
    if p is not None:
        await db.delete(p)
        await db.commit()
    return (await _serialize_many(db, [d], user))[0]


class CompleteIn(BaseModel):
    bags_collected: int = Field(ge=0, le=10_000)
    attended: int | None = Field(default=None, ge=1, le=1000)
    note: str | None = Field(default=None, max_length=1000)


async def _participants(db: AsyncSession, d: CleanupDrive) -> list[uuid.UUID]:
    return list((await db.execute(select(DriveParticipant.user_id).where(DriveParticipant.drive_id == d.id))).scalars())


@router.post("/{drive_id}/complete")
async def complete(drive_id: uuid.UUID, body: CompleteIn, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    d = await _get(db, drive_id)
    if not _can_manage(d, user):
        raise Forbidden("Only the organiser or city staff can record the result.")
    if d.status != "scheduled":
        raise Conflict("This drive is already closed.")
    if d.starts_at > datetime.now(UTC):
        raise Conflict("The drive hasn't started yet.")
    d.status, d.bags_collected, d.attended = "completed", body.bags_collected, body.attended
    d.outcome_note = (body.note or "").strip() or None
    d.completed_at = datetime.now(UTC)
    people = await _participants(db, d)
    for uid in people:
        await notifications.award(db, uid, "drive_completed", str(d.id), ref_type="drive")
        if uid != user.id:
            await notifications.notify(
                db, uid, "drive_update", "Clean-up done — thank you!",
                f"{d.title}: {body.bags_collected} bags collected. EcoPoints added.", f"drive-done:{d.id}", drive_id=str(d.id),
            )
    if d.organizer_id:
        await notifications.award(db, d.organizer_id, "drive_organized", str(d.id), ref_type="drive")
    if d.incident_id and (inc := await db.get(Incident, d.incident_id)):
        await incidents.add_event(
            db, inc, "cleanup_completed", actor_id=user.id, note=d.outcome_note,
            drive_id=str(d.id), bags=body.bags_collected, volunteers=body.attended or len(people),
        )
    audit(db, "drive.complete", actor_id=user.id, target_type="drive", target_id=d.id, ip=client_ip(request), bags=body.bags_collected)
    await db.commit()
    return (await _serialize_many(db, [d], user))[0]


class CancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


@router.post("/{drive_id}/cancel")
async def cancel(drive_id: uuid.UUID, body: CancelIn, request: Request, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    d = await _get(db, drive_id)
    if not _can_manage(d, user):
        raise Forbidden("Only the organiser or city staff can cancel this drive.")
    if d.status != "scheduled":
        raise Conflict("This drive is already closed.")
    d.status, d.outcome_note = "cancelled", (body.reason or "").strip() or None
    for uid in await _participants(db, d):
        if uid != user.id:
            await notifications.notify(
                db, uid, "drive_update", "Clean-up drive cancelled",
                f"{d.title} on {d.starts_at:%d %b} was cancelled." + (f" {d.outcome_note}" if d.outcome_note else ""),
                f"drive-cancel:{d.id}", drive_id=str(d.id),
            )
    if d.incident_id and (inc := await db.get(Incident, d.incident_id)):
        await incidents.add_event(db, inc, "cleanup_cancelled", actor_id=user.id, note=d.outcome_note, drive_id=str(d.id))
    audit(db, "drive.cancel", actor_id=user.id, target_type="drive", target_id=d.id, ip=client_ip(request))
    await db.commit()
    return (await _serialize_many(db, [d], user))[0]


@router.get("/stats/summary")
async def stats(days: int = Query(30, ge=7, le=365), db: AsyncSession = Depends(get_db)):
    """Public totals for completed drives (impact measurement)."""
    row = (
        await db.execute(
            text(
                """SELECT count(*) FILTER (WHERE status = 'completed') completed,
                          coalesce(sum(bags_collected) FILTER (WHERE status = 'completed'), 0) bags,
                          coalesce(sum(coalesce(attended, (SELECT count(*) FROM drive_participants p WHERE p.drive_id = d.id)))
                                   FILTER (WHERE status = 'completed'), 0) volunteers,
                          count(*) FILTER (WHERE status = 'scheduled' AND starts_at >= now()) upcoming
                   FROM cleanup_drives d
                   WHERE starts_at >= now() - make_interval(days => :days)"""
            ),
            {"days": days},
        )
    ).one()
    return {"period_days": days, "completed": row.completed, "bags_collected": row.bags, "volunteers": row.volunteers, "upcoming": row.upcoming}
