import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { User } from "@ecopulse/core";
import { durableStorage } from "./storage";

export interface Position {
  lat: number;
  lon: number;
  accuracy: number | null;
  source: "gps" | "fallback";
  /** For fallbacks: the user's saved home area, or the city centre. */
  fallback?: "home" | "city";
  at: number;
}

export type TextSize = "normal" | "large" | "xl";

interface AppState {
  access: string | null;
  refresh: string | null;
  user: User | null;
  /** Intro + sign-in completed. */
  onboarded: boolean;
  /** The location explainer has been shown (we never prompt for permission without context). */
  locationExplained: boolean;
  lastPosition: Position | null;
  /** Text size setting (Profile). Scales the whole UI. */
  textSize: TextSize;
  /** One-time map hint ("Tap a coloured dot…") has been dismissed. */
  mapCoachSeen: boolean;
  setTextSize: (t: TextSize) => void;
  setMapCoachSeen: (v: boolean) => void;
  setTokens: (t: { access: string; refresh: string } | null) => void;
  setUser: (u: User | null) => void;
  setOnboarded: (v: boolean) => void;
  setLocationExplained: (v: boolean) => void;
  setLastPosition: (p: Position) => void;
  signOut: () => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      access: null,
      refresh: null,
      user: null,
      onboarded: false,
      locationExplained: false,
      lastPosition: null,
      textSize: "normal",
      mapCoachSeen: false,
      setTextSize: (textSize) => set({ textSize }),
      setMapCoachSeen: (mapCoachSeen) => set({ mapCoachSeen }),
      setTokens: (t) => set({ access: t?.access ?? null, refresh: t?.refresh ?? null }),
      setUser: (user) => set({ user }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setLocationExplained: (locationExplained) => set({ locationExplained }),
      setLastPosition: (lastPosition) => set({ lastPosition }),
      signOut: () => set({ access: null, refresh: null, user: null, onboarded: false }),
    }),
    {
      name: "ecopulse-app",
      storage: createJSONStorage(() => durableStorage),
      partialize: (s) => ({
        access: s.access,
        refresh: s.refresh,
        user: s.user,
        onboarded: s.onboarded,
        locationExplained: s.locationExplained,
        lastPosition: s.lastPosition,
        textSize: s.textSize,
        mapCoachSeen: s.mapCoachSeen,
      }),
    },
  ),
);
