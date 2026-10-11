"""OpenStreetMap (Overpass API) geospatial provider: green areas, sensitive sites, waste points.

Data © OpenStreetMap contributors, available under the ODbL.
"""

import asyncio
import hashlib
import json
import time
from pathlib import Path

import httpx
from shapely.geometry import MultiPolygon, Polygon
from shapely.validation import make_valid

from app.core.config import settings
from app.providers.base import USER_AGENT, registry

GEO = registry.get("geospatial", kind="geospatial", source="OpenStreetMap via Overpass")

GREEN_QUERY = """
[out:json][timeout:90];
(
  way["leisure"~"^(park|garden|nature_reserve)$"]({bbox});
  way["landuse"~"^(forest|grass|recreation_ground|meadow|village_green)$"]({bbox});
  way["natural"~"^(wood|scrub|wetland)$"]({bbox});
);
out geom;
"""

POI_QUERY = """
[out:json][timeout:90];
(
  nwr["amenity"~"^(school|hospital|clinic|kindergarten|nursing_home)$"]({bbox});
  node["amenity"~"^(waste_basket|recycling|waste_disposal|waste_transfer_station)$"]({bbox});
);
out center;
"""


MIRRORS = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


CACHE_DIR = Path(settings.media_dir).parent / "data" / "osm_cache"
CACHE_TTL_S = 30 * 86400


async def _query(q: str) -> dict | None:
    """Overpass is frequently overloaded (429/504): serve from a 30-day disk cache when
    possible, otherwise retry with backoff across public mirrors."""
    cache = CACHE_DIR / f"{hashlib.sha1(q.encode()).hexdigest()}.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < CACHE_TTL_S:
        return json.loads(cache.read_text(encoding="utf-8"))
    endpoints = [settings.overpass_url, *[m for m in MIRRORS if m != settings.overpass_url]]
    last_error = "no endpoint tried"
    async with httpx.AsyncClient(timeout=120.0, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}) as client:
        for attempt, url in enumerate(endpoints * 2):
            try:
                r = await client.post(url, data={"data": q})
                r.raise_for_status()
                data = r.json()
                CACHE_DIR.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(data), encoding="utf-8")
                return data
            except Exception as exc:
                last_error = f"{type(exc).__name__} from {url.split('/')[2]}: {str(exc)[:120]}"
                await asyncio.sleep(min(2 * (attempt + 1), 8))
    GEO.fail(last_error)
    return None


def _bbox(b: tuple[float, float, float, float]) -> str:
    w, s, e, n = b
    return f"{s},{w},{n},{e}"


async def fetch_green(bbox: tuple[float, float, float, float]) -> list[dict] | None:
    data = await _query(GREEN_QUERY.replace("{bbox}", _bbox(bbox)))
    if data is None:
        return None
    out = []
    for el in data.get("elements", []):
        geom = el.get("geometry")
        if not geom or len(geom) < 4 or (geom[0]["lat"], geom[0]["lon"]) != (geom[-1]["lat"], geom[-1]["lon"]):
            continue
        poly = make_valid(Polygon([(p["lon"], p["lat"]) for p in geom]))
        if poly.is_empty:
            continue
        if poly.geom_type == "Polygon":
            poly = MultiPolygon([poly])
        elif poly.geom_type != "MultiPolygon":
            polys = [g for g in getattr(poly, "geoms", []) if g.geom_type == "Polygon"]
            if not polys:
                continue
            poly = MultiPolygon(polys)
        tags = el.get("tags", {})
        kind = tags.get("leisure") or tags.get("landuse") or tags.get("natural") or "green"
        out.append({"ref": f"osm:way:{el['id']}", "name": tags.get("name"), "kind": kind, "wkt": poly.wkt})
    GEO.ok(len(out))
    return out


async def fetch_pois(bbox: tuple[float, float, float, float]) -> tuple[list[dict], list[dict]] | None:
    data = await _query(POI_QUERY.replace("{bbox}", _bbox(bbox)))
    if data is None:
        return None
    sites, waste = [], []
    for el in data.get("elements", []):
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        tags = el.get("tags", {})
        amenity = tags.get("amenity")
        row = {"ref": f"osm:{el['type']}:{el['id']}", "name": tags.get("name"), "lon": lon, "lat": lat}
        if amenity in ("school", "hospital", "clinic", "kindergarten"):
            sites.append({**row, "kind": amenity})
        elif amenity == "nursing_home":
            sites.append({**row, "kind": "care_home"})
        else:
            waste.append({**row, "kind": amenity})
    GEO.ok(len(sites) + len(waste))
    return sites, waste
