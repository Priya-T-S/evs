import { useEffect, useSyncExternalStore } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function useTheme(): "light" | "dark" {
  return useSyncExternalStore(
    (cb) => {
      mq?.addEventListener("change", cb);
      return () => mq?.removeEventListener("change", cb);
    },
    () => (mq?.matches ? "dark" : "light"),
  );
}

/** Light by default; dark follows the system setting. Applies data-theme + native status bar. */
export function useApplyTheme() {
  const theme = useTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: theme === "dark" ? Style.Dark : Style.Light }).catch(() => undefined);
    }
  }, [theme]);
  return theme;
}
