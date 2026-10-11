import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import audit
from app.core.db import get_db
from app.core.deps import client_ip, require
from app.core.errors import Forbidden, NotFound
from app.models import AuditLog, User
from app.modules.auth.router import user_out
from app.realtime.jobs import enqueue

router = APIRouter(tags=["admin"])


@router.get("/users/assignable")
async def assignable(_: User = Depends(require("incident.assign")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User).where(User.role.in_(["officer", "admin"]), User.is_active))).scalars()
    teams = sorted({u.team for u in (await db.execute(select(User).where(User.team.isnot(None)))).scalars()})
    return {"users": [{"id": str(u.id), "display_name": u.display_name, "team": u.team} for u in rows], "teams": teams}


@router.get("/users")
async def list_users(
    role: str | None = None,
    q: str | None = Query(None, max_length=60),
    limit: int = Query(50, ge=1, le=200),
    _: User = Depends(require("users.manage")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(User).order_by(User.created_at.desc()).limit(limit)
    if role:
        stmt = stmt.where(User.role == role)
    if q:
        stmt = stmt.where(func.lower(User.display_name).contains(q.lower()) | func.lower(User.email).contains(q.lower()))
    return {"items": [user_out(u) for u in (await db.execute(stmt)).scalars()]}


class UserPatch(BaseModel):
    role: Literal["citizen", "moderator", "analyst", "officer", "admin"] | None = None
    is_active: bool | None = None
    team: str | None = None


@router.patch("/users/{user_id}")
async def patch_user(
    user_id: uuid.UUID, body: UserPatch, request: Request,
    admin: User = Depends(require("users.manage")), db: AsyncSession = Depends(get_db),
):
    u = await db.get(User, user_id)
    if u is None:
        raise NotFound("User not found.")
    if u.id == admin.id and (body.role not in (None, "admin") or body.is_active is False):
        raise Forbidden("You cannot remove your own admin access.")
    changes = body.model_dump(exclude_none=True)
    for k, v in changes.items():
        setattr(u, k, v)
    audit(db, "user.update", actor_id=admin.id, target_type="user", target_id=u.id, ip=client_ip(request), **changes)
    await db.commit()
    return user_out(u)


@router.get("/audit-logs")
async def audit_logs(
    action: str | None = None, limit: int = Query(100, ge=1, le=500),
    _: User = Depends(require("audit.view")), db: AsyncSession = Depends(get_db),
):
    stmt = select(AuditLog, User.display_name).outerjoin(User, User.id == AuditLog.actor_id).order_by(AuditLog.created_at.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action))
    return {
        "items": [
            {"id": a.id, "action": a.action, "actor": name, "target_type": a.target_type, "target_id": a.target_id, "ip": a.ip, "data": a.data, "created_at": a.created_at}
            for a, name in (await db.execute(stmt)).all()
        ]
    }


@router.post("/admin/jobs/{name}", status_code=202)
async def run_job(
    name: Literal["regenerate", "refresh_external"], request: Request,
    user: User = Depends(require("jobs.run")), db: AsyncSession = Depends(get_db),
):
    await enqueue(name)
    audit(db, f"job.{name}", actor_id=user.id, ip=client_ip(request))
    await db.commit()
    return {"queued": name}
