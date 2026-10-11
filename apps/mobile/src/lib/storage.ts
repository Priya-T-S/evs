import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { StateStorage } from "zustand/middleware";

/**
 * Durable key/value storage for persisted app state. On native we use Capacitor Preferences
 * (survives WebView storage eviction on iOS); on the web, localStorage.
 */
export const durableStorage: StateStorage = Capacitor.isNativePlatform()
  ? {
      getItem: async (name) => (await Preferences.get({ key: name })).value,
      setItem: async (name, value) => Preferences.set({ key: name, value }),
      removeItem: async (name) => Preferences.remove({ key: name }),
    }
  : {
      getItem: (name) => {
        try {
          return localStorage.getItem(name);
        } catch {
          return null;
        }
      },
      setItem: (name, value) => {
        try {
          localStorage.setItem(name, value);
        } catch {
          /* storage full or blocked */
        }
      },
      removeItem: (name) => {
        try {
          localStorage.removeItem(name);
        } catch {
          /* ignore */
        }
      },
    };
