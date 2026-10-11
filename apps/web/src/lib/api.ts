import { createApi, type TokenStore } from "@ecopulse/core";

export const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "http://localhost:8000";

const KEY = "ecopulse.tokens";

/** Tokens persist in localStorage so a reload keeps the session (refresh rotates them). */
export const tokenStore: TokenStore & { subscribe(fn: () => void): () => void } = (() => {
  let cache: { access: string | null; refresh: string | null } = { access: null, refresh: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) cache = JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  const subs = new Set<() => void>();
  return {
    get: () => cache,
    set(t) {
      cache = t ? { access: t.access, refresh: t.refresh } : { access: null, refresh: null };
      try {
        if (t) localStorage.setItem(KEY, JSON.stringify(cache));
        else localStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
      subs.forEach((fn) => fn());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
})();

let authLostHandler: (() => void) | null = null;
export const onAuthLost = (fn: () => void) => (authLostHandler = fn);

export const api = createApi({
  baseUrl: API_BASE,
  tokens: tokenStore,
  onAuthLost: () => authLostHandler?.(),
});
