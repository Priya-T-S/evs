"""EcoPulse relational + spatial schema (PostgreSQL + PostGIS).

All geometries are stored in EPSG:4326. Distance queries cast to geography so that
radii are expressed in metres. Every table that can contain synthetic content carries
an ``is_demo`` flag so the UI can label it.
"""

import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


# --------------------------------------------------------------------------- identity


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    email: Mapped[str | None] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(20), default="citizen", index=True)
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    eco_points: Mapped[int] = mapped_column(Integer, default=0)
    team: Mapped[str | None] = mapped_column(String(80))
    home_location = mapped_column(Geometry("POINT", srid=4326, spatial_index=False), nullable=True)
    notification_prefs: Mapped[dict] = mapped_column(JSONB, default=dict)
    push_token: Mapped[str | None] = mapped_column(String(512))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class RefreshToken(TimestampMixin, Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(String(64))
    data: Mapped[dict] = mapped_column(JSONB, default=dict)


class PointsLedger(TimestampMixin, Base):
    __tablename__ = "points_ledger"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    delta: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(String(60))
    ref_type: Mapped[str | None] = mapped_column(String(30))
    ref_id: Mapped[str | None] = mapped_column(String(64))

    __table_args__ = (UniqueConstraint("user_id", "reason", "ref_id", name="uq_points_once"),)


# --------------------------------------------------------------------------- reference geography


class Category(Base):
    __tablename__ = "categories"

    slug: Mapped[str] = mapped_column(String(40), primary_key=True)
    label: Mapped[str] = mapped_column(String(60))
    domain: Mapped[str] = mapped_column(String(20), index=True)
    default_severity: Mapped[int] = mapped_column(SmallInteger, default=2)
    hazard_weight: Mapped[float] = mapped_column(Float, default=1.0)
    persistence_days: Mapped[int] = mapped_column(Integer, default=14)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Location(Base):
    """Administrative / neighbourhood polygons used for scoring and aggregation."""

    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(20), default="neighborhood")
    geom = mapped_column(Geometry("MULTIPOLYGON", srid=4326))
    centroid = mapped_column(Geometry("POINT", srid=4326))
    area_km2: Mapped[float] = mapped_column(Float, default=0)
    population: Mapped[int] = mapped_column(Integer, default=0)
    population_source: Mapped[str] = mapped_column(String(60), default="demo-estimate")
    sensitivity: Mapped[float] = mapped_column(Float, default=1.0)
    properties: Mapped[dict] = mapped_column(JSONB, default=dict)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True)


class GreenZone(Base):
    __tablename__ = "green_zones"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str | None] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(30))
    geom = mapped_column(Geometry("MULTIPOLYGON", srid=4326))
    area_m2: Mapped[float] = mapped_column(Float, default=0)
    source: Mapped[str] = mapped_column(String(40))
    source_ref: Mapped[str | None] = mapped_column(String(60), unique=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True)


class SensitiveSite(Base):
    """Schools, hospitals, elderly care — exposure multipliers for risk."""

    __tablename__ = "sensitive_sites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    name: Mapped[str | None] = mapped_column(String(160))
    geom = mapped_column(Geometry("POINT", srid=4326))
    source: Mapped[str] = mapped_column(String(40))
    source_ref: Mapped[str | None] = mapped_column(String(60), unique=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True)


class WastePoint(Base):
    __tablename__ = "waste_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(30))
    name: Mapped[str | None] = mapped_column(String(160))
    geom = mapped_column(Geometry("POINT", srid=4326))
    source: Mapped[str] = mapped_column(String(40))
    source_ref: Mapped[str | None] = mapped_column(String(60), unique=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=True)


