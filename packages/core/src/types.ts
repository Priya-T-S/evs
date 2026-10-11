// Types mirror the FastAPI serializers in backend/app/modules/*. Keep them in sync.

export type Domain = "waste" | "air" | "water" | "noise" | "green" | "flood" | "other";
export type Priority = "P1" | "P2" | "P3" | "P4";
export type IncidentStatus =
  | "reported"
  | "ai_classified"
  | "verified"
  | "prioritized"
  | "assigned"
  | "action_started"
  | "resolved"
  | "citizen_verified"
  | "dismissed";
export type Provenance = "observed" | "external" | "model" | "recommendation";
export type Role = "citizen" | "moderator" | "analyst" | "officer" | "admin";
export type Permission =
  | "incident.view_exact"
  | "incident.moderate"
  | "incident.assign"
  | "incident.resolve"
  | "analytics.view"
  | "recommendation.manage"
  | "users.manage"
  | "audit.view"
  | "jobs.run";

export interface User {
  id: string;
  email: string | null;
  display_name: string;
  role: Role;
  is_guest: boolean;
  eco_points: number;
  level: { name: string; next: string | null; next_at: number | null };
  team: string | null;
  home: { lon: number; lat: number } | null;
  notification_prefs: { my_reports: boolean; area: boolean; rewards: boolean };
  permissions: Permission[];
  created_at: string;
  stats?: { reports: number; verified_reports: number; verifications: number };
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
}

export interface CategoryMeta {
  slug: string;
  label: string;
  domain: Domain;
  default_severity: number;
  requires_photo: boolean;
}

export interface Meta {
  city: { name: string; center: [number, number] };
  categories: CategoryMeta[];
  statuses: IncidentStatus[];
  severities: Record<string, string>;
  public_location_precision_m: number;
  ai: { classifier: string };
}

export interface Incident {
  id: string;
  ref: string;
  title: string;
  category: string;
  category_label: string;
  domain: Domain;
  status: IncidentStatus;
  severity: 1 | 2 | 3 | 4;
  severity_label: "low" | "moderate" | "high" | "critical";
  priority: Priority;
  risk_score: number;
  confidence: number;
  lon: number;
  lat: number;
  location_precision: string;
  location_id: number | null;
  location_name: string | null;
  hotspot_id: string | null;
  report_count: number;
  reporter_count: number;
  verify: { yes: number; no: number; unsure: number };
  ai_label: string | null;
  ai_confidence: number | null;
  population_exposed: number;
  near_sensitive: boolean;
  first_reported_at: string;
  last_reported_at: string;
  resolved_at: string | null;
  assigned_team: string | null;
  thumb_url: string | null;
  is_demo: boolean;
  distance_m?: number;
}

export interface RiskExplanation {
  model: string;
  score: number;
  components: Record<string, number>;
  weights: Record<string, number>;
  contributions: Record<string, number>;
  inputs: {
    severity: number;
    reporters: number;
    population_exposed: number;
    age_days: number;
    sensitive_sites: number;
    recent_reports_72h: number;
    external: string | null;
  };
  top_drivers: string[];
  note?: string;
}

