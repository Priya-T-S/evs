import type { Domain, IncidentStatus, Priority, Provenance, PulseLevel, ScoreDimension } from "./types";

/**
 * Shared visual vocabulary. Colours are chosen to stay distinguishable on both the light
 * (positron) and dark basemaps, and are always paired with a non-colour cue (label, shape,
 * or icon) so severity is never communicated by colour alone.
 */

export const DOMAIN: Record<Domain, { label: string; color: string; icon: string }> = {
  waste: { label: "Waste", color: "#a8742c", icon: "trash-2" },
  air: { label: "Air", color: "#5f7d9c", icon: "wind" },
  water: { label: "Water", color: "#2b7aa8", icon: "droplets" },
  noise: { label: "Noise", color: "#8a63b3", icon: "volume-2" },
  green: { label: "Green cover", color: "#4c8c4a", icon: "trees" },
  flood: { label: "Flooding", color: "#3a5fae", icon: "waves" },
  other: { label: "Other", color: "#7b7d74", icon: "circle-dot" },
};

export const CATEGORY_ICON: Record<string, string> = {
  garbage: "trash-2",
  illegal_dumping: "truck",
  plastic_waste: "recycle",
  e_waste: "cpu",
  dead_animals: "bone",
  air_pollution: "wind",
  open_burning: "flame",
  construction_dust: "hard-hat",
  water_pollution: "droplets",
  sewage: "pipette",
  noise_pollution: "volume-2",
  tree_loss: "tree-deciduous",
  illegal_tree_cutting: "axe",
  flooding: "waves",
  waterlogging: "cloud-rain",
  drainage: "construction",
  other: "circle-dot",
};

export const PRIORITY: Record<Priority, { label: string; color: string; text: string; rank: number; description: string }> = {
  P1: { label: "P1", color: "#b3261e", text: "#ffffff", rank: 1, description: "Critical · act within 24 h" },
  P2: { label: "P2", color: "#d4622a", text: "#ffffff", rank: 2, description: "High · act within 3 days" },
  P3: { label: "P3", color: "#c99a1e", text: "#1d1a10", rank: 3, description: "Moderate · schedule" },
  P4: { label: "P4", color: "#6f8f74", text: "#ffffff", rank: 4, description: "Low · monitor" },
};

export const SEVERITY: Record<number, { label: string; color: string }> = {
  1: { label: "Low", color: "#6f8f74" },
  2: { label: "Moderate", color: "#c99a1e" },
  3: { label: "High", color: "#d4622a" },
  4: { label: "Critical", color: "#b3261e" },
};

export const PULSE_LEVEL: Record<PulseLevel, { label: string; color: string }> = {
  critical: { label: "Critical", color: "#b3261e" },
  elevated: { label: "Elevated", color: "#d4622a" },
  normal: { label: "Active", color: "#c99a1e" },
  resolved: { label: "Resolved", color: "#2f7d57" },
};

export const STATUS: Record<IncidentStatus, { label: string; step: number; tone: "open" | "progress" | "done" | "muted" }> = {
  reported: { label: "Reported", step: 0, tone: "open" },
  ai_classified: { label: "AI classified", step: 1, tone: "open" },
  verified: { label: "Verified", step: 2, tone: "open" },
  prioritized: { label: "Prioritised", step: 3, tone: "open" },
  assigned: { label: "Assigned", step: 4, tone: "progress" },
  action_started: { label: "Action started", step: 5, tone: "progress" },
  resolved: { label: "Resolved", step: 6, tone: "done" },
  citizen_verified: { label: "Citizen verified", step: 7, tone: "done" },
  dismissed: { label: "Dismissed", step: -1, tone: "muted" },
};

export const LIFECYCLE: IncidentStatus[] = [
  "reported",
  "ai_classified",
  "verified",
  "prioritized",
  "assigned",
  "action_started",
  "resolved",
  "citizen_verified",
];

export const OPEN_STATUSES: IncidentStatus[] = ["reported", "ai_classified", "verified", "prioritized", "assigned", "action_started"];

