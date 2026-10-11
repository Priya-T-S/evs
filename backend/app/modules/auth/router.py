import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit
from app.core.audit import audit
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import client_ip, current_user, optional_user
from app.core.errors import Conflict, Unauthorized
from app.core.geo import point_xy, wkt_point
from app.core.security import (
    create_access_token,
    has_permission,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    verify_password,
)
from app.models import PointsLedger, RefreshToken, Report, User

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=60)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class MeUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=60)
    home_lat: float | None = Field(default=None, ge=-90, le=90)
    home_lon: float | None = Field(default=None, ge=-180, le=180)
    clear_home: bool = False
    notification_prefs: dict[str, bool] | None = None
    push_token: str | None = Field(default=None, max_length=512)


def level_for(points: int) -> dict:
    tiers = [(0, "Observer"), (50, "Contributor"), (150, "Steward"), (400, "Guardian"), (1000, "Custodian")]
    current = [t for t in tiers if points >= t[0]][-1]
    nxt = next((t for t in tiers if t[0] > points), None)
    return {"name": current[1], "next": nxt[1] if nxt else None, "next_at": nxt[0] if nxt else None}


def user_out(u: User) -> dict:
    home = point_xy(u.home_location)
    return {
        "id": str(u.id),
        "email": u.email,
        "display_name": u.display_name,
        "role": u.role,
        "is_guest": u.is_guest,
        "eco_points": u.eco_points,
        "level": level_for(u.eco_points),
        "team": u.team,
        "home": {"lon": home[0], "lat": home[1]} if home else None,
        "notification_prefs": {"my_reports": True, "area": True, "rewards": True, **(u.notification_prefs or {})},
        "permissions": [
            p
            for p in (
                "incident.view_exact",
                "incident.moderate",
                "incident.assign",
                "incident.resolve",
                "analytics.view",
                "recommendation.manage",
                "users.manage",
                "audit.view",
                "jobs.run",
            )
            if has_permission(u.role, p)
        ],
        "created_at": u.created_at,
    }


async def issue_tokens(db: AsyncSession, user: User) -> dict:
    raw, hashed = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id, token_hash=hashed, expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_days)
        )
    )
    await db.commit()
    return {
        "access_token": create_access_token(user.id, user.role),
        "refresh_token": raw,
        "token_type": "bearer",
        "expires_in": settings.access_token_minutes * 60,
        "user": user_out(user),
    }


@router.post("/register", status_code=201)
async def register(
    body: RegisterIn, request: Request, current: User | None = Depends(optional_user), db: AsyncSession = Depends(get_db)
):
    """Create an account. Called with a guest's token, it upgrades that guest in place so
    reports, EcoPoints and history carry over."""
    await ratelimit.enforce(f"auth:{client_ip(request)}", settings.rate_limit_auth_per_minute, 60)
    exists = await db.scalar(select(User.id).where(func.lower(User.email) == body.email.lower()))
    if exists:
        raise Conflict("An account with this email already exists.", code="email_taken")
    if current is not None and current.is_guest:
        user = current
        user.email, user.password_hash = body.email.lower(), hash_password(body.password)
        user.display_name, user.is_guest = body.display_name, False
        await db.execute(update(RefreshToken).where(RefreshToken.user_id == user.id).values(revoked_at=datetime.now(UTC)))
        audit(db, "auth.guest_upgraded", actor_id=user.id, ip=client_ip(request))
    else:
        user = User(email=body.email.lower(), password_hash=hash_password(body.password), display_name=body.display_name)
        db.add(user)
        await db.flush()
        audit(db, "auth.register", actor_id=user.id, ip=client_ip(request))
    return await issue_tokens(db, user)