class GridCell(Base):
    """H3 analytic grid (resolution 8, ~0.74 km²). Recomputed by the GIS worker."""

    __tablename__ = "grid_cells"

    h3: Mapped[str] = mapped_column(String(16), primary_key=True)
    geom = mapped_column(Geometry("POLYGON", srid=4326))
    centroid = mapped_column(Geometry("POINT", srid=4326))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), index=True)
    population: Mapped[int] = mapped_column(Integer, default=0)
    elevation_m: Mapped[float | None] = mapped_column(Float)
    green_fraction: Mapped[float] = mapped_column(Float, default=0)
    metrics: Mapped[dict] = mapped_column(JSONB, default=dict)
    risk: Mapped[float] = mapped_column(Float, default=0, index=True)
    flood_observed: Mapped[float] = mapped_column(Float, default=0)
    flood_predicted: Mapped[float] = mapped_column(Float, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# --------------------------------------------------------------------------- citizen observations


class Incident(TimestampMixin, Base):
    """An aggregated environmental problem, built from one or more citizen reports."""

    __tablename__ = "incidents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    ref: Mapped[str] = mapped_column(String(16), unique=True)
    category: Mapped[str] = mapped_column(ForeignKey("categories.slug"), index=True)
    domain: Mapped[str] = mapped_column(String(20), index=True)
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default="reported", index=True)
    severity: Mapped[int] = mapped_column(SmallInteger, default=2)
    priority: Mapped[str] = mapped_column(String(4), default="P3", index=True)
    risk_score: Mapped[float] = mapped_column(Float, default=0, index=True)
    risk_components: Mapped[dict] = mapped_column(JSONB, default=dict)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    geom = mapped_column(Geometry("POINT", srid=4326))
    public_geom = mapped_column(Geometry("POINT", srid=4326))
    h3: Mapped[str | None] = mapped_column(String(16), index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), index=True)
    hotspot_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("hotspots.id", ondelete="SET NULL"), index=True)
    report_count: Mapped[int] = mapped_column(Integer, default=0)
    reporter_count: Mapped[int] = mapped_column(Integer, default=0)
    verify_yes: Mapped[int] = mapped_column(Integer, default=0)
    verify_no: Mapped[int] = mapped_column(Integer, default=0)
    verify_unsure: Mapped[int] = mapped_column(Integer, default=0)
    ai_label: Mapped[str | None] = mapped_column(String(80))
    ai_confidence: Mapped[float | None] = mapped_column(Float)
    population_exposed: Mapped[int] = mapped_column(Integer, default=0)
    sensitive_nearby: Mapped[list] = mapped_column(JSONB, default=list)
    noise_db: Mapped[float | None] = mapped_column(Float)
    first_reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    assigned_team: Mapped[str | None] = mapped_column(String(80))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    reports: Mapped[list["Report"]] = relationship(back_populates="incident")

    __table_args__ = (
        Index("ix_incidents_open", "status", "risk_score"),
    )


class Report(TimestampMixin, Base):
    """A single citizen observation. Exact coordinates are never exposed publicly."""

    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    client_id: Mapped[str | None] = mapped_column(String(64))
    category: Mapped[str] = mapped_column(ForeignKey("categories.slug"), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    geom = mapped_column(Geometry("POINT", srid=4326))
    accuracy_m: Mapped[float | None] = mapped_column(Float)
    h3: Mapped[str | None] = mapped_column(String(16), index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), index=True)
    incident_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("incidents.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="received")
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=False)
    severity_hint: Mapped[int | None] = mapped_column(SmallInteger)
    noise_db: Mapped[float | None] = mapped_column(Float)
    image_hash: Mapped[str | None] = mapped_column(String(32))
    ai_label: Mapped[str | None] = mapped_column(String(80))
    ai_category: Mapped[str | None] = mapped_column(String(40))
    ai_confidence: Mapped[float | None] = mapped_column(Float)
    ai_severity: Mapped[int | None] = mapped_column(SmallInteger)
    ai_provider: Mapped[str | None] = mapped_column(String(40))
    ai_payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    duplicate_score: Mapped[float | None] = mapped_column(Float)
    duplicate_signals: Mapped[dict] = mapped_column(JSONB, default=dict)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)

    incident: Mapped[Incident | None] = relationship(back_populates="reports")

    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_reports_client_id"),
    )


class Media(TimestampMixin, Base):
    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    report_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("reports.id", ondelete="CASCADE"), index=True)
    incident_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(20), default="evidence")  # evidence | after
    storage_key: Mapped[str] = mapped_column(String(255))
    thumb_key: Mapped[str | None] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(40))
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    image_hash: Mapped[str | None] = mapped_column(String(32))
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Verification(TimestampMixin, Base):
    __tablename__ = "verifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    response: Mapped[str] = mapped_column(String(10))  # yes | no | unsure
    distance_m: Mapped[float | None] = mapped_column(Float)
    phase: Mapped[str] = mapped_column(String(12), default="active")  # active | resolution

    __table_args__ = (UniqueConstraint("incident_id", "user_id", "phase", name="uq_verification_once"),)


