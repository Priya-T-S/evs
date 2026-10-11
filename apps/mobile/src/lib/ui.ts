import { create } from "zustand";
import type { Bbox } from "@ecopulse/core";

/** Global UI state: the shared incident sheet, the area alert banner and the map viewport. */
interface UiState {
  incidentId: string | null;
  openIncident: (id: string) => void;
  closeIncident: () => void;
  alert: { title: string; incidentId: string; location: string | null } | null;
  setAlert: (a: UiState["alert"]) => void;
  mapBbox: Bbox | null;
  setMapBbox: (b: Bbox | null) => void;
  /** Ask the map to fly somewhere / select an incident when it becomes visible. */
  mapFocus: { lon?: number; lat?: number; zoom?: number; incidentId?: string; hotspotId?: string } | null;
  focusMap: (f: UiState["mapFocus"]) => void;
}

export const useUi = create<UiState>((set) => ({
  incidentId: null,
  openIncident: (incidentId) => set({ incidentId }),
  closeIncident: () => set({ incidentId: null }),
  alert: null,
  setAlert: (alert) => set({ alert }),
  mapBbox: null,
  setMapBbox: (mapBbox) => set({ mapBbox }),
  mapFocus: null,
  focusMap: (mapFocus) => set({ mapFocus }),
}));
