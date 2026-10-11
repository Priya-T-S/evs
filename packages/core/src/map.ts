/** Map configuration shared by web and mobile (MapLibre GL). */

export const BASEMAP = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://openfreemap.org">OpenFreeMap</a>',
};

/** Information density thresholds (see backend maps router). */
export const ZOOM = {
  city: 10.5, // below: aggregated incident cells, hotspot areas, risk surface
  neighbourhood: 13, // hotspot boundaries, scores, clustered incidents
  street: 15, // individual incidents, sensitive sites, interventions
  clusterMax: 14,
};

/** MapLibre expression: colour by incident priority. */
export const priorityColorExpr = [
  "match",
  ["get", "priority"],
  "P1",
  "#b3261e",
  "P2",
  "#d4622a",
  "P3",
  "#c99a1e",
  "#6f8f74",
] as const;

export const domainColorExpr = [
  "match",
  ["get", "domain"],
  "waste",
  "#a8742c",
  "air",
  "#5f7d9c",
  "water",
  "#2b7aa8",
  "noise",
  "#8a63b3",
  "green",
  "#4c8c4a",
  "flood",
  "#3a5fae",
  "#7b7d74",
] as const;

/** Heatmap colour ramps per layer (transparent at zero density). */
export const HEAT_RAMP: Record<string, string[]> = {
  waste: ["rgba(168,116,44,0)", "rgba(214,170,96,0.45)", "#c48c40", "#a8742c", "#6b4310"],
  air: ["rgba(95,125,156,0)", "rgba(150,175,200,0.45)", "#7f9cbc", "#5f7d9c", "#2f4a66"],
  water: ["rgba(43,122,168,0)", "rgba(120,180,215,0.45)", "#4f9ac4", "#2b7aa8", "#123f5c"],
  noise: ["rgba(138,99,179,0)", "rgba(185,160,215,0.45)", "#a283c7", "#8a63b3", "#4d2f73"],
  flood: ["rgba(58,95,174,0)", "rgba(140,165,220,0.45)", "#6a8bd0", "#3a5fae", "#1c336b"],
  risk: ["rgba(201,154,30,0)", "rgba(230,190,90,0.5)", "#e0a033", "#d4622a", "#b3261e"],
  incidents: ["rgba(201,154,30,0)", "rgba(230,190,90,0.5)", "#e0a033", "#d4622a", "#b3261e"],
};

export function heatmapColorExpr(layer: string) {
  const ramp = HEAT_RAMP[layer] ?? HEAT_RAMP.risk;
  return ["interpolate", ["linear"], ["heatmap-density"], 0, ramp[0], 0.2, ramp[1], 0.45, ramp[2], 0.7, ramp[3], 1, ramp[4]];
}

export const riskFillExpr = [
  "interpolate",
  ["linear"],
  ["get", "value"],
  0,
  "rgba(241,233,198,0)",
  15,
  "rgba(234,200,110,0.35)",
  40,
  "rgba(224,160,51,0.5)",
  65,
  "rgba(212,98,42,0.6)",
  85,
  "rgba(179,38,30,0.7)",
];

// Absolute scale: low predicted risk (< 0.2, e.g. light rain) stays almost transparent so the
// layer never paints the whole city an alarming blue.
export const floodFillExpr = [
  "interpolate",
  ["linear"],
  ["get", "value"],
  0.12,
  "rgba(143,184,214,0)",
  0.2,
  "rgba(143,184,214,0.14)",
  0.3,
  "rgba(79,138,196,0.4)",
  0.55,
  "rgba(43,90,160,0.62)",
  0.8,
  "rgba(18,50,100,0.72)",
];

export const greenFillExpr = [
  "interpolate",
  ["linear"],
  ["get", "value"],
  0,
  "rgba(239,233,220,0)",
  0.05,
  "rgba(205,224,180,0.3)",
  0.2,
  "rgba(140,190,120,0.45)",
  0.4,
  "rgba(76,140,74,0.6)",
];

export const scoreFillExpr = [
  "case",
  ["==", ["get", "overall"], null],
  "rgba(154,156,148,0.15)",
  ["interpolate", ["linear"], ["coalesce", ["get", "overall"], 0], 30, "rgba(179,38,30,0.32)", 50, "rgba(212,98,42,0.26)", 65, "rgba(165,154,31,0.2)", 80, "rgba(47,125,87,0.18)"],
];

export function boundsToBbox(b: { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number }): [number, number, number, number] {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return [clamp(b.getWest(), -180, 180), clamp(b.getSouth(), -90, 90), clamp(b.getEast(), -180, 180), clamp(b.getNorth(), -90, 90)];
}
