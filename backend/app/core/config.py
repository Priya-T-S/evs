from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration. Every external integration is optional."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="ECOPULSE_", extra="ignore")

    env: str = "development"
    database_url: str = "postgresql+asyncpg://postgres@localhost:5432/ecopulse"
    redis_url: str | None = "redis://localhost:6379/0"

    jwt_secret: str = "dev-only-change-me-ecopulse-secret-key-0123456789"
    access_token_minutes: int = 30
    refresh_token_days: int = 30

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "capacitor://localhost",
        "http://localhost",
        "https://localhost",
    ]

    # Media storage: "local" (filesystem) or "s3" (any S3-compatible store such as MinIO)
    storage_backend: str = "local"
    media_dir: str = "./media"
    public_base_url: str = "http://localhost:8000"
    s3_endpoint_url: str | None = None
    s3_bucket: str = "ecopulse-media"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_region: str = "us-east-1"
    max_upload_mb: int = 12

    # AI. Without a key the platform uses the transparent local heuristic classifier.
    anthropic_api_key: str | None = None
    ai_model: str = "claude-opus-5-5"

    # External data. Open-Meteo and Overpass need no key; set to false to force demo providers.
    external_data_enabled: bool = True
    overpass_url: str = "https://overpass-api.de/api/interpreter"

    # City the demo dataset and external providers focus on.
    city_name: str = "Bengaluru"
    city_center_lat: float = 12.9716
    city_center_lon: float = 77.5946

    # Run the background worker inside the API process (convenient for development).
    embedded_worker: bool = True
    hotspot_interval_seconds: int = 300
    external_interval_seconds: int = 1800

    # Public coordinate precision: incidents are snapped to this grid (metres) for non-staff viewers.
    public_location_precision_m: int = 120

    rate_limit_reports_per_hour: int = 30
    rate_limit_auth_per_minute: int = 20


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.env == "production" and (s.jwt_secret.startswith("dev-only") or len(s.jwt_secret) < 32):
        raise RuntimeError("ECOPULSE_JWT_SECRET must be set to a random value of 32+ characters in production.")
    return s


settings = get_settings()
