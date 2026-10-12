/**
 * Plain-language vocabulary for the citizen app.
 *
 * The shared catalog in @ecopulse/core uses the command center's expert wording (P1–P4,
 * "AI classified", "Model", …). Residents see these everyday words instead; the technical
 * terms stay available behind "How do we know this?" disclosures.
 */
import type { IncidentDetail, IncidentStatus, Priority, Provenance, PulseLevel, ScoreDimension } from "@ecopulse/core";

export const PRIORITY_WORD: Record<Priority, { short: string; long: string; hint: string }> = {
  P1: { short: "Urgent", long: "Urgent", hint: "Needs action within a day" },
  P2: { short: "High", long: "High priority", hint: "Should be fixed within 3 days" },
  P3: { short: "Medium", long: "Medium priority", hint: "Will be scheduled" },
  P4: { short: "Low", long: "Low priority", hint: "Being watched" },
};

export const STATUS_WORD: Record<IncidentStatus, string> = {
  reported: "Received",
  ai_classified: "Checked",
  verified: "Confirmed",
  prioritized: "On the to-do list",
  assigned: "Team assigned",
  action_started: "Being fixed",
  resolved: "Fixed",
  citizen_verified: "Fix confirmed by neighbours",
  dismissed: "Closed",
};

/** What each step means, in one short line. */
export const STATUS_HINT: Record<IncidentStatus, string> = {
  reported: "We have the report.",
  ai_classified: "We've checked what kind of problem it is.",
  verified: "Neighbours or staff confirmed it is real.",
  prioritized: "It's in the city's list of things to fix.",
  assigned: "A city team is responsible for it.",
  action_started: "Work has started.",
  resolved: "The city says it's fixed.",
  citizen_verified: "People nearby confirmed the fix.",
  dismissed: "Closed by a reviewer — it was not a problem, or was a duplicate.",
};

export const EVENT_WORD: Record<string, string> = {
  created: "Reported",
  ai_classified: "Checked automatically",
  report_merged: "Someone else reported this too",
  auto_verified: "Confirmed — several people reported it",
  community_verified: "Confirmed by neighbours",
  moderator_verified: "Confirmed by a reviewer",
  prioritized: "Added to the city's to-do list",
  assigned: "Team assigned",
  action_started: "Work started",
  resolved: "Fixed",
  citizen_verified: "Fix confirmed by neighbours",
  reopened: "Opened again",
  dismissed: "Closed",
  recategorized: "Problem type changed",
  severity_changed: "Seriousness changed",
  cleanup_scheduled: "Neighbours planned a clean-up",
  cleanup_completed: "Neighbours cleaned it up",
  cleanup_cancelled: "Clean-up cancelled",
};

export const LEVEL_WORD: Record<PulseLevel, string> = {
  critical: "Urgent",
  elevated: "Needs attention",
  normal: "Open",
  resolved: "Fixed",
};

/** Where a number comes from, said simply. */
export const SOURCE_WORD: Record<Provenance, string> = {
  observed: "From people's reports",
  external: "From public data",
  model: "Our estimate",
  recommendation: "A suggestion, not a fact",
};

export function confidenceWord(c: number | null | undefined): string {
  if (c == null) return "not sure — please check";
  if (c >= 0.8) return "very likely";
  if (c >= 0.6) return "we're fairly sure";
  return "not sure — please check";
}

export function urgencyWord(risk: number | null | undefined): string {
  const r = risk ?? 0;
  if (r >= 75) return "Very high";
  if (r >= 55) return "High";
  if (r >= 35) return "Medium";
  return "Low";
}

