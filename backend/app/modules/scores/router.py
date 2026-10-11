from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.errors import NotFound
from app.intelligence.scores import grade, score_out
from app.models import EnvironmentalScore, Location
from app.modules.incidents.service import location_for_point
from app.providers.service import latest_for_location

router = APIRouter(prefix="/environmental-score", tags=["environmental-score"])


async def _current(db: AsyncSession, location_id: int) -> EnvironmentalScore | None:
    return (
        await db.execute(
            select(EnvironmentalScore).where(EnvironmentalScore.location_id == location_id, EnvironmentalScore.is_current)
        )
    ).scalar_one_or_none()


async def _city_rank(db: AsyncSession, overall: float) -> dict:
    total = await db.scalar(select(func.count()).select_from(EnvironmentalScore).where(EnvironmentalScore.is_current))
    better = await db.scalar(
        select(func.count()).select_from(EnvironmentalScore).where(EnvironmentalScore.is_current, EnvironmentalScore.overall > overall)
    )
    return {"rank": (better or 0) + 1, "of": total or 0}


async def _full(db: AsyncSession, loc: Location) -> dict:
    current = await _current(db, loc.id)
    prev = (
        await db.execute(
            select(EnvironmentalScore)
            .where(EnvironmentalScore.location_id == loc.id, EnvironmentalScore.computed_at <= func.now() - text("interval '7 days'"))
            .order_by(EnvironmentalScore.computed_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    out = {
        "location": {"id": loc.id, "name": loc.name, "population": loc.population, "boundary_is_demo": loc.is_demo},
        "score": score_out(current),
        "change_7d": round(current.overall - prev.overall, 1) if current and prev else None,
        "external": await latest_for_location(db, loc.id),
    }
    if current:
        out["city_rank"] = await _city_rank(db, current.overall)
    return out


@router.get("")
async def score_for(
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
    location_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    if location_id is not None:
        loc = await db.get(Location, location_id)
    elif lat is not None and lon is not None:
        loc = await location_for_point(db, lon, lat)
    else:
        loc = None
    if loc is None:
        raise NotFound("No EcoPulse coverage at this location yet.", code="no_coverage")
    return await _full(db, loc)


@router.get("/locations")
async def all_locations(db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Location, EnvironmentalScore)
            .outerjoin(EnvironmentalScore, (EnvironmentalScore.location_id == Location.id) & EnvironmentalScore.is_current)
            .order_by(EnvironmentalScore.overall.asc().nullslast())
        )
    ).all()
    return {
        "items": [
            {
                "id": loc.id,
                "name": loc.name,
                "population": loc.population,
                "overall": s.overall if s else None,
                "grade": grade(s.overall) if s else None,
                "dimensions": score_out(s)["dimensions"] if s else None,
                "weakest": (s.explanation or {}).get("weakest") if s else None,
            }
            for loc, s in rows
        ]
    }


@router.get("/{location_id}/history")
async def history(location_id: int, days: int = Query(90, ge=7, le=365), db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(EnvironmentalScore)
            .where(EnvironmentalScore.location_id == location_id, EnvironmentalScore.computed_at >= func.now() - text(f"interval '{days} days'"))
            .order_by(EnvironmentalScore.computed_at)
        )
    ).scalars()
    return {
        "items": [
            {"at": s.computed_at, "overall": s.overall, **{k: getattr(s, k) for k in ("air", "water", "waste", "noise", "green", "clean")}}
            for s in rows
        ]
    }
