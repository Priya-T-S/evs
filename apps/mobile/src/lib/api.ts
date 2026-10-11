import { ApiError, createApi } from "@ecopulse/core";
import { API_BASE } from "./config";
import { useApp } from "./store";

export const api = createApi({
  baseUrl: API_BASE,
  tokens: {
    get: () => {
      const s = useApp.getState();
      return { access: s.access, refresh: s.refresh };
    },
    set: (t) => useApp.getState().setTokens(t),
  },
  onAuthLost: () => useApp.getState().signOut(),
});

export function isNetworkError(e: unknown): boolean {
  return e instanceof ApiError ? e.isNetwork : e instanceof TypeError;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.isNetwork ? "No connection to EcoPulse." : e.message;
  return (e as Error)?.message ?? "Something went wrong.";
}

/** Absolute URL for media paths returned by the API (may be relative to the API host). */
export function mediaUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (/^(https?:|data:|blob:)/.test(u)) return u;
  return `${API_BASE}${u.startsWith("/") ? "" : "/"}${u}`;
}
