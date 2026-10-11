from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.providers import service as external

router = APIRouter(prefix="/external-data", tags=["external-data"])


@router.get("/status")
async def status(db: AsyncSession = Depends(get_db)):
    """Health and provenance of every external data provider."""
    demo = (
        await db.execute(
            text(
                """SELECT
                     (SELECT avg(CASE WHEN is_demo THEN 1.0 ELSE 0 END) FROM incidents) incidents,
                     (SELECT bool_and(is_demo) FROM locations) boundaries,
                     (SELECT bool_and(is_demo) FROM green_zones) green,
                     (SELECT bool_and(is_demo) FROM sensitive_sites) sites"""
            )
        )
    ).one()
    return {
        "providers": await external.status(db),
        "synthetic": {
            "incident_share": round(float(demo.incidents or 0), 2),
            "neighbourhood_boundaries": bool(demo.boundaries),
            "green_zones": bool(demo.green),
            "sensitive_sites": bool(demo.sites),
            "population": "demo estimates",
        },
    }


@router.get("/location/{location_id}")
async def for_location(location_id: int, db: AsyncSession = Depends(get_db)):
    return await external.latest_for_location(db, location_id)
