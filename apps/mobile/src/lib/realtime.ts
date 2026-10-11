import { useSyncExternalStore } from "react";
import { RealtimeClient, wsUrlFrom, type EcoMapController, type RealtimeStatus } from "@ecopulse/core";
import { API_BASE } from "./config";
import { useApp } from "./store";

/** One WebSocket for the whole app. The token is read on every (re)connect. */
export const realtime = new RealtimeClient(wsUrlFrom(API_BASE), () => useApp.getState().access);

export function useRealtimeStatus(): RealtimeStatus {
  return useSyncExternalStore(
    (cb) => realtime.onStatus(cb),
    () => realtime.status,
  );
}

/** The live map controller (set by the Map screen) so realtime events can be applied to it. */
export const mapBridge: { controller: EcoMapController | null } = { controller: null };
