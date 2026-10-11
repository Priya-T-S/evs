import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, File, Form, Query, Request, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.classifier import classify_report
from app.core import ratelimit
from app.core.audit import audit
from app.core.catalog import CATEGORY_BY_SLUG, category_label
from app.core.config import settings
from app.core.db import get_db
from app.core.deps import client_ip, current_user
from app.core.errors import AppError, Forbidden, NotFound
from app.core.geo import cell, point_xy, wkt_point
from app.core.security import has_permission
from app.core.storage import process_image, storage
from app.models import Incident, Media, Report, User
from app.realtime import bus
from app.realtime.jobs import enqueue

router = APIRouter(tags=["reports"])

MAX_DESCRIPTION = 1000


def _validate_category(category: str) -> None:
    if category not in CATEGORY_BY_SLUG:
        raise AppError("Unknown category.", code="validation_error", status_code=422, details=[{"field": "category"}])


async def _read_upload(photo: UploadFile | None) -> bytes | None:
    if photo is None:
        return None
    raw = await photo.read(settings.max_upload_mb * 1024 * 1024 + 1)
    return raw or None


async def report_out(db: AsyncSession, r: Report, *, exact: bool) -> dict:
    lon, lat = point_xy(r.geom)
    media = (await db.execute(select(Media).where(Media.report_id == r.id))).scalars().all()
    inc = await db.get(Incident, r.incident_id) if r.incident_id else None
    return {
        "id": str(r.id),
        "client_id": r.client_id,
        "category": r.category,
        "category_label": category_label(r.category),
        "description": r.description,
        "status": r.status,
        "lon": lon if exact else None,
        "lat": lat if exact else None,
        "is_anonymous": r.is_anonymous,
        "noise_db": r.noise_db,
        "created_at": r.created_at,
        "ai": (
            {
                "label": r.ai_label,
                "category": r.ai_category,
                "confidence": r.ai_confidence,
                "severity": r.ai_severity,
                "provider": r.ai_provider,
                "rationale": (r.ai_payload or {}).get("rationale"),
                "subtype": (r.ai_payload or {}).get("subtype"),
                "agrees_with_reporter": (r.ai_payload or {}).get("agrees_with_user"),
            }
            if r.ai_provider
            else None
        ),
        "duplicate": {"score": r.duplicate_score, "signals": r.duplicate_signals} if r.duplicate_score is not None else None,
        "incident": (
            {
                "id": str(inc.id),
                "ref": inc.ref,
                "title": inc.title,
                "status": inc.status,
                "reporter_count": inc.reporter_count,
                "priority": inc.priority,
            }
            if inc
            else None
        ),
        "media": [{"id": str(m.id), "url": storage.url(m.storage_key), "thumb_url": storage.url(m.thumb_key)} for m in media],
        "is_demo": r.is_demo,
    }


