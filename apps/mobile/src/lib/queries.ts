import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { bboxParam, haversine, type Incident } from "@ecopulse/core";
import { api } from "./api";
import { bboxAround } from "./geo";
import { NEARBY_RADIUS_M, PULSE_RADIUS_M } from "./config";
import { useApp } from "./store";
import type { Position } from "./store";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: 6 * 60 * 60 * 1000 });

export function useMe() {
  const access = useApp((s) => s.access);
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const u = await api.auth.me();
      useApp.getState().setUser(u);
      return u;
    },
    enabled: !!access,
    initialData: () => useApp.getState().user ?? undefined,
    initialDataUpdatedAt: 0,
  });
}

export const useScore = (p: Position) =>
  useQuery({
    queryKey: ["score", r3(p.lat), r3(p.lon)],
    queryFn: () => api.scores.at(p.lat, p.lon),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

export type NearbyIncident = Incident & { distance_m: number };

export const useNearby = (p: Position) =>
  useQuery({
    queryKey: ["nearby", r3(p.lat), r3(p.lon)],
    queryFn: async (): Promise<NearbyIncident[]> => {
      const res = await api.incidents.list({ bbox: bboxParam(bboxAround(p.lat, p.lon, NEARBY_RADIUS_M)), status: "open", sort: "risk", limit: 20 });
      return res.items
        .map((i) => ({ ...i, distance_m: haversine(p.lat, p.lon, i.lat, i.lon) }))
        .sort((a, b) => a.distance_m - b.distance_m);
    },
    placeholderData: keepPreviousData,
  });

export const usePulse = (scope: "near" | "city", p: Position) =>
  useQuery({
    queryKey: ["pulse", scope, scope === "near" ? r3(p.lat) : 0, scope === "near" ? r3(p.lon) : 0],
    queryFn: () => api.pulse(scope === "near" ? { lat: p.lat, lon: p.lon, radius_m: PULSE_RADIUS_M } : {}),
    placeholderData: keepPreviousData,
  });

export function useNotifications() {
  const access = useApp((s) => s.access);
  return useQuery({ queryKey: ["notifications"], queryFn: api.notifications.list, enabled: !!access, refetchInterval: 120_000 });
}

export function useMyReports() {
  const access = useApp((s) => s.access);
  return useQuery({ queryKey: ["myReports"], queryFn: () => api.reports.mine(), enabled: !!access });
}

export function usePoints() {
  const access = useApp((s) => s.access);
  return useQuery({ queryKey: ["points"], queryFn: api.auth.points, enabled: !!access });
}

export const useLayers = () => useQuery({ queryKey: ["layers"], queryFn: api.map.layers, staleTime: 6 * 60 * 60 * 1000 });

export const useSources = () => useQuery({ queryKey: ["sources"], queryFn: api.external.status, staleTime: 5 * 60_000 });

export const useIncident = (id: string | null) =>
  useQuery({ queryKey: ["incident", id], queryFn: () => api.incidents.get(id!), enabled: !!id });

export const useHotspot = (id: string | null) =>
  useQuery({ queryKey: ["hotspot", id], queryFn: () => api.hotspots.get(id!), enabled: !!id });
