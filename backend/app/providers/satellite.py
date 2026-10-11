"""Satellite imagery provider.

Vegetation indices (NDVI) and land-surface temperature need an imagery service account
(e.g. Sentinel Hub / Copernicus Data Space). Until credentials are configured this
provider reports itself as not configured and the green-cover model relies on mapped
green areas only. Nothing is fabricated in its place.
"""

from app.providers.base import registry

SATELLITE = registry.get(
    "satellite",
    kind="satellite",
    source="Copernicus Sentinel-2 (NDVI)",
    requires_key=True,
    configured=False,
    notes="Not configured. Green cover uses OpenStreetMap green areas instead.",
)


async def fetch_ndvi(*_args, **_kwargs) -> None:
    return None
