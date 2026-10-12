import { useEffect, useState, lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation as useRoute, useNavigate } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { App as CapApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { queryClient, persister, PERSISTED_KEYS } from "./lib/queryClient";
import { useApp } from "./lib/store";
import { useApplyTheme } from "./lib/theme";
import { useLocation } from "./lib/location";
import { startNetworkWatch } from "./lib/network";
import { startOutboxWorker } from "./lib/outbox";
import { useMe, useMeta } from "./lib/queries";
import { useUi } from "./lib/ui";
import { api } from "./lib/api";
import { TabBar } from "./components/TabBar";
import { RealtimeBridge } from "./components/RealtimeBridge";
import { IncidentSheetHost } from "./components/IncidentSheet";
import { Toaster } from "./components/ui";
import { Onboarding } from "./screens/Onboarding";
import { HomeScreen } from "./screens/Home";
import { PulseScreen } from "./screens/Pulse";
import { ProfileScreen } from "./screens/Profile";
import { InboxScreen } from "./screens/Inbox";
import { PrivacyScreen, SourcesScreen } from "./screens/Info";
import { AccountScreen } from "./screens/Account";
import { HelpScreen, HowItWorksScreen } from "./screens/Help";
import { DrivesScreen, NewDriveScreen } from "./screens/Drives";

import ReportFlow from "./screens/Report";

// The report flow is bundled eagerly so it works offline; the map (MapLibre, ~1 MB) is
// lazy-loaded but prefetched right after start-up so it is cached before connectivity drops.
const loadMap = () => import("./screens/Map");
const MapScreen = lazy(loadMap);
if (typeof window !== "undefined") setTimeout(() => void loadMap().catch(() => undefined), 1500);

const TAB_PATHS = ["/", "/map", "/pulse", "/profile"];

export function App() {
  const hydrated = useHydrated();
  useApplyTheme();
  const textSize = useApp((s) => s.textSize);
  useEffect(() => {
    document.documentElement.dataset.textSize = textSize;
  }, [textSize]);
  if (!hydrated) return <div className="h-full bg-bg" />;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        buster: "m1",
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.status === "success" && PERSISTED_KEYS.has(String(q.queryKey[0])) },
      }}
    >
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </PersistQueryClientProvider>
  );
}

function useHydrated() {
  const [h, setH] = useState(useApp.persist.hasHydrated());
  useEffect(() => {
    if (h) return;
    const off = useApp.persist.onFinishHydration(() => setH(true));
    setH(useApp.persist.hasHydrated());
    return off;
  }, [h]);
  return h;
}

function Root() {
  const access = useApp((s) => s.access);
  const onboarded = useApp((s) => s.onboarded);
  useBootstrap();
  if (!access || !onboarded) {
    return (
      <>
        <Onboarding />
        <Toaster />
      </>
    );
  }
  return <Shell />;
}

function useBootstrap() {
  const meta = useMeta();
  const setCenter = useLocation((s) => s.setCenter);
  useEffect(() => {
    startNetworkWatch();
    startOutboxWorker();
  }, []);
  useEffect(() => {
    if (meta.data?.city.center) setCenter(meta.data.city.center);
  }, [meta.data, setCenter]);
  // Locate on start and on resume, but only after the user has seen why we need it.
  useEffect(() => {
    const locate = () => useApp.getState().locationExplained && useLocation.getState().locate({ highAccuracy: false });
    locate();
    const sub = CapApp.addListener("appStateChange", (s) => s.isActive && locate());
    return () => {
      sub.then((h) => h.remove()).catch(() => undefined);
    };
  }, []);
}

function Shell() {
  const route = useRoute();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const path = route.pathname;
  const isTab = TAB_PATHS.includes(path);
  const [mapVisited, setMapVisited] = useState(path === "/map");
  useMe();
  usePush();

  useEffect(() => {
    if (path === "/map") setMapVisited(true);
    document.documentElement.classList.toggle("no-tabbar", !isTab);
  }, [path, isTab]);

  // Android hardware back: close the sheet first, then go back, then exit.
  useEffect(() => {
    const sub = CapApp.addListener("backButton", () => {
      const ui = useUi.getState();
      if (ui.incidentId) return ui.closeIncident();
      if (path !== "/") navigate(-1);
      else CapApp.exitApp();
    });
    return () => {
      sub.then((h) => h.remove()).catch(() => undefined);
    };
  }, [path, navigate]);

  const push = !isTab;
  const variants = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : path === "/report"
      ? { initial: { opacity: 0, y: 28 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } }
      : push
        ? { initial: { opacity: 0, x: 28 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0 } }
        : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0 } };

  return (
    <div className="relative h-full overflow-hidden bg-bg">
      <RealtimeBridge />
      {mapVisited && (
        <Suspense fallback={null}>
          <MapScreen active={path === "/map"} />
        </Suspense>
      )}
      <AnimatePresence mode="popLayout" initial={false}>
        {path !== "/map" && (
          <motion.main
            key={path}
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: reduced ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-x-0 top-0 z-10 bg-bg"
            style={{ bottom: isTab ? "var(--tabbar-h)" : 0 }}
          >
            <Suspense fallback={<div className="h-full bg-bg" />}>
              <Routes location={route}>
                <Route path="/" element={<HomeScreen />} />
                <Route path="/pulse" element={<PulseScreen />} />
                <Route path="/profile" element={<ProfileScreen />} />
                <Route path="/inbox" element={<InboxScreen />} />
                <Route path="/report" element={<ReportFlow />} />
                <Route path="/profile/privacy" element={<PrivacyScreen />} />
                <Route path="/profile/sources" element={<SourcesScreen />} />
                <Route path="/profile/help" element={<HelpScreen />} />
                <Route path="/profile/how" element={<HowItWorksScreen />} />
                <Route path="/account" element={<AccountScreen />} />
                <Route path="/drives" element={<DrivesScreen />} />
                <Route path="/drives/new" element={<NewDriveScreen />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </motion.main>
        )}
      </AnimatePresence>
      {isTab && <TabBar />}
      {path !== "/map" && <IncidentSheetHost />}
      <Toaster />
    </div>
  );
}

/** Register for push only inside the native app; the token goes to PATCH /auth/me. */
function usePush() {
  const access = useApp((s) => s.access);
  useEffect(() => {
    if (!access || !Capacitor.isNativePlatform()) return;
    let cancelled = false;
    (async () => {
      try {
        const perm = await PushNotifications.requestPermissions();
        if (perm.receive !== "granted" || cancelled) return;
        await PushNotifications.addListener("registration", (t) => {
          api.auth.updateMe({ push_token: t.value }).catch(() => undefined);
        });
        await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
          const id = (a.notification.data as Record<string, string> | undefined)?.incident_id;
          if (id) useUi.getState().openIncident(id);
        });
        await PushNotifications.register();
      } catch {
        /* push not configured (no google-services.json / APNs) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [access]);
}
