"""Contextual notifications with anti-spam guarantees.

* ``dedupe_key`` makes each logical notification unique per user (DB constraint).
* Users can mute categories of notification via ``notification_prefs``.
* Area-wide alerts are capped per user per day.
* Delivery: stored in-app, pushed over the WebSocket user channel, and handed to the
  optional push provider (FCM) when configured.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, PointsLedger, User
from app.realtime import bus

log = logging.getLogger("ecopulse.notify")

KINDS = {
    "report_verified": "my_reports",
    "report_resolved": "my_reports",
    "report_merged": "my_reports",
    "incident_reopened": "my_reports",
    "risk_increased": "area",
    "critical_nearby": "area",
    "flood_risk": "area",
    "drive_nearby": "area",
    "drive_update": "my_reports",
    "points_awarded": "rewards",
}
AREA_DAILY_CAP = 3


async def notify(
    db: AsyncSession, user_id: uuid.UUID, kind: str, title: str, body: str, dedupe_key: str, **data
) -> bool:
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return False
    group = KINDS.get(kind, "other")
    if user.notification_prefs.get(group) is False:
        return False
    if group == "area":
        sent_today = await db.scalar(
            select(func.count(Notification.id)).where(
                Notification.user_id == user_id,
                Notification.kind.in_([k for k, g in KINDS.items() if g == "area"]),
                Notification.created_at >= datetime.now(UTC) - timedelta(days=1),
            )
        )
        if (sent_today or 0) >= AREA_DAILY_CAP:
            return False
    stmt = (
        insert(Notification)
        .values(user_id=user_id, kind=kind, title=title, body=body, data=data, dedupe_key=dedupe_key)
        .on_conflict_do_nothing(constraint="uq_notification_dedupe")
        .returning(Notification.id, Notification.created_at)
    )
    row = (await db.execute(stmt)).first()
    if row is None:
        return False
    await bus.emit(
        "notification.created",
        {"id": row[0], "kind": kind, "title": title, "body": body, "data": data, "created_at": row[1]},
        user_ids=[str(user_id)],
    )
    return True


async def notify_nearby(
    db: AsyncSession, lon: float, lat: float, radius_m: int, kind: str, title: str, body: str, dedupe_key: str, exclude=None, **data
) -> int:
    rows = await db.execute(
        text(
            """SELECT id FROM users WHERE is_active AND home_location IS NOT NULL
               AND ST_DWithin(home_location::geography, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography, :r)
               LIMIT 500"""
        ),
        {"lon": lon, "lat": lat, "r": radius_m},
    )
    sent = 0
    for (uid,) in rows:
        if exclude and uid in exclude:
            continue
        sent += await notify(db, uid, kind, title, body, dedupe_key, **data)
    return sent


async def notify_residents(
    db: AsyncSession, location_id: int, kind: str, title: str, body: str, dedupe_key: str, **data
) -> int:
    """Notify users whose home location lies inside a neighbourhood (area alerts are capped daily)."""
    rows = await db.execute(
        text(
            """SELECT u.id FROM users u JOIN locations l ON l.id = :loc
               WHERE u.is_active AND u.home_location IS NOT NULL AND ST_Contains(l.geom, u.home_location) LIMIT 2000"""
        ),
        {"loc": location_id},
    )
    sent = 0
    for (uid,) in rows:
        sent += await notify(db, uid, kind, title, body, dedupe_key, **data)
    return sent


# --------------------------------------------------------------------------- EcoPoints

POINTS = {
    "report_submitted": 5,
    "report_corroborated": 3,  # your report matched an existing incident (useful confirmation)
    "report_verified": 10,  # an incident you reported was verified
    "verification": 2,  # you confirmed / refuted an incident's status
    "resolution_confirmed": 5,  # you confirmed a fix on the ground
    "drive_completed": 15,  # you volunteered at a completed clean-up drive
    "drive_organized": 10,  # you organised a clean-up drive that took place
}


async def award(db: AsyncSession, user_id: uuid.UUID | None, reason: str, ref_id: str, ref_type: str = "incident") -> int:
    if user_id is None or reason not in POINTS:
        return 0
    delta = POINTS[reason]
    stmt = (
        insert(PointsLedger)
        .values(user_id=user_id, delta=delta, reason=reason, ref_type=ref_type, ref_id=ref_id)
        .on_conflict_do_nothing(constraint="uq_points_once")
        .returning(PointsLedger.id)
    )
    if (await db.execute(stmt)).first() is None:
        return 0
    user = await db.get(User, user_id)
    if user:
        user.eco_points += delta
    return delta
