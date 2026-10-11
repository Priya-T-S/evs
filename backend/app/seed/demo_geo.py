"""Demo geography for Bengaluru.

Neighbourhood names and approximate centres are real; **boundaries are synthetic**
(Voronoi cells of the centres, clipped to a buffered city hull) and population figures
are rough demo estimates. Fallback green zones / sites / waste points are only used when
OpenStreetMap is unreachable and are flagged ``is_demo``.
"""

import math

from shapely.geometry import Point

# name, lat, lon, population (demo estimate), sensitivity (1 = average)
NEIGHBORHOODS = [
    ("Koramangala", 12.9352, 77.6245, 185_000, 1.0),
    ("HSR Layout", 12.9116, 77.6474, 160_000, 1.0),
    ("Indiranagar", 12.9719, 77.6412, 140_000, 1.0),
    ("Domlur", 12.9610, 77.6387, 70_000, 1.0),
    ("Whitefield", 12.9698, 77.7500, 210_000, 1.1),
    ("Marathahalli", 12.9569, 77.7011, 190_000, 1.0),
    ("Bellandur", 12.9304, 77.6784, 150_000, 1.2),
    ("Sarjapur Road", 12.9100, 77.6870, 130_000, 1.0),
    ("BTM Layout", 12.9166, 77.6101, 175_000, 1.0),
    ("Jayanagar", 12.9250, 77.5938, 165_000, 1.0),
    ("JP Nagar", 12.9063, 77.5857, 180_000, 1.0),
    ("Bannerghatta Road", 12.8880, 77.5970, 140_000, 1.0),
    ("Banashankari", 12.9255, 77.5468, 170_000, 1.0),
    ("Basavanagudi", 12.9422, 77.5738, 110_000, 1.1),
    ("Majestic", 12.9767, 77.5713, 90_000, 1.0),
    ("Shivajinagar", 12.9857, 77.6057, 120_000, 1.1),
    ("Malleshwaram", 13.0035, 77.5709, 125_000, 1.0),
    ("Rajajinagar", 12.9910, 77.5520, 150_000, 1.0),
    ("Vijayanagar", 12.9719, 77.5300, 160_000, 1.0),
    ("Yeshwanthpur", 13.0280, 77.5400, 140_000, 1.0),
    ("Hebbal", 13.0358, 77.5970, 120_000, 1.2),
    ("Hennur", 13.0358, 77.6400, 115_000, 1.0),
    ("KR Puram", 13.0076, 77.6950, 175_000, 1.1),
    ("Mahadevapura", 12.9916, 77.7068, 130_000, 1.0),
    ("Electronic City", 12.8452, 77.6602, 150_000, 1.0),
    ("Yelahanka", 13.1007, 77.5963, 160_000, 1.0),
    ("Kengeri", 12.9081, 77.4826, 120_000, 1.0),
]

CITY_BBOX = (77.45, 12.82, 77.79, 13.13)  # west, south, east, north


def _circle_wkt(lat: float, lon: float, radius_m: float, n: int = 24) -> str:
    dlat = radius_m / 111_320
    dlon = radius_m / (111_320 * math.cos(math.radians(lat)))
    pts = [(lon + dlon * math.cos(2 * math.pi * k / n), lat + dlat * math.sin(2 * math.pi * k / n)) for k in range(n)]
    pts.append(pts[0])
    return "MULTIPOLYGON(((" + ", ".join(f"{x} {y}" for x, y in pts) + ")))"


DEMO_GREEN = [
    ("Cubbon Park", 12.9763, 77.5929, 650),
    ("Lalbagh Botanical Garden", 12.9507, 77.5848, 600),
    ("Agara Lake Park", 12.9230, 77.6440, 300),
    ("Jayanagar 4th Block Park", 12.9290, 77.5830, 180),
    ("Sankey Tank Park", 13.0090, 77.5730, 260),
    ("Hebbal Lake Park", 13.0450, 77.5900, 350),
    ("Kaikondrahalli Lake Park", 12.9130, 77.6730, 280),
    ("Whitefield Forest Patch", 12.9800, 77.7380, 300),
    ("Banashankari Park", 12.9200, 77.5550, 200),
    ("Yelahanka Puttenahalli Lake", 13.1000, 77.5850, 300),
    ("Indiranagar Defence Colony Park", 12.9760, 77.6380, 150),
]


def green_zones() -> list[dict]:
    return [
        {"ref": f"demo:green:{i}", "name": n, "kind": "park", "wkt": _circle_wkt(lat, lon, r)}
        for i, (n, lat, lon, r) in enumerate(DEMO_GREEN)
    ]


def sensitive_sites() -> list[dict]:
    sites = []
    for i, (name, lat, lon, *_rest) in enumerate(NEIGHBORHOODS):
        sites.append({"ref": f"demo:school:{i}", "name": f"{name} Public School (demo)", "kind": "school", "lat": lat + 0.004, "lon": lon - 0.003})
        if i % 2 == 0:
            sites.append({"ref": f"demo:hospital:{i}", "name": f"{name} General Hospital (demo)", "kind": "hospital", "lat": lat - 0.003, "lon": lon + 0.004})
    return sites


def waste_points() -> list[dict]:
    pts = []
    for i, (_name, lat, lon, *_rest) in enumerate(NEIGHBORHOODS):
        for k in range(2):
            ang = (i * 37 + k * 140) % 360
            p = Point(lon + 0.008 * math.cos(math.radians(ang)), lat + 0.008 * math.sin(math.radians(ang)))
            pts.append({"ref": f"demo:waste:{i}:{k}", "name": None, "kind": "recycling" if k else "waste_disposal", "lat": p.y, "lon": p.x})
    return pts
