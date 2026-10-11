import { create } from "zustand";
import { Geolocation } from "@capacitor/geolocation";
import { DEFAULT_CENTER } from "./config";
import { useApp, type Position } from "./store";

export type LocStatus = "idle" | "locating" | "ok" | "denied" | "unavailable";

interface LocState {
  status: LocStatus;
  gps: Position | null;
  center: [number, number];
  setCenter: (c: [number, number]) => void;
  locate: (opts?: { highAccuracy?: boolean }) => Promise<Position | null>;
}

let inflight: Promise<Position | null> | null = null;

export const useLocation = create<LocState>((set, get) => ({
  status: "idle",
  gps: null,
  center: DEFAULT_CENTER,
  setCenter: (center) => set({ center }),
  locate: (opts = {}) => {
    if (inflight) return inflight;
    set({ status: get().gps ? get().status : "locating" });
    inflight = (async () => {
      try {
        const p = await Geolocation.getCurrentPosition({
          enableHighAccuracy: opts.highAccuracy ?? true,
          timeout: 12_000,
          maximumAge: opts.highAccuracy ? 5_000 : 60_000,
        });
        const pos: Position = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy ?? null,
          source: "gps",
          at: Date.now(),
        };
        set({ gps: pos, status: "ok" });
        useApp.getState().setLastPosition(pos);
        return pos;
      } catch (e) {
        const err = e as { code?: number; message?: string };
        const denied = err?.code === 1 || /denied|permission/i.test(err?.message ?? "");
        set({ status: denied ? "denied" : "unavailable" });
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },
}));

/**
 * The position the app works with: live GPS when we have it, else the last known GPS fix
 * (from a previous session), else the user's saved home area, else the city centre — the
 * fallbacks always come with a visible notice in the UI.
 */
export function usePosition(): Position {
  const gps = useLocation((s) => s.gps);
  const center = useLocation((s) => s.center);
  const last = useApp((s) => s.lastPosition);
  const home = useApp((s) => s.user?.home ?? null);
  if (gps) return gps;
  if (last && last.source === "gps") return last;
  if (home) return { lon: home.lon, lat: home.lat, accuracy: null, source: "fallback", fallback: "home", at: 0 };
  return { lon: center[0], lat: center[1], accuracy: null, source: "fallback", fallback: "city", at: 0 };
}
