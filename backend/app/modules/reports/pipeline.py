"""Report → incident pipeline (runs in the background worker).

    report received → AI classification → duplicate detection → merge or create incident
    → risk scoring → lifecycle transition → realtime events → notifications / points

Duplicate detection combines five signals into one score (weights are renormalised over
the signals that are actually available for a given pair):

| signal    | weight | value                                                            |
|-----------|--------|------------------------------------------------------------------|
| spatial   | 0.35   | 1 − distance / radius  (radius 60–250 m, depends on GPS accuracy) |
| category  | 0.25   | 1 same category · 0.6 same domain · 0 otherwise                  |
| temporal  | 0.15   | 1 − Δt / window  (window = category persistence, 2–14 days)      |
| image     | 0.15   | 1 − Hamming(dHash) / 32                                          |
| text      | 0.10   | token Jaccard + trigram cosine                                   |

A report merges into the best candidate when the score ≥ 0.62.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai import text as textlib
from app.ai.classifier import classify_report
from app.core.catalog import CATEGORY_BY_SLUG, TERMINAL, category_domain
from app.core.db import SessionLocal
from app.core.geo import haversine_m, point_xy
from app.core.storage import hash_distance
from app.models import Incident, Media, Report
from app.modules.incidents import service as incidents
from app.modules.notifications import service as notifications

log = logging.getLogger("ecopulse.pipeline")

MERGE_THRESHOLD = 0.62
W = {"spatial": 0.35, "category": 0.25, "temporal": 0.15, "image": 0.15, "text": 0.10}


def duplicate_score(
    *,
    distance_m: float,
    radius_m: float,
    same_category: bool,
    same_domain: bool,
    dt_hours: float,
    window_hours: float,
    image_distance: int | None,
    text_sim: float | None,
) -> tuple[float, dict]:
    signals = {
        "spatial": max(0.0, 1 - distance_m / radius_m),
        "category": 1.0 if same_category else (0.6 if same_domain else 0.0),
        "temporal": max(0.0, 1 - dt_hours / window_hours),
    }
    if image_distance is not None:
        signals["image"] = max(0.0, 1 - image_distance / 32)
    if text_sim is not None:
        signals["text"] = text_sim
    total_w = sum(W[k] for k in signals)
    score = sum(W[k] * v for k, v in signals.items()) / total_w
    return round(score, 3), {k: round(v, 3) for k, v in signals.items()}


async def find_duplicate(db: AsyncSession, report: Report, lon: float, lat: float) -> tuple[Incident | None, float, dict]:
    domain = category_domain(report.category)
    persistence = CATEGORY_BY_SLUG.get(report.category, CATEGORY_BY_SLUG["other"])[5]
    window_h = 24 * max(2, min(persistence, 14))
    radius = max(60.0, min(250.0, (report.accuracy_m or 30) * 2 + 80))
    if domain in ("air", "noise", "flood"):
        radius = min(400.0, radius * 1.6)  # diffuse phenomena are reported from further away

    ref_time = report.created_at or datetime.now(UTC)
    candidates = (
        await db.execute(
            select(Incident).where(
                Incident.domain == domain,
                Incident.status.notin_(list(TERMINAL)),
                Incident.last_reported_at >= ref_time - timedelta(hours=window_h),
                Incident.first_reported_at <= ref_time,
                func.ST_DWithin(
                    func.Geography(Incident.geom),
                    func.Geography(func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)),
                    radius,
                ),
            )
        )
    ).scalars().all()

    best: tuple[Incident | None, float, dict] = (None, 0.0, {})
    for inc in candidates:
        ilon, ilat = point_xy(inc.geom)
        image_hashes = (
            await db.execute(
                select(Report.image_hash, Report.description).where(Report.incident_id == inc.id).limit(25)
            )
        ).all()
        img_d = None
        if report.image_hash:
            ds = [d for d in (hash_distance(report.image_hash, h) for h, _ in image_hashes) if d is not None]
            img_d = min(ds) if ds else None
        txt = None
        if report.description:
            sims = [s for s in (textlib.similarity(report.description, d) for _, d in image_hashes) if s is not None]
            txt = max(sims) if sims else None
        score, signals = duplicate_score(
            distance_m=haversine_m(lat, lon, ilat, ilon),
            radius_m=radius,
            same_category=inc.category == report.category,
            same_domain=True,
            dt_hours=abs((ref_time - inc.last_reported_at).total_seconds()) / 3600,
            window_hours=window_h,
            image_distance=img_d,
            text_sim=txt,
        )
        if score > best[1]:
            best = (inc, score, signals)
    if best[0] is not None and best[1] >= MERGE_THRESHOLD:
        return best
    return None, best[1], best[2]


async def _update_aggregate(db: AsyncSession, inc: Incident) -> None:
    agg = (
        await db.execute(
            select(
                func.count(Report.id),
                func.count(func.distinct(Report.user_id)),
                func.ST_X(func.ST_Centroid(func.ST_Collect(Report.geom))),
                func.ST_Y(func.ST_Centroid(func.ST_Collect(Report.geom))),
                func.max(Report.created_at),
                func.min(Report.created_at),
                func.max(func.coalesce(Report.ai_severity, Report.severity_hint, 1)),
                func.avg(Report.ai_confidence),
                func.max(Report.noise_db),
            ).where(Report.incident_id == inc.id)
        )
    ).one()
    count, reporters, cx, cy, last, first, sev, conf, noise = agg
    inc.report_count = count
    # Anonymous/guest-less reports still count as independent observers.
    anon = await db.scalar(select(func.count(Report.id)).where(Report.incident_id == inc.id, Report.user_id.is_(None)))
    inc.reporter_count = reporters + (anon or 0)
    if cx is not None:
        incidents.set_location(inc, cx, cy)
    inc.last_reported_at = last or inc.last_reported_at
    inc.first_reported_at = min(first, inc.first_reported_at) if first and inc.first_reported_at else (first or inc.first_reported_at)
    inc.severity = max(inc.severity, int(sev or 1))
    if conf is not None:
        inc.ai_confidence = round(float(conf), 2)
    if noise is not None:
        inc.noise_db = float(noise)
    inc.confidence = incidents.confidence_from(inc)


async def process_report(report_id: str, *, emit: bool = True) -> dict:
    async with SessionLocal() as db:
        report = await db.get(Report, uuid.UUID(report_id))
        if report is None or report.status not in ("received", "queued"):
            return {"skipped": True}
        lon, lat = point_xy(report.geom)

        # 1. AI classification (image + text)
        media = (
            await db.execute(select(Media).where(Media.report_id == report.id, Media.purpose == "evidence").limit(1))
        ).scalar_one_or_none()
        jpeg = None
        if media is not None:
            jpeg = await _read_media(media.storage_key)
        result = await classify_report(report.category, report.description, jpeg)
        report.ai_category = result.category
        report.ai_label = result.label
        report.ai_confidence = result.confidence
        report.ai_severity = max(result.severity, report.severity_hint or 0) if report.severity_hint else result.severity
        report.ai_provider = result.provider
        report.ai_payload = result.as_dict()
        if report.category == "noise_pollution" and report.noise_db:
            # A measured level is stronger evidence than the photo/text heuristic.
            report.ai_severity = 4 if report.noise_db >= 85 else 3 if report.noise_db >= 75 else 2 if report.noise_db >= 65 else 1

        # 2. Duplicate detection
        loc = await incidents.location_for_point(db, lon, lat)
        report.location_id = loc.id if loc else None
        match, score, signals = await find_duplicate(db, report, lon, lat)
        report.duplicate_score = score
        report.duplicate_signals = signals

        if match is not None:
            inc = match
            report.incident_id = inc.id
            report.status = "merged"
            await db.flush()
            await _update_aggregate(db, inc)
            await incidents.add_event(
                db, inc, "report_merged", data_report=str(report.id), score=score, signals=signals
            )
            if inc.status == "ai_classified" and inc.reporter_count >= 3:
                await incidents.add_event(db, inc, "auto_verified", to_status="verified", note="Corroborated by 3+ independent reporters")
            event_type = "incident.updated"
            await notifications.award(db, report.user_id, "report_corroborated", str(inc.id))
        else:
            inc = Incident(
                id=uuid.uuid4(),
                ref=incidents.new_ref(),
                category=report.category,
                domain=category_domain(report.category),
                title=incidents.make_title(report.category, loc.name if loc else None),
                summary=report.description,
                status="reported",
                severity=report.ai_severity or CATEGORY_BY_SLUG.get(report.category, CATEGORY_BY_SLUG["other"])[3],
                location_id=loc.id if loc else None,
                first_reported_at=report.created_at,
                last_reported_at=report.created_at,
                ai_label=result.label,
                ai_confidence=result.confidence,
                noise_db=report.noise_db,
                is_demo=report.is_demo,
            )
            incidents.set_location(inc, lon, lat)
            db.add(inc)
            await db.flush()
            report.incident_id = inc.id
            report.status = "processed"
            await db.flush()
            await _update_aggregate(db, inc)
            await incidents.add_event(db, inc, "created", to_status="reported", data_report=str(report.id))
            await incidents.add_event(
                db,
                inc,
                "ai_classified",
                to_status="ai_classified",
                provider=result.provider,
                label=result.label,
                confidence=result.confidence,
                agrees_with_reporter=result.agrees_with_user,
            )
            event_type = "incident.created"

        await notifications.award(db, report.user_id, "report_submitted", str(report.id), "report")

        # 3. Risk + priority
        previous_priority = inc.priority
        await incidents.recompute_risk(db, inc)
        if inc.status == "verified":
            await incidents.add_event(db, inc, "prioritized", to_status="prioritized", priority=inc.priority, risk=inc.risk_score)
            for (uid,) in (await db.execute(select(Report.user_id).where(Report.incident_id == inc.id).distinct())).all():
                if uid:
                    await notifications.award(db, uid, "report_verified", str(inc.id))
                    await notifications.notify(
                        db, uid, "report_verified", "Your report was verified",
                        f"{inc.title} was corroborated by {inc.reporter_count} citizens and prioritised {inc.priority}.",
                        f"verified:{inc.id}", incident_id=str(inc.id),
                    )
        await db.commit()

        if report.user_id and match is not None:
            await notifications.notify(
                db, report.user_id, "report_merged", f"{inc.reporter_count} citizens reported this issue",
                f"Your report joined {inc.ref}: {inc.title}.", f"merged:{report.id}", incident_id=str(inc.id),
            )
        if event_type == "incident.created" and inc.severity >= 4:
            await notifications.notify_nearby(
                db, *point_xy(inc.public_geom), 1500, "critical_nearby", "Critical incident nearby",
                f"{inc.title}. Avoid the area if possible.", f"critical:{inc.id}",
                exclude={report.user_id}, incident_id=str(inc.id),
            )
        await db.commit()

        if emit:
            await incidents.broadcast(db, inc, event_type, priority_changed=previous_priority != inc.priority)
        from app.realtime.jobs import enqueue

        if emit:
            await enqueue("refresh_area", location_id=inc.location_id)
        return {"incident_id": str(inc.id), "merged": match is not None, "score": score}


async def _read_media(key: str) -> bytes | None:
    from app.core.storage import LocalStorage, storage

    try:
        if isinstance(storage, LocalStorage):
            return storage._path(key).read_bytes()
        obj = storage.client.get_object(Bucket=storage.bucket, Key=key)  # type: ignore[attr-defined]
        return obj["Body"].read()
    except Exception:  # pragma: no cover - storage dependent
        log.warning("could not read media %s for classification", key)
        return None