export interface TimelineEvent {
  kind: string;
  from_status: IncidentStatus | null;
  to_status: IncidentStatus | null;
  note: string | null;
  actor: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface Evidence {
  id: string;
  url: string;
  thumb_url: string;
  purpose: "evidence" | "after";
  created_at: string;
}

export interface IncidentDetail extends Incident {
  summary: string | null;
  risk: RiskExplanation;
  sensitive_nearby: { kind: string; name: string | null; distance_m: number }[];
  noise_db: number | null;
  updated_at: string;
  reports: {
    id: string;
    created_at: string;
    description: string | null;
    reporter: string | null;
    is_mine: boolean;
    ai_label: string | null;
    ai_confidence: number | null;
    duplicate_score: number | null;
    noise_db: number | null;
  }[];
  evidence: Evidence[];
  ai: {
    label: string | null;
    confidence: number | null;
    providers: string[];
    label_distribution: [string, number][];
    agreement: number | null;
    rationale: string | null;
    subtype: string | null;
  };
  timeline: TimelineEvent[];
  assignment: { team: string | null; assignee: string | null; due_at: string | null; note: string | null; created_at: string } | null;
  resolution: { status: string; note: string | null; created_at: string }[];
  related: Incident[];
  hotspot: { id: string; name: string; risk_score: number; trend_pct: number } | null;
  recommendations: { id: string; title: string; kind: string; confidence: number }[];
  my_verification: { response: "yes" | "no" | "unsure"; phase: "active" | "resolution"; created_at: string } | null;
  can: { moderate: boolean; assign: boolean; resolve: boolean };
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Hotspot {
  id: string;
  name: string;
  domain: Domain;
  kind: "observed" | "predicted";
  status: "active" | "cooling" | "resolved";
  primary_category: string;
  primary_category_label: string;
  risk_score: number;
  report_count: number;
  incident_count: number;
  active_incidents: number;
  trend_pct: number;
  confidence: number;
  category_mix: Record<string, number>;
  method: string;
  location_id: number | null;
  lon: number;
  lat: number;
  detected_at: string;
  updated_at: string;
}

export interface HotspotDetail extends Hotspot {
  geometry: GeoJSON.Polygon;
  risk: Record<string, unknown>;
  incidents: Incident[];
  weekly_reports: { week: string; reports: number }[];
  recommendations: {
    id: string;
    title: string;
    kind: string;
    confidence: number;
    expected_impact: string;
    status: string;
    actions: RecommendationAction[];
  }[];
}

export type ScoreDimension = "air" | "water" | "waste" | "noise" | "green" | "clean";

export interface Score {
  overall: number;
  grade: "good" | "fair" | "poor" | "critical";
  dimensions: Record<ScoreDimension, number>;
  explanation: {
    model: string;
    area_km2: number;
    dimensions: Record<ScoreDimension, Record<string, unknown> & { method: string }>;
    weights: Record<ScoreDimension, number>;
    weakest: ScoreDimension[];
  };
  model_version: string;
  computed_at: string;
}

export interface ExternalReading {
  value: Record<string, number | null>;
  source: string;
  is_demo: boolean;
  observed_at: string;
}

export interface AreaScore {
  location: { id: number; name: string; population: number; boundary_is_demo: boolean };
  score: Score | null;
  change_7d: number | null;
  external: { aqi: ExternalReading | null; weather: ExternalReading | null };
  city_rank?: { rank: number; of: number };
}

export interface LocationScoreRow {
  id: number;
  name: string;
  population: number;
  overall: number | null;
  grade: Score["grade"] | null;
  dimensions: Record<ScoreDimension, number> | null;
  weakest: ScoreDimension[] | null;
}

export type PulseLevel = "critical" | "elevated" | "normal" | "resolved";

export interface PulseItem {
  incident_id: string;
  ref: string;
  title: string;
  category: string;
  category_label: string;
  domain: Domain;
  severity: number;
  priority: Priority;
  status: IncidentStatus;
  reporter_count: number;
  risk_score: number;
  location_name: string | null;
  event: string;
  at: string;
  lon: number;
  lat: number;
  level: PulseLevel;
  is_demo: boolean;
}

export interface Pulse {
  city: string;
  stats: {
    new_incidents_24h: number;
    resolved_24h: number;
    reports_24h: number;
    open_incidents: number;
    p1_open: number;
    critical_open: number;
    active_hotspots: number;
    live_viewers: number;
  };
  feed: PulseItem[];
  rising_hotspots: { id: string; name: string; domain: Domain; risk_score: number; trend_pct: number; active_incidents: number }[];
  daily_reports: { day: string; reports: number }[];
}

export interface RecommendationAction {
  rank: number;
  title: string;
  detail: string;
  rule: string;
}

export interface Recommendation {
  id: string;
  kind: string;
  title: string;
  status: "open" | "accepted" | "dismissed" | "superseded";
  target_type: string;
  target_id: string | null;
  location_id: number | null;
  location_name: string | null;
  observed: Record<string, unknown>;
  inference: Record<string, unknown>;
  actions: RecommendationAction[];
  expected_impact: "high" | "medium" | "low";
  confidence: number;
  priority_score: number;
  model_version: string;
  geometry: GeoJSON.Geometry | null;
  created_at: string;
  updated_at: string;
}

export interface ReportResult {
  id: string;
  client_id: string | null;
  category: string;
  category_label: string;
  description: string | null;
  status: "received" | "queued" | "processed" | "merged";
  lon: number | null;
  lat: number | null;
  is_anonymous: boolean;
  noise_db: number | null;
  created_at: string;
  ai: {
    label: string | null;
    category: string | null;
    confidence: number | null;
    severity: number | null;
    provider: string | null;
    rationale: string | null;
    subtype: string | null;
    agrees_with_reporter: boolean | null;
  } | null;
  duplicate: { score: number; signals: Record<string, number> } | null;
  incident: { id: string; ref: string; title: string; status: IncidentStatus; reporter_count: number; priority: Priority } | null;
  media: { id: string; url: string; thumb_url: string }[];
  is_demo: boolean;
}

export interface Classification {
  category: string;
  category_label: string;
  label: string;
  subtype: string | null;
  confidence: number;
  severity: number;
  provider: string;
  rationale: string | null;
  agrees_with_reporter: boolean;
}

export interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string;
  data: Record<string, string>;
  read: boolean;
  created_at: string;
}

export interface MapLayerDef {
  id: string;
  label: string;
  group: "Overview" | "Domains" | "Planning";
  provenance: string;
  description: string;
  render: string;
  endpoint: string;
  secondary_endpoint?: string;
  legend:
    | { type: "gradient"; stops: [number, string][]; unit: string }
    | { type: "categorical"; items: [string, string][]; shape?: string };
}

export interface FeatureCollection<P = Record<string, unknown>, G extends GeoJSON.Geometry = GeoJSON.Geometry> {
  type: "FeatureCollection";
  features: GeoJSON.Feature<G, P>[];
  meta?: Record<string, unknown>;
}

export interface SearchResult {
  type: "neighbourhood" | "incident" | "hotspot" | "place";
  id: string | number;
  label: string;
  lon: number;
  lat: number;
  zoom: number;
}

export interface AssistantAnswer {
  answer: string;
  tool_calls: { tool: string; args: Record<string, unknown> }[];
  provider: string;
  grounded: boolean;
}

export interface ProviderStatus {
  name: string;
  kind: string;
  source: string;
  requires_key: boolean;
  configured: boolean;
  status: "live" | "demo" | "not_configured";
  last_success: string | null;
  last_error: string | null;
  last_data_at: string | null;
  notes: string | null;
}

export interface Analytics {
  period_days: number;
  totals: {
    reports: number;
    reports_change_pct: number;
    incidents: number;
    resolved: number;
    open: number;
    median_resolution_days: number | null;
    citizen_confirmed_share: number | null;
    active_reporters: number;
    duplicate_share: number;
  };
  daily_by_domain: { day: string; domain: Domain; reports: number }[];
  by_category: { category: string; label: string; incidents: number; open: number; avg_days_to_resolve: number | null }[];
  by_location: { id: number; name: string; open: number; new: number; resolved: number; score: number | null }[];
  status_funnel: Record<string, number>;
  teams: { team: string; open: number; resolved: number }[];
}

// ---------------------------------------------------------------- realtime

export type RealtimeEventType =
  | "incident.created"
  | "incident.updated"
  | "incident.resolved"
  | "report.received"
  | "hotspot.created"
  | "hotspot.updated"
  | "hotspot.cooled"
  | "environmental_score.updated"
  | "alert.created"
  | "notification.created"
  | "ready"
  | "subscribed"
  | "pong"
  | "resync";

export interface RealtimeEvent<T = unknown> {
  id?: string;
  type: RealtimeEventType;
  topic?: string;
  ts?: string;
  geo?: { lon: number; lat: number } | null;
  data: T;
}

export type IncidentEventData = Incident & { priority_changed?: boolean };
export type ScoreEventData = {
  location_id: number;
  location_name: string;
  overall: number;
  previous: number | null;
  grade: Score["grade"];
  dimensions: Record<ScoreDimension, number>;
};
export type AlertEventData = { level: "critical"; title: string; incident_id: string; location_name: string | null };
export type HotspotEventData = Pick<
  Hotspot,
  "id" | "name" | "domain" | "kind" | "status" | "risk_score" | "report_count" | "active_incidents" | "trend_pct" | "primary_category" | "lon" | "lat"
>;
