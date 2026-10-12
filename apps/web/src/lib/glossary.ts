import type { IncidentStatus, Priority, Provenance, ScoreDimension } from "@ecopulse/core";

/**
 * Plain-language wording for the command center. The shared catalog in @ecopulse/core holds
 * the short labels; this file adds the one-line explanations shown in tooltips, helper text
 * and the tour, written for people without a technical or GIS background.
 */

export const PRIORITY_WORD: Record<Priority, string> = { P1: "Critical", P2: "High", P3: "Moderate", P4: "Low" };

export const PRIORITY_DEADLINE: Record<Priority, string> = {
  P1: "fix within 24 hours",
  P2: "fix within 3 days",
  P3: "fix within 14 days",
  P4: "keep an eye on it",
};

export const PRIORITY_HELP =
  "Priority sets how fast to act. P1 = critical, fix within 24 hours. P2 = high, fix within 3 days. P3 = moderate, fix within 14 days. P4 = low, monitor (no deadline). It comes from the urgency score.";

export const SLA_HELP =
  "Each priority has a target time to fix, counted from the first report: P1 24 hours, P2 3 days, P3 14 days. P4 has no deadline. A problem past its target is overdue. If the priority goes up, the target gets shorter.";

/** "overdue by 3 days" / "due in 5 hours" for an SLA target. */
export function dueIn(iso: string, now = Date.now()): { overdue: boolean; text: string } {
  const s = (Date.parse(iso) - now) / 1000;
  const a = Math.abs(s);
  const span = a < 3600 ? `${Math.max(1, Math.round(a / 60))} min` : a < 86400 ? plural(Math.round(a / 3600), "hour") : plural(Math.round(a / 86400), "day");
  return s < 0 ? { overdue: true, text: `overdue by ${span}` } : { overdue: false, text: `due in ${span}` };
}

export const RISK_HELP =
  "Urgency score from 0 to 100. It goes up with how serious the problem is, how many people reported it, how many people live nearby, whether schools or hospitals are close, and how long it has been open.";

export const CONFIDENCE_HELP =
  "How sure EcoPulse is that this problem is real and in the right category. It rises when several people report the same thing and the photo check agrees with them.";

export const STATUS_HELP: Record<IncidentStatus, string> = {
  reported: "A resident reported it. Nobody has checked it yet.",
  ai_classified: "The photo and text were sorted into a category automatically. Still needs a person to check.",
  verified: "Confirmed as a real problem — by a moderator, or because several people reported it.",
  prioritized: "Given a priority (P1–P4) and waiting for a team.",
  assigned: "A team is responsible for fixing it.",
  action_started: "The team has started work on site.",
  resolved: "Staff marked it as fixed. Residents are asked to confirm.",
  citizen_verified: "Residents confirmed the fix. Fully closed.",
  dismissed: "Removed from the queue — for example a duplicate or not an environmental problem. Can be reopened.",
};

export const STATUS_STEPS_HELP =
  "Every problem moves left to right: reported → checked → given a priority → assigned to a team → work started → fixed → fix confirmed by residents.";

export const PROVENANCE_PLAIN: Record<Provenance, { label: string; help: string }> = {
  observed: { label: "Observed", help: "Seen and reported by residents — real reports and photos." },
  external: { label: "External", help: "Comes from an outside data provider, such as weather or air-quality services or OpenStreetMap." },
  model: { label: "Model", help: "Calculated by EcoPulse from the data. An estimate, not something someone saw." },
  recommendation: { label: "Recommendation", help: "A suggested action worked out from the data. A suggestion to consider, not a fact." },
};

export const HOTSPOT_HELP =
  "A hotspot is an area where many problems of the same kind are clustered. Solid outline = already happening (observed). Dashed outline = forecast: likely to appear in the next 14 days based on recent trends.";

export const FORECAST_HELP = "A forecast is a prediction from recent trends — nothing has been reported there yet.";

export const SCORE_HELP = "Neighbourhood environment score from 0 to 100. Higher is better. It combines six areas: air, water, waste, noise, green cover and how fast problems get fixed.";

export const DIMENSION_HELP: Record<ScoreDimension, string> = {
  air: "Air quality readings and reports of smoke, burning or dust.",
  water: "Reports of polluted water and sewage.",
  waste: "Reports of garbage, dumping, plastic and e-waste.",
  noise: "Noise complaints and sound levels measured by residents' phones.",
  green: "How much of the area is parks, trees or grass.",
  clean: "How quickly reported problems in the area get fixed.",
};

/** One plain sentence per map layer; the technical description stays available behind "?". */
export const LAYER_PLAIN: Record<string, string> = {
  risk: "Shaded hexagons: the darker, the more urgent the open problems in that area.",
  incidents: "Each dot is a reported problem, coloured by priority. Numbers are groups of dots — zoom in to split them.",
  hotspots: "Areas where many problems cluster. Dashed outlines are forecasts for the next 14 days.",
  waste: "Where garbage and dumping are reported most.",
  air: "Where smoke, burning and dust are reported, plus the air-quality index for each area.",
  water: "Where water pollution and sewage are reported most.",
  noise: "Where noise complaints are concentrated.",
  green: "Parks, woods and grass, and how green each area is.",
  flood: "Areas likely to flood with the coming rain; outlines show actual flooding in the last 3 days.",
  interventions: "Suggested places for new collection points, tree corridors, flood preparation and quiet zones.",
  infrastructure: "Existing waste collection and recycling points.",
  neighbourhoods: "Each neighbourhood shaded by its environment score — green is good, red is poor.",
};

export const CHART_HELP = {
  daily: "How many reports residents sent each day, one small chart per type of problem. Taller bars = more reports that day.",
  funnel: "How many problems were checked, assigned, fixed and confirmed by residents. The number in brackets is how many are at that step right now.",
  teams: "How many problems each team is handling: still open (orange) and already fixed (blue).",
  categories: "Which kinds of problems came in most, how many are still open, and how many days they take to fix on average.",
  league: "Neighbourhoods ranked by environment score, worst first, with how many problems were open, new and fixed.",
};

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;
}

/** "18 days open", "5 hours open", "40 min open". */
export function openFor(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return plural(Math.round(s / 3600), "hour");
  return plural(Math.round(s / 86400), "day");
}
