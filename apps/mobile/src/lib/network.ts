import { create } from "zustand";
import { Network } from "@capacitor/network";

interface NetState {
  online: boolean;
}

export const useNetwork = create<NetState>(() => ({
  online: typeof navigator === "undefined" ? true : navigator.onLine,
}));

const listeners = new Set<(online: boolean) => void>();
export function onOnlineChange(fn: (online: boolean) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(online: boolean) {
  if (useNetwork.getState().online === online) return;
  useNetwork.setState({ online });
  listeners.forEach((fn) => fn(online));
}

let started = false;
export function startNetworkWatch() {
  if (started) return;
  started = true;
  Network.getStatus()
    .then((s) => set(s.connected))
    .catch(() => undefined);
  Network.addListener("networkStatusChange", (s) => set(s.connected)).catch(() => undefined);
  // Belt and braces for browsers where the plugin is not wired.
  window.addEventListener("online", () => set(true));
  window.addEventListener("offline", () => set(false));
}

export const isOnline = () => useNetwork.getState().online;