class IncidentEvent(TimestampMixin, Base):
    """Immutable timeline of everything that happened to an incident."""

    __tablename__ = "incident_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    from_status: Mapped[str | None] = mapped_column(String(24))
    to_status: Mapped[str | None] = mapped_column(String(24))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)


class Assignment(TimestampMixin, Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    team: Mapped[str | None] = mapped_column(String(80))
    assigned_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ResolutionUpdate(TimestampMixin, Base):
    __tablename__ = "resolution_updates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    incident_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("incidents.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(24))
    note: Mapped[str | None] = mapped_column(Text)
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))


# --------------------------------------------------------------------------- intelligence


class Hotspot(TimestampMixin, Base):
    __tablename__ = "hotspots"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    key: Mapped[str] = mapped_column(String(64), unique=True)  # stable identity across recomputes
    name: Mapped[str] = mapped_column(String(160))
    domain: Mapped[str] = mapped_column(String(20), index=True)
    primary_category: Mapped[str] = mapped_column(String(40))
    geom = mapped_column(Geometry("POLYGON", srid=4326))
    centroid = mapped_column(Geometry("POINT", srid=4326))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    h3_cells: Mapped[list[str]] = mapped_column(ARRAY(String(16)), default=list)
    risk_score: Mapped[float] = mapped_column(Float, default=0, index=True)
    risk_components: Mapped[dict] = mapped_column(JSONB, default=dict)
    report_count: Mapped[int] = mapped_column(Integer, default=0)
    incident_count: Mapped[int] = mapped_column(Integer, default=0)
    active_incidents: Mapped[int] = mapped_column(Integer, default=0)
    trend_pct: Mapped[float] = mapped_column(Float, default=0)
    category_mix: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    kind: Mapped[str] = mapped_column(String(16), default="observed")  # observed | predicted
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    method: Mapped[str] = mapped_column(String(40), default="dbscan-haversine")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EnvironmentalScore(Base):
    __tablename__ = "environmental_scores"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id", ondelete="CASCADE"), index=True)
    computed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    overall: Mapped[float] = mapped_column(Float)
    air: Mapped[float] = mapped_column(Float)
    water: Mapped[float] = mapped_column(Float)
    waste: Mapped[float] = mapped_column(Float)
    noise: Mapped[float] = mapped_column(Float)
    green: Mapped[float] = mapped_column(Float)
    clean: Mapped[float] = mapped_column(Float)
    explanation: Mapped[dict] = mapped_column(JSONB, default=dict)
    model_version: Mapped[str] = mapped_column(String(20), default="pulse-1")
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class Recommendation(TimestampMixin, Base):
    __tablename__ = "recommendations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    key: Mapped[str] = mapped_column(String(96), unique=True)  # idempotent regeneration
    kind: Mapped[str] = mapped_column(String(40), index=True)
    title: Mapped[str] = mapped_column(String(200))
    target_type: Mapped[str] = mapped_column(String(20))  # hotspot | location | incident | city
    target_id: Mapped[str | None] = mapped_column(String(64))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    geom = mapped_column(Geometry("GEOMETRY", srid=4326), nullable=True)
    observed: Mapped[dict] = mapped_column(JSONB, default=dict)
    inference: Mapped[dict] = mapped_column(JSONB, default=dict)
    actions: Mapped[list] = mapped_column(JSONB, default=list)
    expected_impact: Mapped[str] = mapped_column(String(12), default="medium")
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    priority_score: Mapped[float] = mapped_column(Float, default=0, index=True)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    model_version: Mapped[str] = mapped_column(String(20), default="rec-1")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Intervention(TimestampMixin, Base):
    """An action authorities decided to take (often accepted from a recommendation)."""

    __tablename__ = "interventions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    recommendation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("recommendations.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(16), default="planned")  # planned | in_progress | completed
    geom = mapped_column(Geometry("GEOMETRY", srid=4326), nullable=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"))
    owner_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    notes: Mapped[str | None] = mapped_column(Text)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class Notification(TimestampMixin, Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONB, default=dict)
    dedupe_key: Mapped[str] = mapped_column(String(120))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (UniqueConstraint("user_id", "dedupe_key", name="uq_notification_dedupe"),)


class ExternalData(Base):
    """Cached observations from external providers (AQI, weather, elevation…)."""

    __tablename__ = "external_data"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)
    source_name: Mapped[str] = mapped_column(String(120))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    geom = mapped_column(Geometry("POINT", srid=4326), nullable=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
