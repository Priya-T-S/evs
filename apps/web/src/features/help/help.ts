import { create } from "zustand";

export const CITIZEN_APP_URL: string = import.meta.env.VITE_CITIZEN_APP_URL || "http://localhost:5174";

const seenKey = (userId: string) => `ecopulse.tour.v1.${userId}`;

export function tourSeen(userId: string): boolean {
  try {
    return localStorage.getItem(seenKey(userId)) === "done";
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}

export function markTourSeen(userId: string) {
  try {
    localStorage.setItem(seenKey(userId), "done");
  } catch {
    /* ignore */
  }
}

interface HelpState {
  tour: boolean;
  step: number;
  shortcuts: boolean;
  startTour(): void;
  endTour(): void;
  setStep(n: number): void;
  setShortcuts(open: boolean): void;
}

/** Welcome tour + keyboard-shortcut help, shared by the top bar, user menu and pages. */
export const useHelp = create<HelpState>((set) => ({
  tour: false,
  step: 0,
  shortcuts: false,
  startTour: () => set({ tour: true, step: 0, shortcuts: false }),
  endTour: () => set({ tour: false, step: 0 }),
  setStep: (step) => set({ step }),
  setShortcuts: (shortcuts) => set({ shortcuts }),
}));

export const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
};
