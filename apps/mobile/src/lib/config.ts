export const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000").replace(/\/$/, "");
/** Fallback when /meta has not loaded yet (Bengaluru). Replaced by meta.city.center at runtime. */
export const DEFAULT_CENTER: [number, number] = [77.5946, 12.9716];
export const DEFAULT_CITY = "Bengaluru";
export const NEARBY_RADIUS_M = 2000;
export const PULSE_RADIUS_M = 3000;
