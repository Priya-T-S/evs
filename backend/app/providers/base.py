"""External data provider abstraction.

    EnvironmentalDataProvider
        ├── AQIProvider          (Open-Meteo Air Quality  → demo fallback)
        ├── WeatherProvider      (Open-Meteo Forecast     → demo fallback)
        ├── ElevationProvider    (Open-Meteo Elevation    → demo fallback)
        ├── GeospatialProvider   (OpenStreetMap Overpass  → demo fallback)
        └── SatelliteProvider    (not configured: requires imagery credentials)

Each provider reports its health in ``registry``. A failing provider never breaks the
platform: callers receive ``None`` and fall back to demo data, which is always labelled.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime

USER_AGENT = "EcoPulse/1.0 (open environmental intelligence platform)"


@dataclass
class ProviderStatus:
    name: str
    kind: str
    source: str
    requires_key: bool = False
    configured: bool = True
    last_success: datetime | None = None
    last_error: str | None = None
    last_error_at: datetime | None = None
    using_demo: bool = False
    notes: str | None = None
    records: int = 0

    def ok(self, records: int) -> None:
        self.last_success = datetime.now(UTC)
        self.records = records
        self.using_demo = False

    def fail(self, err: str) -> None:
        self.last_error = err[:300]
        self.last_error_at = datetime.now(UTC)
        self.using_demo = True


@dataclass
class Registry:
    providers: dict[str, ProviderStatus] = field(default_factory=dict)

    def get(self, name: str, **defaults) -> ProviderStatus:
        if name not in self.providers:
            self.providers[name] = ProviderStatus(name=name, **defaults)
        return self.providers[name]


registry = Registry()
