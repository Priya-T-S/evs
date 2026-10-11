import { RealtimeClient, wsUrlFrom, type RealtimeStatus } from "@ecopulse/core";
import { useEffect, useState } from "react";
import { API_BASE, tokenStore } from "./api";

/** One WebSocket for the whole app. Restarted on login/logout so it carries the right token. */
export const realtime = new RealtimeClient(wsUrlFrom(API_BASE), () => tokenStore.get().access);

export function useRealtimeStatus(): RealtimeStatus {
  const [s, setS] = useState<RealtimeStatus>(realtime.status);
  useEffect(() => realtime.onStatus(setS) as () => void, []);
  return s;
}