@router.post("/reports", status_code=202)
async def create_report(
    request: Request,
    response: Response,
    category: str = Form(...),
    lat: float = Form(..., ge=-90, le=90),
    lon: float = Form(..., ge=-180, le=180),
    accuracy_m: float | None = Form(None, ge=0, le=5000),
    description: str | None = Form(None, max_length=MAX_DESCRIPTION),
    is_anonymous: bool = Form(False),
    client_id: str | None = Form(None, max_length=64),
    captured_at: datetime | None = Form(None),
    noise_db: float | None = Form(None, ge=20, le=140),
    severity_hint: int | None = Form(None, ge=1, le=4),
    photo: UploadFile | None = File(None),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    _validate_category(category)
    uid = user.id  # captured: a rollback below expires ORM objects
    if client_id:
        existing = (
            await db.execute(select(Report).where(Report.user_id == uid, Report.client_id == client_id))
        ).scalar_one_or_none()
        if existing is not None:
            # Offline queue retry: the report already arrived. Return it unchanged.
            response.status_code = 200
            return await report_out(db, existing, exact=True)

    await ratelimit.enforce(f"reports:{user.id}", settings.rate_limit_reports_per_hour, 3600)
    raw = await _read_upload(photo)
    if raw is None and category not in ("noise_pollution", "air_pollution", "flooding", "waterlogging", "other"):
        raise AppError("A photo is required for this category.", code="photo_required", status_code=422)

    report = Report(
        id=uuid.uuid4(),
        user_id=user.id,
        client_id=client_id,
        category=category,
        description=(description or "").strip() or None,
        geom=wkt_point(lon, lat),
        accuracy_m=accuracy_m,
        h3=cell(lat, lon),
        is_anonymous=is_anonymous,
        noise_db=noise_db,
        severity_hint=severity_hint,
        captured_at=captured_at or datetime.now(UTC),
        status="received",
    )
    db.add(report)
    try:
        await db.flush()  # the report row must exist before its media rows reference it
    except IntegrityError:
        # Concurrent offline retry with the same client_id won the race: return that report.
        await db.rollback()
        if not client_id:
            raise
        existing = (
            await db.execute(select(Report).where(Report.user_id == uid, Report.client_id == client_id))
        ).scalar_one()
        response.status_code = 200
        return await report_out(db, existing, exact=True)
    if raw is not None:
        stored = await storage.store_image(raw, f"reports/{datetime.now(UTC):%Y/%m}")
        report.image_hash = stored.image_hash
        db.add(
            Media(
                report_id=report.id,
                purpose="evidence",
                storage_key=stored.key,
                thumb_key=stored.thumb_key,
                content_type="image/jpeg",
                width=stored.width,
                height=stored.height,
                size_bytes=stored.size_bytes,
                image_hash=stored.image_hash,
                uploaded_by=user.id,
            )
        )
    audit(db, "report.create", actor_id=user.id, target_type="report", target_id=report.id, ip=client_ip(request))
    await db.commit()

    await enqueue("process_report", report_id=str(report.id))
    await bus.emit("report.received", {"category": category}, lon=round(lon, 2), lat=round(lat, 2))
    return await report_out(db, report, exact=True)


@router.post("/ai/classify")
async def classify_preview(
    category: str = Form(...),
    description: str | None = Form(None, max_length=MAX_DESCRIPTION),
    photo: UploadFile | None = File(None),
    user: User = Depends(current_user),
):
    """Classify a photo before submitting. Nothing is stored."""
    _validate_category(category)
    await ratelimit.enforce(f"classify:{user.id}", 40, 3600)
    raw = await _read_upload(photo)
    jpeg = None
    if raw:
        import asyncio

        jpeg, *_ = await asyncio.to_thread(process_image, raw)
    result = await classify_report(category, description, jpeg)
    return {
        "category": result.category,
        "category_label": category_label(result.category),
        "label": result.label,
        "subtype": result.subtype,
        "confidence": result.confidence,
        "severity": result.severity,
        "provider": result.provider,
        "rationale": result.rationale,
        "agrees_with_reporter": result.agrees_with_user,
    }


@router.get("/reports")
async def list_reports(
    mine: bool = True,
    limit: int = Query(30, ge=1, le=100),
    before: datetime | None = None,
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
):
    staff = has_permission(user.role, "incident.view_exact")
    stmt = select(Report).order_by(Report.created_at.desc()).limit(limit + 1)
    if mine or not staff:
        stmt = stmt.where(Report.user_id == user.id)
    if before:
        stmt = stmt.where(Report.created_at < before)
    rows = (await db.execute(stmt)).scalars().all()
    items = [await report_out(db, r, exact=True) for r in rows[:limit]]
    return {"items": items, "next_before": rows[limit - 1].created_at if len(rows) > limit else None}


@router.get("/reports/{report_id}")
async def get_report(report_id: uuid.UUID, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)):
    r = await db.get(Report, report_id)
    if r is None:
        raise NotFound("Report not found.")
    staff = has_permission(user.role, "incident.view_exact")
    if r.user_id != user.id and not staff:
        raise Forbidden("You can only view your own reports.")
    return await report_out(db, r, exact=True)
