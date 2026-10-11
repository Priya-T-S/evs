"""Small geospatial helpers shared across modules."""

import math

import h3
from geoalchemy2.shape import to_shape
from shapely import wkt as shapely_wkt
from shapely.geometry import Point

GRID_RES = 8  # analytic grid (~0.74 km² cells)
FINE_RES = 10  # duplicate-detection neighbourhoods (~0.015 km² cells)
EARTH_R = 6_371_008.8


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def cell(lat: float, lon: float, res: int = GRID_RES) -> str:
    return h3.latlng_to_cell(lat, lon, res)


def wkt_point(lon: float, lat: float) -> str:
    return f"SRID=4326;POINT({lon} {lat})"


def snap_public(lat: float, lon: float, precision_m: int) -> tuple[float, float]:
    """Deterministically snap to a grid so public positions never reveal the exact spot.

    The same exact location always maps to the same public location, so repeated
    queries cannot be averaged to recover the true coordinate.
    """
    dlat = precision_m / 111_320
    lat_c = (math.floor(lat / dlat) + 0.5) * dlat
    # Column width comes from the row's centre latitude, so every point in a cell shares one grid.
    dlon = precision_m / (111_320 * max(math.cos(math.radians(lat_c)), 0.01))
    return lat_c, (math.floor(lon / dlon) + 0.5) * dlon


def point_xy(geom) -> tuple[float, float] | None:
    """Return (lon, lat) for a GeoAlchemy element, an (E)WKT string, or None."""
    if geom is None:
        return None
    if isinstance(geom, str):
        shp: Point = shapely_wkt.loads(geom.split(";", 1)[-1])
    else:
        shp = to_shape(geom)
    return shp.x, shp.y


def bbox_valid(bbox: list[float]) -> bool:
    if len(bbox) != 4:
        return False
    w, s, e, n = bbox
    return -180 <= w < e <= 180 and -90 <= s < n <= 90
