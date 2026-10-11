import { create } from "zustand";
import type { Selection } from "@ecopulse/core";
import type { MapHandle } from "@/components/map/MapView";

export const DRAWER_WIDTH = 440;

interface SelectionState {
  selection: Selection | null;
  handle: MapHandle | null;
  select(s: Selection | null, opts?: { fly?: boolean; zoom?: number }): void;
  setHandle(h: MapHandle | null): void;
}

/** Command-center selection, shared by the queue, map, search, ticker, drawer and toasts. */
export const useSelection = create<SelectionState>((set, get) => ({
  selection: null,
  handle: null,
  select(s, opts) {
    set({ selection: s });
    const h = get().handle;
    if (!h) return;
    const apply = () => h.controller.select(s ? { kind: s.kind, id: s.id } : null);
    if (h.map.getSource("incidents")) apply();
    else h.map.once("load", apply);
    if (s && opts?.fly) {
      const z = opts.zoom ?? Math.max(h.map.getZoom(), s.kind === "incident" ? 15 : 13.5);
      // The detail drawer overlays the right edge; centre the target in the visible area.
      h.map.flyTo({ center: [s.lon, s.lat], zoom: z, padding: { left: 0, right: DRAWER_WIDTH, top: 0, bottom: 0 }, essential: true });
    }
  },
  setHandle: (h) => set({ handle: h }),
}));

/** Build a selection for an incident not clicked on the map (queue row, search, toast). */
export const incidentSel = (i: { id: string; lon: number; lat: number }): Selection => ({ kind: "incident", id: i.id, lon: i.lon, lat: i.lat, properties: {} });

// Dev-only hook used by scripts/shots.mjs to select map features deterministically.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __ecoSelect: SelectionState["select"] }).__ecoSelect = (s, o) => useSelection.getState().select(s, o);
}
