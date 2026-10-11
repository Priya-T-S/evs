"""Open-Meteo providers (free, no API key): air quality, weather forecast, elevation."""

import asyncio
from datetime import UTC, datetime, timedelta

import httpx

from app.providers.base import USER_AGENT, registry

AQI = registry.get("aqi", kind="aqi", source="Open-Meteo Air Quality (CAMS)")
WEATHER = registry.get("weather", kind="weather", source="Open-Meteo Forecast")
ELEVATION = registry.get("elevation", kind="elevation", source="Open-Meteo Elevation (Copernicus DEM)")

_client_kwargs = {"timeout": 20.0, "headers": {"User-Agent": USER_AGENT}}


async def _get(client: httpx.AsyncClient, url: str, params: dict, attempts: int = 4) -> httpx.Response:
    """GET with polite retry: Open-Meteo's free tier answers bursts with 429."""
    delay = 2.0
    for attempt in range(attempts):
        r = await client.get(url, params=params)
        if r.status_code != 429 or attempt == attempts - 1:
            r.raise_for_status()
            return r
        retry_after = r.headers.get("retry-after")
        await asyncio.sleep(float(retry_after) if retry_after and retry_after.isdigit() else delay)
        delay *= 2
    raise RuntimeError("unreachable")


def _coords(points: list[tuple[float, float]]) -> dict[str, str]:
    return {
        "latitude": ",".join(f"{lat:.5f}" for _, lat in points),
        "longitude": ",".join(f"{lon:.5f}" for lon, _ in points),
    }


async def fetch_aqi(points: list[tuple[float, float]]) -> list[dict] | None:
    """points: [(lon, lat)] → list of {us_aqi, pm2_5, pm10, no2, o3, observed_at}"""
    try:
        async with httpx.AsyncClient(**_client_kwargs) as client:
            r = await _get(
                client,
                "https://air-quality-api.open-meteo.com/v1/air-quality",
                {**_coords(points), "current": "us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone", "timezone": "UTC"},
            )
            data = r.json()
    except Exception as exc:
        AQI.fail(f"{type(exc).__name__}: {exc}")
        return None
    data = data if isinstance(data, list) else [data]
    out = []
    for d in data:
        cur = d.get("current", {})
        out.append(
            {
                "us_aqi": cur.get("us_aqi"),
                "pm2_5": cur.get("pm2_5"),
                "pm10": cur.get("pm10"),
                "no2": cur.get("nitrogen_dioxide"),
                "o3": cur.get("ozone"),
                "observed_at": datetime.fromisoformat(cur["time"]).replace(tzinfo=UTC) if cur.get("time") else datetime.now(UTC),
            }
        )
    AQI.ok(len(out))
    return out


async def fetch_weather(points: list[tuple[float, float]]) -> list[dict] | None:
    try:
        async with httpx.AsyncClient(**_client_kwargs) as client:
            r = await _get(
                client,
                "https://api.open-meteo.com/v1/forecast",
                {
                    **_coords(points),
                    "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code",
                    "hourly": "precipitation,precipitation_probability",
                    "past_days": 1,
                    "forecast_days": 3,
                    "timezone": "UTC",
                },
            )
            data = r.json()
    except Exception as exc:
        WEATHER.fail(f"{type(exc).__name__}: {exc}")
        return None
    data = data if isinstance(data, list) else [data]
    now = datetime.now(UTC)
    out = []
    for d in data:
        cur = d.get("current", {})
        hourly = d.get("hourly", {})
        past, nxt, max_prob = 0.0, 0.0, 0
        for t, p, prob in zip(hourly.get("time", []), hourly.get("precipitation", []), hourly.get("precipitation_probability", [])):
            ts = datetime.fromisoformat(t).replace(tzinfo=UTC)
            if now - timedelta(hours=24) <= ts <= now:
                past += p or 0
            elif now < ts <= now + timedelta(hours=48):
                nxt += p or 0
                max_prob = max(max_prob, prob or 0)
        out.append(
            {
                "temperature_c": cur.get("temperature_2m"),
                "humidity_pct": cur.get("relative_humidity_2m"),
                "precip_now_mm": cur.get("precipitation"),
                "wind_kmh": cur.get("wind_speed_10m"),
                "weather_code": cur.get("weather_code"),
                "precip_past_24h_mm": round(past, 1),
                "precip_next_48h_mm": round(nxt, 1),
                "precip_max_probability_48h": max_prob,
                "observed_at": datetime.fromisoformat(cur["time"]).replace(tzinfo=UTC) if cur.get("time") else now,
            }
        )
    WEATHER.ok(len(out))
    return out


async def fetch_elevation(points: list[tuple[float, float]]) -> list[float] | None:
    result: list[float] = []
    try:
        async with httpx.AsyncClient(**_client_kwargs) as client:
            for i in range(0, len(points), 100):
                chunk = points[i : i + 100]
                r = await _get(client, "https://api.open-meteo.com/v1/elevation", _coords(chunk))
                result.extend(r.json()["elevation"])
                await asyncio.sleep(1.2)  # stay well under the free-tier burst limit
    except Exception as exc:
        ELEVATION.fail(f"{type(exc).__name__}: {exc}")
        return None
    ELEVATION.ok(len(result))
    return result
