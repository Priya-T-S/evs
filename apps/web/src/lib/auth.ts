import { create } from "zustand";
import type { Permission, User } from "@ecopulse/core";
import { api, onAuthLost, tokenStore } from "./api";
import { queryClient } from "./query";

interface AuthState {
  user: User | null;
  status: "unknown" | "authenticated" | "anonymous";
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  bootstrap(): Promise<void>;
  setUser(u: User): void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  status: tokenStore.get().access ? "unknown" : "anonymous",
  async login(email, password) {
    const r = await api.auth.login(email, password);
    queryClient.clear();
    set({ user: r.user, status: "authenticated" });
  },
  async logout() {
    await api.auth.logout();
    queryClient.clear();
    set({ user: null, status: "anonymous" });
  },
  async bootstrap() {
    if (!tokenStore.get().access) {
      set({ status: "anonymous" });
      return;
    }
    try {
      const me = await api.auth.me();
      set({ user: me, status: "authenticated" });
    } catch {
      tokenStore.set(null);
      set({ user: null, status: "anonymous" });
    }
  },
  setUser: (u) => set({ user: u }),
}));

onAuthLost(() => {
  useAuth.setState({ user: null, status: "anonymous" });
});

export function useCan(p: Permission): boolean {
  return useAuth((s) => !!s.user?.permissions.includes(p));
}

export function isStaff(u: User | null): boolean {
  return !!u && u.permissions.includes("incident.view_exact");
}