export function ageWords(days: number): string {
  if (days < 1) return "less than a day";
  if (days < 1.5) return "1 day";
  if (days < 14) return `${Math.round(days)} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One-line plain reason for an incident's urgency, from the risk model's top drivers. */
export function urgencyReason(d: Pick<IncidentDetail, "risk" | "population_exposed" | "reporter_count">): string {
  const i = d.risk.inputs;
  const phrase: Record<string, string | null> = {
    exposure: d.population_exposed >= 3000 ? "many people live nearby" : "people live nearby",
    persistence: i.age_days >= 1 ? `it has been open for ${ageWords(i.age_days)}` : null,
    frequency: (i.reporters ?? d.reporter_count) > 1 ? `${i.reporters ?? d.reporter_count} people reported it` : null,
    severity: i.severity >= 3 ? "it looks serious" : null,
    sensitivity: i.sensitive_sites > 0 ? "a school or hospital is close by" : null,
    trend: i.recent_reports_72h > 1 ? "new reports keep coming in" : null,
    external: i.external ? "today's air or weather readings make it worse" : null,
  };
  const parts = d.risk.top_drivers.map((k) => phrase[k]).filter((x): x is string => !!x).slice(0, 2);
  if (!parts.length) return "Based on how serious it is and how many people it affects.";
  return `${cap(parts.join(" and "))}.`;
}

// ---------------------------------------------------------------- area score

export const DIMENSION_WORD: Record<ScoreDimension, { label: string; hint: string; problem: string }> = {
  air: { label: "Air", hint: "Air quality readings and smoke or dust reports", problem: "air quality" },
  water: { label: "Water", hint: "Dirty water and sewage reports", problem: "dirty water and sewage" },
  waste: { label: "Garbage", hint: "Garbage, dumping and plastic reports", problem: "garbage" },
  noise: { label: "Noise", hint: "Noise reports and phone noise readings", problem: "noise" },
  green: { label: "Trees & parks", hint: "How much of the area is green", problem: "too few trees and parks" },
  clean: { label: "Clean-up speed", hint: "How fast reported problems get fixed", problem: "slow clean-ups" },
};

export const DRIVER_WORD: Record<string, string> = {
  severity: "how serious it is",
  frequency: "how many people reported it",
  exposure: "how many people live nearby",
  persistence: "how long it has been open",
  sensitivity: "a school or hospital nearby",
  trend: "new reports lately",
  external: "air or weather readings",
};

export const DIMENSIONS: ScoreDimension[] = ["air", "water", "waste", "noise", "green", "clean"];

/** Good / Okay / Poor for a single 0–100 value (same thresholds as the colours). */
export function levelWord(v: number | null | undefined): "Good" | "Okay" | "Poor" | "No data" {
  if (v == null) return "No data";
  if (v >= 75) return "Good";
  if (v >= 55) return "Okay";
  return "Poor";
}

export function gradeWord(score: number | null | undefined): { word: string; phrase: string } {
  if (score == null) return { word: "No data", phrase: "We don't have enough information yet" };
  if (score >= 75) return { word: "Good", phrase: "Your area is doing well" };
  if (score >= 55) return { word: "Okay", phrase: "Your area is doing okay" };
  if (score >= 35) return { word: "Poor", phrase: "Your area needs attention" };
  return { word: "Very poor", phrase: "Your area has serious problems" };
}

/** "Your area is doing okay. Garbage and slow clean-ups are the main problems." */
export function areaSentence(overall: number, dims: Record<ScoreDimension, number>, weakest: ScoreDimension[]): string {
  const g = gradeWord(overall).phrase;
  const weak = (weakest.length ? weakest : [...DIMENSIONS].sort((a, b) => dims[a] - dims[b])).filter((k) => dims[k] < 75).slice(0, 2);
  if (!weak.length) return `${g}. No big problems right now.`;
  const names = weak.map((k) => DIMENSION_WORD[k].problem);
  return weak.length === 1 ? `${g}. ${cap(names[0])} is the main problem.` : `${g}. ${cap(names[0])} and ${names[1]} are the main problems.`;
}

export const TIPS: Record<ScoreDimension, string> = {
  air: "Don't burn leaves or garbage. Report smoke when you see it.",
  water: "Never pour oil or chemicals into drains. Report sewage leaks early.",
  waste: "Keep wet and dry waste separate, and hand it over only to the collection van.",
  noise: "Avoid honking. Loudspeakers are not allowed after 10 pm.",
  green: "Water a young tree near your home. Report trees being cut.",
  clean: "Report problems as soon as you see them. Small problems are quicker to fix.",
};

// ---------------------------------------------------------------- air quality

export function aqiWord(aqi: number | null | undefined): { word: string; advice: string } {
  if (aqi == null) return { word: "unknown", advice: "No reading right now." };
  if (aqi <= 50) return { word: "good", advice: "Air quality is fine for everyone." };
  if (aqi <= 100) return { word: "moderate", advice: "Fine for most people. Very sensitive people may want to take it easy outdoors." };
  if (aqi <= 150) return { word: "unhealthy for sensitive people", advice: "Children, older people and people with asthma should limit long outdoor activity." };
  if (aqi <= 200) return { word: "unhealthy", advice: "Everyone should cut down long or heavy outdoor activity." };
  return { word: "very unhealthy", advice: "Stay indoors where possible and avoid outdoor exercise." };
}

export function noiseWord(db: number): string {
  if (db < 55) return "Quiet";
  if (db < 65) return "Moderate";
  if (db < 75) return "Noisy";
  if (db < 85) return "Loud";
  return "Harmful";
}

// ---------------------------------------------------------------- report categories

export const CATEGORY_WORD: Record<string, { label: string; example: string }> = {
  garbage: { label: "Garbage", example: "Overflowing bins, litter" },
  illegal_dumping: { label: "Dumped waste", example: "Rubble or trash dumped on land" },
  sewage: { label: "Sewage", example: "Overflowing or open sewage" },
  drainage: { label: "Blocked drain", example: "Clogged or broken drains" },
  waterlogging: { label: "Standing water", example: "Water collected on the road" },
  open_burning: { label: "Burning waste", example: "Smoke from burning trash" },
  plastic_waste: { label: "Plastic waste", example: "Piles of plastic, bags" },
  water_pollution: { label: "Dirty water", example: "Polluted lake, canal or tap" },
  construction_dust: { label: "Building dust", example: "Dust from construction" },
  noise_pollution: { label: "Noise", example: "Loudspeakers, horns, machines" },
  air_pollution: { label: "Smoke or bad air", example: "Fumes, bad smell, smog" },
  flooding: { label: "Flooding", example: "Flooded roads or homes" },
  tree_loss: { label: "Dying trees", example: "Dead or fallen trees" },
  illegal_tree_cutting: { label: "Tree cutting", example: "Trees being cut down" },
  dead_animals: { label: "Dead animal", example: "Dead animal on the street" },
  e_waste: { label: "Old electronics", example: "Dumped phones, batteries" },
  other: { label: "Something else", example: "Any other problem" },
};

export const categoryWord = (slug: string | null | undefined, fallback = "Problem") => (slug && CATEGORY_WORD[slug]?.label) || fallback;

/**
 * Server titles use the expert category label ("Illegal Dumping near Koramangala"). Re-say
 * them with the same everyday name the report picker uses ("Dumped waste near Koramangala"),
 * so a problem is called the same thing on every screen.
 */
export function problemTitle(title: string | null | undefined, category: string | null | undefined): string {
  const word = category ? CATEGORY_WORD[category]?.label : undefined;
  if (!title) return word ?? "Problem";
  if (!word) return title;
  const m = /^.+? near (.+)$/.exec(title);
  return m ? `${word} near ${m[1]}` : word;
}

// ---------------------------------------------------------------- map layers

export const LAYER_WORD: Record<string, { label: string; description: string }> = {
  incidents: { label: "Reported problems", description: "Each dot is a problem people reported. Bigger, redder dots are more urgent." },
  hotspots: { label: "Problem areas", description: "Places where many problems are reported close together." },
  risk: { label: "Unfixed problems", description: "Shades the map darker where serious problems are still waiting to be fixed." },
  neighbourhoods: { label: "Area scores", description: "How each neighbourhood is doing, from good (green) to poor (red)." },
  waste: { label: "Garbage", description: "Where garbage, dumping and plastic are reported most." },
  air: { label: "Air", description: "Today's air quality reading for each area, and smoke or dust reports." },
  water: { label: "Water", description: "Where dirty water and sewage are reported." },
  noise: { label: "Noise", description: "Where noise is reported most." },
  green: { label: "Trees & parks", description: "Parks, woods and other green spaces." },
  flood: { label: "Flooding risk", description: "Places likely to flood after rain, and where flooding was seen recently." },
  interventions: { label: "Suggested improvements", description: "Ideas such as new waste points or tree lines. These are suggestions, not facts." },
  infrastructure: { label: "Waste drop-off points", description: "Known places to drop off garbage and recycling." },
};

export const LAYER_GROUP_WORD: Record<string, string> = { Overview: "Main", Domains: "By topic", Planning: "Ideas for the city" };

export const LEGEND_WORD: Record<string, string> = {
  P1: "Urgent",
  P2: "High",
  P3: "Medium",
  P4: "Low",
  Observed: "Seen now",
  "Forecast (next 14 days)": "Expected soon",
  "Existing point": "Drop-off point",
  "Collection point": "New waste point",
  "Green corridor": "Tree line",
  "Flood preparedness": "Flood planning",
  "Silence zone": "Quiet zone",
};

// ---------------------------------------------------------------- server messages

const PRIO_RE = /prioriti[sz]ed (P[1-4])/g;

/**
 * Notification texts come from the server in expert wording ("6 citizens reported this issue",
 * "Your report joined EP-AB12: …"). Re-say them plainly on the device.
 */
export function plainText(s: string): string {
  return s
    .replace(/Your report joined EP-[A-Z0-9]+: (.+?)\.?$/, "Your report was added to “$1”.")
    .replace(/ was corroborated by (\d+) citizens and prioriti[sz]ed (P[1-4])\./, (_, n, p) => ` was confirmed by ${n} people. It is now ${PRIORITY_WORD[p as Priority].long.toLowerCase()}.`)
    .replace(/ was verified and prioriti[sz]ed (P[1-4])\./, (_, p) => ` was confirmed. It is now ${PRIORITY_WORD[p as Priority].long.toLowerCase()}.`)
    .replace(PRIO_RE, (_, p) => PRIORITY_WORD[p as Priority].long.toLowerCase())
    .replace(/ was marked resolved\. Is it fixed\? Confirm on the ground to help\./, " is fixed, the city says. If you pass by, tell us if it's really gone.")
    .replace(/^Your reported issue was resolved$/, "Your reported problem was fixed")
    .replace(/^Fix confirmed by citizens$/, "Fix confirmed by neighbours")
    .replace(/^Issue reopened$/, "Problem opened again")
    .replace(/^Critical incident nearby$/, "Urgent problem near you")
    .replace(/Avoid the area if possible\./, "Please avoid the area if you can.")
    .replace(/\bEP-[A-Z0-9]{4,}:?\s*/g, "")
    .replace(/\bcitizens\b/g, "people")
    .replace(/\bCitizens\b/g, "People")
    .replace(/\bverified\b/g, "confirmed")
    .replace(/\bincidents?\b/g, (m) => (m.endsWith("s") ? "problems" : "problem"))
    .replace(/\bissues?\b/g, (m) => (m.endsWith("s") ? "problems" : "problem"));
}
