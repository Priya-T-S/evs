import type { RealtimeEvent, RealtimeEventType } from "./types";

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "offline";
export type Topic = "incidents" | "hotspots" | "scores" | "alerts" | "pulse" | "org";

type Listener = (e: RealtimeEvent<any>) => void;

/**
 * WebSocket client with automatic reconnect (exponential backoff + jitter), heartbeat,
 * and subscription replay. Subscriptions are geographic: send the current viewport bbox
 * and the server only forwards events inside it (unless the "pulse" topic is on).
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private statusListeners = new Set<(s: RealtimeStatus) => void>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private subscription: { topics?: Topic[]; bbox?: number[] } = {};
  status: RealtimeStatus = "offline";

  constructor(
    private url: string,
    private getToken: () => string | null,
  ) {}

  connect() {
    this.closed = false;
    this.open();
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.ws?.close();
    this.setStatus("offline");
  }

  /** Reconnect with a fresh token (e.g. after login/logout). */
  restart() {
    this.ws?.close();
    this.attempt = 0;
    if (!this.closed) this.open();
  }

  subscribe(sub: { topics?: Topic[]; bbox?: number[] }) {
    this.subscription = { ...this.subscription, ...sub };
    this.send({ type: "subscribe", ...this.subscription });
  }

  on<T = unknown>(type: RealtimeEventType | "*", fn: (e: RealtimeEvent<T>) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn as Listener);
    this.listeners.set(type, set);
    return () => set.delete(fn as Listener);
  }

  onStatus(fn: (s: RealtimeStatus) => void): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  private setStatus(s: RealtimeStatus) {
    this.status = s;
    this.statusListeners.forEach((fn) => fn(s));
  }

  private send(msg: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private open() {
    const token = this.getToken();
    const url = token ? `${this.url}?token=${encodeURIComponent(token)}` : this.url;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("live");
      if (this.subscription.topics || this.subscription.bbox) this.send({ type: "subscribe", ...this.subscription });
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => this.send({ type: "ping" }), 30_000);
    };
    ws.onmessage = (msg) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(msg.data);
      } catch {
        return;
      }
      this.listeners.get(event.type)?.forEach((fn) => fn(event));
      this.listeners.get("*")?.forEach((fn) => fn(event));
    };
    ws.onclose = (ev) => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      if (this.ws !== ws) return;
      if (ev.code === 4401) {
        // Token rejected: retry anonymously after refresh logic in the app supplies a new one.
        this.attempt = Math.max(this.attempt, 2);
      }
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    this.setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "reconnecting");
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt) * (0.7 + Math.random() * 0.6);
    this.attempt += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), delay);
  }
}

export function wsUrlFrom(apiBase: string): string {
  const u = new URL(apiBase, typeof window !== "undefined" ? window.location.href : "http://localhost");
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = u.pathname.replace(/\/$/, "") + "/ws";
  return u.toString();
}
