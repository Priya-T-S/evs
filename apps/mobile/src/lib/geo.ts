import type { Bbox } from "@ecopulse/core";

/** Square bbox of half-width `meters` around a point. */
export function bboxAround(lat: number, lon: number, meters: number): Bbox {
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

export function within(lat: number, lon: number, b: Bbox): boolean {
  return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
}