export const PROVENANCE: Record<Provenance, { label: string; color: string; description: string }> = {
  observed: { label: "Observed", color: "#1f6f5c", description: "Directly reported by citizens" },
  external: { label: "External data", color: "#5f7d9c", description: "From an external provider (e.g. Open-Meteo, OpenStreetMap)" },
  model: { label: "Model", color: "#6b5aa6", description: "Computed by a transparent EcoPulse model" },
  recommendation: { label: "Recommendation", color: "#b07a12", description: "A suggestion derived from data — not a fact" },
};

export const SCORE_DIMENSIONS: { key: ScoreDimension; label: string; hint: string }[] = [
  { key: "air", label: "Air", hint: "AQI and air-pollution reports" },
  { key: "water", label: "Water", hint: "Water pollution and sewage" },
  { key: "waste", label: "Waste", hint: "Garbage, dumping, plastic, e-waste" },
  { key: "noise", label: "Noise", hint: "Noise reports and measured dB" },
  { key: "green", label: "Green", hint: "Share of area that is green" },
  { key: "clean", label: "Clean-up", hint: "How fast reported problems get fixed" },
];

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#9a9c94";
  if (score >= 75) return "#2f7d57";
  if (score >= 55) return "#a59a1f";
  if (score >= 35) return "#d4622a";
  return "#b3261e";
}

export function gradeLabel(score: number | null | undefined): string {
  if (score == null) return "No data";
  if (score >= 75) return "Good";
  if (score >= 55) return "Fair";
  if (score >= 35) return "Poor";
  return "Critical";
}

export function aqiBand(aqi: number | null | undefined): { label: string; color: string } {
  if (aqi == null) return { label: "No data", color: "#9a9c94" };
  if (aqi <= 50) return { label: "Good", color: "#2f7d57" };
  if (aqi <= 100) return { label: "Moderate", color: "#a59a1f" };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", color: "#d4622a" };
  if (aqi <= 200) return { label: "Unhealthy", color: "#b3261e" };
  return { label: "Very unhealthy", color: "#7a1f3d" };
}

export function noiseBand(db: number): { label: string; color: string } {
  if (db < 55) return { label: "Quiet", color: "#2f7d57" };
  if (db < 65) return { label: "Moderate", color: "#a59a1f" };
  if (db < 75) return { label: "Elevated", color: "#d4622a" };
  if (db < 85) return { label: "Loud", color: "#b3261e" };
  return { label: "Harmful", color: "#7a1f3d" };
}

export const RISK_DRIVER_LABEL: Record<string, string> = {
  severity: "Severity",
  frequency: "Independent reports",
  exposure: "People exposed",
  persistence: "Time unresolved",
  sensitivity: "Schools / hospitals nearby",
  trend: "New reports (72 h)",
  external: "External signal",
};

export const RECOMMENDATION_KIND: Record<string, string> = {
  waste_hotspot_playbook: "Waste hotspot",
  water_hotspot_playbook: "Water contamination",
  air_hotspot_playbook: "Air pollution",
  noise_hotspot_playbook: "Noise",
  flood_hotspot_playbook: "Waterlogging",
  green_hotspot_playbook: "Tree loss",
  waste_collection_point: "Collection point",
  green_corridor: "Green corridor",
  flood_preparedness: "Flood preparedness",
  silence_zone: "Silence zone",
};

export const EVENT_LABEL: Record<string, string> = {
  created: "Reported",
  ai_classified: "AI classified",
  report_merged: "Another citizen reported this",
  auto_verified: "Verified by corroboration",
  community_verified: "Verified by the community",
  moderator_verified: "Verified by a moderator",
  prioritized: "Prioritised",
  assigned: "Assigned",
  action_started: "Action started",
  resolved: "Resolved",
  citizen_verified: "Fix confirmed by citizens",
  reopened: "Reopened",
  dismissed: "Dismissed",
  recategorized: "Category changed",
  severity_changed: "Severity changed",
  cleanup_scheduled: "Community clean-up drive scheduled",
  cleanup_completed: "Community clean-up drive completed",
  cleanup_cancelled: "Community clean-up drive cancelled",
};
