/**
 * Offline report queue.
 *
 * Reports that cannot be sent (offline, or the POST fails with a network error) are stored in
 * IndexedDB (idb-keyval) together with the photo Blob and a client-generated `client_id`.
 * A sync worker retries with exponential backoff when the network returns, when the app
 * resumes, and on an interval. The server is idempotent on `client_id`, so a retry after a
 * request that actually arrived returns the existing report instead of creating a duplicate.
 */
import { categoryWord } from "./words";
import { createStore, del, get, keys, set } from "idb-keyval";
import { create } from "zustand";
import { App } from "@capacitor/app";
import { ApiError, type ReportResult } from "@ecopulse/core";
import { api } from "./api";
import { isOnline, onOnlineChange } from "./network";
import { toast } from "./toast";
import { useApp } from "./store";

export interface ReportDraft {
  client_id: string;
  category: string;
  category_label: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  description: string;
  is_anonymous: boolean;
  captured_at: string;
  noise_db: number | null;
  photo: Blob | null;
}

export interface QueuedReport extends ReportDraft {
  queued_at: number;
  attempts: number;
  next_at: number;
  status: "pending" | "failed";
  last_error: string | null;
}

export type QueuedSummary = Omit<QueuedReport, "photo"> & { has_photo: boolean };

const store = createStore("ecopulse", "outbox");

interface OutboxState {
  items: QueuedSummary[];
  syncing: boolean;
}

export const useOutbox = create<OutboxState>(() => ({ items: [], syncing: false }));

export function newClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildReportForm(d: ReportDraft): FormData {
  const f = new FormData();
  f.set("category", d.category);
  f.set("lat", d.lat.toFixed(6));
  f.set("lon", d.lon.toFixed(6));
  if (d.accuracy_m != null) f.set("accuracy_m", String(Math.min(5000, Math.round(d.accuracy_m))));
  if (d.description.trim()) f.set("description", d.description.trim());
  f.set("is_anonymous", d.is_anonymous ? "true" : "false");
  f.set("client_id", d.client_id);
  f.set("captured_at", d.captured_at);
  if (d.noise_db != null) f.set("noise_db", d.noise_db.toFixed(1));
  if (d.photo) f.set("photo", d.photo, "photo.jpg");
  return f;
}

async function all(): Promise<QueuedReport[]> {
  try {
    const ks = await keys(store);
    const items = await Promise.all(ks.map((k) => get<QueuedReport>(k, store)));
    return items.filter(Boolean).sort((a, b) => a!.queued_at - b!.queued_at) as QueuedReport[];
  } catch {
    return [];
  }
}

export async function refreshOutbox() {
  const items = await all();
  useOutbox.setState({ items: items.map(({ photo, ...rest }) => ({ ...rest, has_photo: !!photo })) });
}

export async function enqueue(d: ReportDraft) {
  const item: QueuedReport = { ...d, queued_at: Date.now(), attempts: 0, next_at: Date.now() + 3000, status: "pending", last_error: null };
  await set(d.client_id, item, store);
  await refreshOutbox();
}

export async function discard(clientId: string) {
  await del(clientId, store);
  await refreshOutbox();
}

export type SubmitOutcome = { kind: "sent"; result: ReportResult } | { kind: "queued" };

/** Send now if possible; fall back to the offline queue on any network failure. */
export async function submitReport(d: ReportDraft): Promise<SubmitOutcome> {
  if (!isOnline()) {
    await enqueue(d);
    return { kind: "queued" };
  }
  try {
    const result = await api.reports.create(buildReportForm(d));
    return { kind: "sent", result };
  } catch (e) {
    if (e instanceof ApiError && !e.isNetwork) throw e; // validation etc: show to the user
    await enqueue(d);
    return { kind: "queued" };
  }
}

let running = false;
export async function syncOutbox(force = false): Promise<number> {
  if (running || !isOnline() || !useApp.getState().access) return 0;
  running = true;
  useOutbox.setState({ syncing: true });
  let sent = 0;
  try {
    const items = await all();
    for (const item of items) {
      if (item.status === "failed") continue;
      if (!force && item.next_at > Date.now()) continue;
      try {
        await api.reports.create(buildReportForm(item));
        await del(item.client_id, store);
        sent += 1;
        toast({
          title: "Your saved report was sent",
          body: `${categoryWord(item.category, item.category_label)} — thank you! We'll tell you when it's fixed.`,
          tone: "ok",
        });
      } catch (e) {
        const attempts = item.attempts + 1;
        if (e instanceof ApiError && !e.isNetwork && e.status !== 429 && e.status !== 401 && e.status < 500) {
          await set(item.client_id, { ...item, attempts, status: "failed", last_error: e.message }, store);
        } else {
          // Exponential backoff: 5 s, 10 s, 20 s … capped at 10 min.
          const delay = Math.min(600_000, 5000 * 2 ** (attempts - 1));
          await set(item.client_id, { ...item, attempts, next_at: Date.now() + delay, last_error: (e as Error).message }, store);
          if (e instanceof ApiError && e.isNetwork) break; // still offline: stop this pass
        }
      }
    }
  } finally {
    running = false;
    useOutbox.setState({ syncing: false });
    await refreshOutbox();
  }
  return sent;
}

let started = false;
export function startOutboxWorker() {
  if (started) return;
  started = true;
  refreshOutbox();
  onOnlineChange((online) => {
    if (online) setTimeout(() => syncOutbox(true), 800);
  });
  App.addListener("appStateChange", (s) => {
    if (s.isActive) syncOutbox(true);
  }).catch(() => undefined);
  setInterval(() => syncOutbox(false), 15_000);
  setTimeout(() => syncOutbox(true), 2000);
}
