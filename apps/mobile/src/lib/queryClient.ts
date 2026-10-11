import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { ApiError } from "@ecopulse/core";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: true,
      networkMode: "offlineFirst",
      retry: (count, err) => {
        if (err instanceof ApiError && (err.isNetwork || err.status === 401 || err.status === 404)) return false;
        return count < 2;
      },
    },
    mutations: { networkMode: "always" },
  },
});

/** Last-known data stays readable offline (Home, Pulse, Profile). */
export const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: "ecopulse-query-cache",
  throttleTime: 2000,
});

export const PERSISTED_KEYS = new Set(["meta", "score", "nearby", "pulse", "me", "notifications", "myReports", "points", "layers", "sources"]);
