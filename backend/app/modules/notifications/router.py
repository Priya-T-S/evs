from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.deps import current_user
from app.models import Notification, User

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    limit: int = Query(30, ge=1, le=100), user: User = Depends(current_user), db: AsyncSession = Depends(get_db)
):
    rows = (
        await db.execute(
            select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(limit)
        )
    ).scalars()
    unread = await db.scalar(
        select(func.count(Notification.id)).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    )
    return {
        "unread": unread or 0,
        "items": [
            {"id": n.id, "kind": n.kind, "title": n.title, "body": n.body, "data": n.data, "read": n.read_at is not None, "created_at": n.created_at}
            for n in rows
        ],
    }


@router.post("/read-all", status_code=204)
async def read_all(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None)).values(read_at=datetime.now(UTC))
    )
    await db.commit()


@router.post("/{notification_id}/read", status_code=204)
async def read_one(notification_id: int, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user.id)
        .values(read_at=datetime.now(UTC))
    )
    await db.commit()
