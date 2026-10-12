import type {
  Analytics,
  AreaScore,
  AssistantAnswer,
  AuthResponse,
  Classification,
  CleanupDrive,
  DriveStats,
  FeatureCollection,
  Hotspot,
  HotspotDetail,
  Incident,
  IncidentDetail,
  LocationScoreRow,
  MapLayerDef,
  Meta,
  Notification,
  Paged,
  ProviderStatus,
  Pulse,
  Recommendation,
  ReportResult,
  SearchResult,
  User,
} from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

export interface TokenStore {
  get(): { access: string | null; refresh: string | null };
  set(tokens: { access: string; refresh: string } | null): void;
}

export interface ApiOptions {
  baseUrl: string;
  tokens: TokenStore;
  onAuthLost?: () => void;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(q?: Query): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export type Bbox = [number, number, number, number];
export const bboxParam = (b: Bbox) => b.map((v) => v.toFixed(5)).join(",");

export function createApi(opts: ApiOptions) {
  let refreshing: Promise<boolean> | null = null;

  async function refresh(): Promise<boolean> {
    const { refresh: rt } = opts.tokens.get();
    if (!rt) return false;
    refreshing ??= (async () => {
      try {
        const res = await fetch(`${opts.baseUrl}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: rt }),
        });
        if (!res.ok) {
          opts.tokens.set(null);
          opts.onAuthLost?.();
          return false;
        }
        const data = (await res.json()) as AuthResponse;
        opts.tokens.set({ access: data.access_token, refresh: data.refresh_token });
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
    return refreshing;
  }

  async function request<T>(method: string, path: string, body?: unknown, retry = true, signal?: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {};
    const { access } = opts.tokens.get();
    if (access) headers.Authorization = `Bearer ${access}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}${path}`, { method, headers, body: payload, signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new ApiError(0, "network_error", "No connection to EcoPulse.");
    }
    if (res.status === 401 && retry && opts.tokens.get().refresh) {
      if (await refresh()) return request<T>(method, path, body, false, signal);
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error ?? {};
      throw new ApiError(res.status, err.code ?? "http_error", err.message ?? `Request failed (${res.status})`, err.details);
    }
    return data as T;
  }

  const get = <T>(path: string, q?: Query, signal?: AbortSignal) => request<T>("GET", path + qs(q), undefined, true, signal);
  const post = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
  const patch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body);
  const del = <T>(path: string) => request<T>("DELETE", path);

  const authed = async (p: Promise<AuthResponse>) => {
    const r = await p;
    opts.tokens.set({ access: r.access_token, refresh: r.refresh_token });
    return r;
  };

  return {
    baseUrl: opts.baseUrl,
    meta: () => get<Meta>("/meta"),
    health: () => get<{ status: string; database: boolean; redis: boolean; ws_clients: number }>("/health"),

    auth: {
      login: (email: string, password: string) => authed(post<AuthResponse>("/auth/login", { email, password })),
      register: (email: string, password: string, display_name: string) =>
        authed(post<AuthResponse>("/auth/register", { email, password, display_name })),
      guest: () => authed(post<AuthResponse>("/auth/guest")),
      logout: async () => {
        const { refresh: rt } = opts.tokens.get();
        if (rt) await post("/auth/logout", { refresh_token: rt }).catch(() => undefined);
        opts.tokens.set(null);
      },
      me: () => get<User>("/auth/me"),
      updateMe: (body: Partial<{ display_name: string; home_lat: number; home_lon: number; clear_home: boolean; notification_prefs: Record<string, boolean>; push_token: string }>) =>
        patch<User>("/auth/me", body),
      points: () => get<{ total: number; level: User["level"]; history: { delta: number; reason: string; ref_type: string; ref_id: string; created_at: string }[] }>("/auth/me/points"),
    },

    reports: {
      create: (form: FormData) => post<ReportResult>("/reports", form),
      classify: (form: FormData) => post<Classification>("/ai/classify", form),
      mine: (before?: string) => get<{ items: ReportResult[]; next_before: string | null }>("/reports", { mine: true, before }),
      get: (id: string) => get<ReportResult>(`/reports/${id}`),
    },

    incidents: {
      list: (q: Query = {}, signal?: AbortSignal) => get<Paged<Incident>>("/incidents", q, signal),
      get: (id: string) => get<IncidentDetail>(`/incidents/${id}`),
      verify: (id: string, response: "yes" | "no" | "unsure", pos?: { lat: number; lon: number }) =>
        post<{ phase: string; counts: { yes: number; no: number; unsure: number }; status: string; confidence: number }>(`/incidents/${id}/verify`, { response, ...pos }),
      moderate: (id: string, body: { action: "verify" | "dismiss" | "reopen"; note?: string; severity?: number; category?: string }) =>
        post<{ status: string; priority: string; risk_score: number }>(`/incidents/${id}/moderate`, body),
      assign: (id: string, body: { team: string; assignee_id?: string; note?: string; due_at?: string }) =>
        post<{ status: string }>(`/incidents/${id}/assign`, body),
      start: (id: string, note?: string) => post<{ status: string }>(`/incidents/${id}/start`, { note }),
      resolve: (id: string, form: FormData) => post<{ status: string; resolved_at: string }>(`/incidents/${id}/resolve`, form),
    },

    map: {
      layers: () => get<{ layers: MapLayerDef[] }>("/map/layers"),
      incidents: (bbox: Bbox, zoom: number, q: Query = {}, signal?: AbortSignal) =>
        get<FeatureCollection>("/map/incidents", { bbox: bboxParam(bbox), zoom: zoom.toFixed(1), ...q }, signal),
      heatmap: (layer: string, bbox: Bbox, zoom: number, q: Query = {}, signal?: AbortSignal) =>
        get<FeatureCollection<{ w: number }>>("/map/heatmap", { layer, bbox: bboxParam(bbox), zoom: zoom.toFixed(1), ...q }, signal),
      grid: (layer: "risk" | "flood_predicted" | "flood_observed" | "green", bbox: Bbox, signal?: AbortSignal) =>
        get<FeatureCollection>("/map/grid", { layer, bbox: bboxParam(bbox) }, signal),
      locations: (bbox?: Bbox, zoom?: number, signal?: AbortSignal) =>
        get<FeatureCollection>("/map/locations", { bbox: bbox && bboxParam(bbox), zoom }, signal),
      greenZones: (bbox: Bbox, zoom: number, signal?: AbortSignal) =>
        get<FeatureCollection>("/map/green-zones", { bbox: bboxParam(bbox), zoom: zoom.toFixed(1) }, signal),
      wastePoints: (bbox: Bbox, signal?: AbortSignal) => get<FeatureCollection>("/map/waste-points", { bbox: bboxParam(bbox) }, signal),
      sensitiveSites: (bbox: Bbox, signal?: AbortSignal) => get<FeatureCollection>("/map/sensitive-sites", { bbox: bboxParam(bbox) }, signal),
      aqi: (signal?: AbortSignal) => get<FeatureCollection>("/map/aqi", undefined, signal),
      recommendations: (bbox: Bbox, signal?: AbortSignal) => get<FeatureCollection>("/map/recommendations", { bbox: bboxParam(bbox) }, signal),
      search: (q: string, signal?: AbortSignal) => get<{ results: SearchResult[] }>("/map/search", { q }, signal),
    },

    hotspots: {
      list: (q: Query = {}) => get<{ items: Hotspot[] }>("/hotspots", q),
      geojson: (q: Query = {}, signal?: AbortSignal) => get<FeatureCollection>("/hotspots", { ...q, format: "geojson" }, signal),
      get: (id: string) => get<HotspotDetail>(`/hotspots/${id}`),
    },

    scores: {
      at: (lat: number, lon: number) => get<AreaScore>("/environmental-score", { lat, lon }),
      location: (id: number) => get<AreaScore>("/environmental-score", { location_id: id }),
      all: () => get<{ items: LocationScoreRow[] }>("/environmental-score/locations"),
      history: (id: number, days = 90) =>
        get<{ items: ({ at: string; overall: number } & Record<string, number | string>)[] }>(`/environmental-score/${id}/history`, { days }),
    },

    pulse: (q: { lat?: number; lon?: number; radius_m?: number } = {}) => get<Pulse>("/pulse", q),

    recommendations: {
      list: (q: Query = {}) => get<{ items: Recommendation[]; open_by_kind: Record<string, number> }>("/recommendations", q),
      get: (id: string) => get<Recommendation>(`/recommendations/${id}`),
      decide: (id: string, decision: "accept" | "dismiss" | "reopen", note?: string) =>
        post<{ status: string; intervention_id: string | null }>(`/recommendations/${id}/decision`, { decision, note }),
    },
    interventions: {
      list: () => get<{ items: { id: string; kind: string; title: string; status: string; notes: string | null; created_at: string; location_name: string | null; recommendation: string | null }[] }>("/interventions"),
      update: (id: string, status: "planned" | "in_progress" | "completed", notes?: string) => patch<{ status: string }>(`/interventions/${id}`, { status, notes }),
    },

    drives: {
      list: (q: Query = {}) => get<{ items: CleanupDrive[] }>("/drives", q),
      get: (id: string) => get<CleanupDrive>(`/drives/${id}`),
      create: (body: {
        title: string;
        description?: string;
        starts_at: string;
        duration_min?: number;
        max_volunteers?: number;
        incident_id?: string;
        hotspot_id?: string;
        lat?: number;
        lon?: number;
      }) => post<CleanupDrive>("/drives", body),
      join: (id: string) => post<CleanupDrive>(`/drives/${id}/join`),
      leave: (id: string) => del<CleanupDrive>(`/drives/${id}/join`),
      complete: (id: string, body: { bags_collected: number; attended?: number; note?: string }) => post<CleanupDrive>(`/drives/${id}/complete`, body),
      cancel: (id: string, reason?: string) => post<CleanupDrive>(`/drives/${id}/cancel`, { reason }),
      stats: (days = 30) => get<DriveStats>("/drives/stats/summary", { days }),
    },

    analytics: (days = 30) => get<Analytics>("/analytics/overview", { days }),
    notifications: {
      list: () => get<{ unread: number; items: Notification[] }>("/notifications"),
      read: (id: number) => post<void>(`/notifications/${id}/read`),
      readAll: () => post<void>("/notifications/read-all"),
    },
    external: {
      status: () =>
        get<{ providers: ProviderStatus[]; synthetic: { incident_share: number; neighbourhood_boundaries: boolean; green_zones: boolean; sensitive_sites: boolean; population: string } }>(
          "/external-data/status",
        ),
    },
    assistant: {
      ask: (question: string, history: { role: "user" | "assistant"; content: string }[] = [], pos?: { lat: number; lon: number }) =>
        post<AssistantAnswer>("/assistant/ask", { question, history, ...pos }),
    },
    admin: {
      assignable: () => get<{ users: { id: string; display_name: string; team: string | null }[]; teams: string[] }>("/users/assignable"),
      users: (q: Query = {}) => get<{ items: User[] }>("/users", q),
      updateUser: (id: string, body: Partial<{ role: string; is_active: boolean; team: string }>) => patch<User>(`/users/${id}`, body),
      audit: (q: Query = {}) =>
        get<{ items: { id: number; action: string; actor: string | null; target_type: string | null; target_id: string | null; ip: string | null; data: Record<string, unknown>; created_at: string }[] }>(
          "/audit-logs",
          q,
        ),
      runJob: (name: "regenerate" | "refresh_external") => post<{ queued: string }>(`/admin/jobs/${name}`),
    },
  };
}

export type Api = ReturnType<typeof createApi>;
