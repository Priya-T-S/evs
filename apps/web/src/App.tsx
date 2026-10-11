import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import type { Permission } from "@ecopulse/core";
import { queryClient } from "@/lib/query";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { AppShell } from "@/components/layout/AppShell";
import { EmptyState, Skeleton } from "@/components/ui";
import { ShieldOff } from "lucide-react";

const Login = lazy(() => import("@/pages/Login"));
const CommandCenter = lazy(() => import("@/features/command/CommandCenter"));
const Hotspots = lazy(() => import("@/pages/Hotspots"));
const Recommendations = lazy(() => import("@/pages/Recommendations"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Assistant = lazy(() => import("@/pages/Assistant"));
const Admin = lazy(() => import("@/pages/Admin"));

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const loc = useLocation();
  if (status === "unknown")
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <Skeleton className="h-2 w-40" />
      </div>
    );
  if (status === "anonymous") return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function RequirePerm({ any, children }: { any: Permission[]; children: ReactNode }) {
  const perms = useAuth((s) => s.user?.permissions ?? []);
  if (!any.some((p) => perms.includes(p)))
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState icon={<ShieldOff className="size-5" />} title="You don’t have access to this page" hint="Ask an administrator if you need this permission." />
      </div>
    );
  return <>{children}</>;
}

export function App() {
  const bootstrap = useAuth((s) => s.bootstrap);
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    bootstrap();
  }, [bootstrap]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <Suspense fallback={null}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<CommandCenter />} />
              <Route path="hotspots" element={<Hotspots />} />
              <Route path="recommendations" element={<Recommendations />} />
              <Route
                path="analytics"
                element={
                  <RequirePerm any={["analytics.view"]}>
                    <Analytics />
                  </RequirePerm>
                }
              />
              <Route path="assistant" element={<Assistant />} />
              <Route
                path="admin"
                element={
                  <RequirePerm any={["users.manage", "audit.view", "jobs.run"]}>
                    <Admin />
                  </RequirePerm>
                }
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          </Suspense>
        </BrowserRouter>
      </MotionConfig>
    </QueryClientProvider>
  );
}