@router.post("/login")
async def login(body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    await ratelimit.enforce(f"auth:{client_ip(request)}", settings.rate_limit_auth_per_minute, 60)
    user = (await db.execute(select(User).where(func.lower(User.email) == body.email.lower()))).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash) or not user.is_active:
        audit(db, "auth.login_failed", actor_id=None, ip=client_ip(request), email=body.email.lower())
        await db.commit()
        raise Unauthorized("Email or password is incorrect.", code="invalid_credentials")
    audit(db, "auth.login", actor_id=user.id, ip=client_ip(request))
    return await issue_tokens(db, user)


@router.post("/guest", status_code=201)
async def guest(request: Request, db: AsyncSession = Depends(get_db)):
    """Instant, account-less participation. Guests can later upgrade by registering."""
    await ratelimit.enforce(f"guest:{client_ip(request)}", 10, 3600)
    user = User(display_name=f"Citizen {secrets.token_hex(2).upper()}", is_guest=True)
    db.add(user)
    await db.flush()
    audit(db, "auth.guest", actor_id=user.id, ip=client_ip(request))
    return await issue_tokens(db, user)


@router.post("/refresh")
async def refresh(body: RefreshIn, request: Request, db: AsyncSession = Depends(get_db)):
    await ratelimit.enforce(f"refresh:{client_ip(request)}", 60, 60)
    token = (
        await db.execute(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(body.refresh_token)))
    ).scalar_one_or_none()
    if token is None:
        raise Unauthorized("Session expired. Please sign in again.", code="refresh_invalid")
    if token.revoked_at is not None:
        # Reuse of a rotated token signals theft: revoke the whole family for this user.
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == token.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=datetime.now(UTC))
        )
        audit(db, "auth.refresh_reuse", actor_id=token.user_id, ip=client_ip(request))
        await db.commit()
        raise Unauthorized("Session expired. Please sign in again.", code="refresh_invalid")
    if token.expires_at < datetime.now(UTC):
        raise Unauthorized("Session expired. Please sign in again.", code="refresh_invalid")
    user = await db.get(User, token.user_id)
    if user is None or not user.is_active:
        raise Unauthorized("Account disabled.")
    token.revoked_at = datetime.now(UTC)
    return await issue_tokens(db, user)


@router.post("/logout", status_code=204)
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)):
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(body.refresh_token))
        .values(revoked_at=datetime.now(UTC))
    )
    await db.commit()


@router.get("/me")
async def me(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    out = user_out(user)
    out["stats"] = {
        "reports": await db.scalar(select(func.count(Report.id)).where(Report.user_id == user.id)) or 0,
        "verified_reports": await db.scalar(
            select(func.count(PointsLedger.id)).where(PointsLedger.user_id == user.id, PointsLedger.reason == "report_verified")
        )
        or 0,
        "verifications": await db.scalar(
            select(func.count(PointsLedger.id)).where(
                PointsLedger.user_id == user.id, PointsLedger.reason.in_(["verification", "resolution_confirmed"])
            )
        )
        or 0,
    }
    return out


@router.patch("/me")
async def update_me(body: MeUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.clear_home:
        user.home_location = None
    elif body.home_lat is not None and body.home_lon is not None:
        user.home_location = wkt_point(body.home_lon, body.home_lat)
    if body.notification_prefs is not None:
        allowed = {"my_reports", "area", "rewards"}
        user.notification_prefs = {
            **(user.notification_prefs or {}),
            **{k: v for k, v in body.notification_prefs.items() if k in allowed},
        }
    if body.push_token is not None:
        user.push_token = body.push_token or None
    await db.commit()
    await db.refresh(user)
    return user_out(user)


@router.get("/me/points")
async def my_points(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(PointsLedger).where(PointsLedger.user_id == user.id).order_by(PointsLedger.created_at.desc()).limit(50)
        )
    ).scalars()
    return {
        "total": user.eco_points,
        "level": level_for(user.eco_points),
        "history": [
            {"delta": r.delta, "reason": r.reason, "ref_type": r.ref_type, "ref_id": r.ref_id, "created_at": r.created_at}
            for r in rows
        ],
    }

