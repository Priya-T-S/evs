import { create } from "zustand";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import { OPEN_STATUSES, type Incident, type IncidentEventData, type Paged, type RealtimeEvent } from "@ecopulse/core";

/* ---------------------------------------------------------------- flash + announcements */

interface LiveState {
  flash: Record<string, number>;
  announcement: string;
  markFlash(id: string): void;
  announce(msg: string): void;
}

export const useLive = create<LiveState>((set, get) => ({
  flash: {},
  announcement: "",
  markFlash: (id) => set({ flash: { ...get().flash, [id]: Date.now() } }),
  announce: (msg) => set({ announcement: msg }),
}));

/* ---------------------------------------------------------------- queue cache patching */

export interface QueueKey {
  priority: string;
  domain?: string;
  status: string;
  since?: string;
  bbox?: string;
}

function matches(k: QueueKey, d: Incident): boolean {
  if (!OPEN_STATUSES.includes(d.status)) return false;
  if (d.priority !== k.priority) return false;
  if (k.domain && !k.domain.split(",").includes(d.domain)) return false;
  if (k.status !== "open" && k.status !== d.status) return false;
  if (k.since && Date.parse(d.last_reported_at) < Date.parse(k.since)) return false;
  if (k.bbox) {
    const [w, s, e, n] = k.bbox.split(",").map(Number);
    if (d.lon < w || d.lon > e || d.lat < s || d.lat > n) return false;
  }
  return true;
}

/**
 * Apply an incident event to every cached priority-queue section in place: remove the row
 * wherever it was, insert it (risk-ordered) into the section it now belongs to.
 */
export function patchQueues(qc: QueryClient, e: RealtimeEvent<IncidentEventData>) {
  const d = e.data;
  if (!d?.id) return;
  for (const [key, data] of qc.getQueriesData<InfiniteData<Paged<Incident>>>({ queryKey: ["queue"] })) {
    if (!data) continue;
    const k = key[1] as QueueKey;
    let removed = false;
    let pages = data.pages.map((p) => {
      const items = p.items.filter((i) => i.id !== d.id);
      if (items.length !== p.items.length) removed = true;
      return { ...p, items };
    });
    let inserted = false;
    if (matches(k, d)) {
      const row: Incident = { ...(d as Incident) };
      for (let pi = 0; pi < pages.length && !inserted; pi++) {
        const items = pages[pi].items;
        const at = items.findIndex((i) => i.risk_score < row.risk_score);
        const isLast = pi === pages.length - 1;
        const fullyLoaded = (pages[pi].offset ?? 0) + items.length >= (pages[pi].total ?? 0);
        if (at >= 0 || (isLast && fullyLoaded)) {
          const next = [...items];
          next.splice(at >= 0 ? at : next.length, 0, row);
          pages[pi] = { ...pages[pi], items: next };
          inserted = true;
        }
      }
    }
    // Totals: +1 when it newly belongs here, -1 when it left (loaded or not).
    const belongs = matches(k, d);
    const isNew = e.type === "incident.created" || !!d.priority_changed;
    const totalDelta = belongs ? (!removed && isNew ? 1 : 0) : removed ? -1 : 0;
    pages = pages.map((p) => ({ ...p, total: Math.max(0, p.total + totalDelta) }));
    qc.setQueryData(key, { ...data, pages });
  }
}
