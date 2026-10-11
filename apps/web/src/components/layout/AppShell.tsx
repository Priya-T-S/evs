import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, Compass, ExternalLink, Flame, Keyboard, LayoutGrid, Lightbulb, LogOut, MessageSquareText, Moon, Settings2, Sun } from "lucide-react";
import type { AlertEventData, IncidentEventData, Permission, RealtimeEvent, ScoreEventData } from "@ecopulse/core";
import { isStaff, useAuth } from "@/lib/auth";
import { realtime, useRealtimeStatus } from "@/lib/realtime";
import { patchQueues, useLive } from "@/lib/live";
import { incidentSel, useSelection } from "@/lib/selection";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/cn";
import { IconButton, Skeleton, Toaster, toast } from "@/components/ui";
import { CITIZEN_APP_URL, useHelp } from "@/features/help/help";
import { ShortcutsDialog } from "@/features/help/Shortcuts";

const NAV: { to: string; label: string; icon: typeof LayoutGrid; perm?: Permission }[] = [
  { to: "/", label: "Command center — queue and map", icon: LayoutGrid },
  { to: "/hotspots", label: "Hotspots — where problems cluster", icon: Flame },
  { to: "/recommendations", label: "Recommendations — suggested actions", icon: Lightbulb },
  { to: "/analytics", label: "Analytics — trends and team workload", icon: BarChart3, perm: "analytics.view" },
  { to: "/assistant", label: "Assistant — ask questions about the data", icon: MessageSquareText },
  { to: "/admin", label: "Admin — users, audit log, data jobs", icon: Settings2 },
];

const ADMIN_PERMS: Permission[] = ["users.manage", "audit.view", "jobs.run"];

export function AppShell() {
  const user = useAuth((s) => s.user);
  const perms = user?.permissions ?? [];
  const nav = NAV.filter((n) => (n.to === "/admin" ? ADMIN_PERMS.some((p) => perms.includes(p)) : !n.perm || perms.includes(n.perm)));

  return (
    <div className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:m-2 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <nav aria-label="Primary" className="flex w-[56px] shrink-0 flex-col items-center border-r border-line bg-surface py-3">
        <NavLink to="/" aria-label="EcoPulse home" className="mb-4 flex size-8 items-center justify-center rounded-sm bg-brand text-brand-ink">
          <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
            <path d="M5 17h5l3-7 5 13 3-6h6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </NavLink>
        <ul className="flex flex-col gap-1">
          {nav.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                end={n.to === "/"}
                title={n.label}
                aria-label={n.label}
                className={({ isActive }) =>
                  cn(
                    "group relative flex size-10 items-center justify-center rounded-sm transition-colors",
                    isActive ? "bg-surface-3 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink-2",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute -left-2 top-2 bottom-2 w-[2px] rounded-full bg-brand" aria-hidden />}
                    <n.icon className="size-[18px]" strokeWidth={1.75} />
                    <span className="pointer-events-none absolute left-full ml-2 hidden whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-[12.5px] text-bg group-hover:block group-focus-visible:block z-50">
                      {n.label}
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<PageSkeleton />}>
          <Outlet />
        </Suspense>
      </div>
      <RealtimeBridge />
      <LiveRegion />
      <Toaster />
      <ShortcutsDialog />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="flex h-full flex-col">
      <div className="h-12 border-b border-line bg-surface" />
      <div className="flex-1 p-6 space-y-3">
        <Skeleton className="h-6 w-60" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ top bar */

export function TopBar({ title, children, right }: { title?: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-surface pl-4 pr-3" role="banner">
      <div className="flex min-w-0 items-baseline gap-2 shrink-0">
        <span className="text-[14px] font-semibold tracking-[-0.01em]">Bengaluru</span>
        {title && <span className="text-[14px] text-ink-3 truncate">{title}</span>}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-4">{children}</div>
      <div className="flex shrink-0 items-center gap-1">
        {right}
        <RealtimeIndicator />
        <HelpMenu />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

export function RealtimeIndicator() {
  const s = useRealtimeStatus();
  const meta = {
    live: { label: "Live", color: "var(--ok)", hint: "Live: new reports and status changes appear automatically" },
    connecting: { label: "Connecting", color: "var(--p3)", hint: "Connecting for live updates…" },
    reconnecting: { label: "Reconnecting", color: "var(--p3)", hint: "Connection lost — retrying. The page may be slightly out of date." },
    offline: { label: "Offline", color: "var(--ink-3)", hint: "Not receiving live updates. Reload the page to refresh." },
  }[s];
  return (
    <span className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[12.5px] text-ink-2" title={meta.hint} role="status" aria-live="polite">
      <span className={cn("size-[7px] rounded-full", s === "live" && "live-dot")} style={{ background: meta.color }} aria-hidden />
      {meta.label}
    </span>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggle}>
      {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </IconButton>
  );
}

/** Help button: replay the tour, list keyboard shortcuts, or open the citizen app. */
function HelpMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const item = "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[14px] text-ink-2 hover:bg-surface-2 hover:text-ink";
  return (
    <div ref={ref} className="relative">
      <IconButton label="Help and tour" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} active={open}>
        <span className="flex size-[18px] items-center justify-center rounded-full border-[1.5px] border-current text-[11.5px] font-semibold leading-none" aria-hidden>
          ?
        </span>
      </IconButton>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-line-strong bg-surface py-1 shadow-2">
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              navigate("/");
              useHelp.getState().startTour();
            }}
          >
            <Compass className="size-4 shrink-0" />
            <span className="flex-1">Take the welcome tour</span>
          </button>
          <button
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              useHelp.getState().setShortcuts(true);
            }}
          >
            <Keyboard className="size-4 shrink-0" />
            <span className="flex-1">Keyboard shortcuts</span>
            <kbd className="num rounded-[3px] border border-line-strong px-1 text-[11.5px] text-ink-3">?</kbd>
          </button>
          <a role="menuitem" className={item} href={CITIZEN_APP_URL} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4 shrink-0" />
            <span className="flex-1">Open the citizen app</span>
          </a>
          <p className="border-t border-line px-3 py-2 text-[12.5px] leading-snug text-ink-3">Hover or focus any small “?” for a plain-language explanation.</p>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!user) return null;
  const initials = user.display_name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu: ${user.display_name}`}
        title={`${user.display_name} · ${user.role}`}
        className="ml-1 flex h-8 items-center gap-2 rounded-sm pl-1 pr-2 hover:bg-surface-3"
      >
        <span className="flex size-6 items-center justify-center rounded-full bg-brand-soft text-[11.5px] font-semibold text-brand">{initials}</span>
        <span className="hidden min-[1400px]:flex flex-col items-start leading-tight">
          <span className="text-[13px] text-ink">{user.display_name}</span>
          <span className="text-[11.5px] text-ink-3 capitalize">{user.role}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-line-strong bg-surface py-1 shadow-2">
          <div className="px-3 py-2 border-b border-line">
            <p className="text-[14px] font-medium">{user.display_name}</p>
            <p className="text-[12.5px] text-ink-3">{user.email}</p>
            <p className="mt-1 text-[12.5px] text-ink-2">
              <span className="capitalize">{user.role}</span>
              {user.team && <> · {user.team}</>}
            </p>
          </div>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-[14px] text-ink-2 hover:bg-surface-2 hover:text-ink"
            onClick={() => {
              setOpen(false);
              navigate("/");
              useHelp.getState().startTour();
            }}
          >
            <Compass className="size-3.5" /> Show tour
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-[14px] text-ink-2 hover:bg-surface-2 hover:text-ink"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ realtime bridge */

/**
 * Owns the app's single realtime connection: (re)connects with the current token whenever
 * the signed-in user changes, keeps server-state caches fresh, and raises alerts.
 */
function RealtimeBridge() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { markFlash, announce } = useLive.getState();

  useEffect(() => {
    if (!user) return;
    realtime.subscribe({ topics: isStaff(user) ? ["org"] : ["pulse", "alerts", "scores"] });
    realtime.connect();
    return () => realtime.close();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let pulseTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshPulse = () => {
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => qc.invalidateQueries({ queryKey: ["pulse"] }), 1200);
    };
    const onIncident = (e: RealtimeEvent<IncidentEventData>) => {
      patchQueues(qc, e);
      markFlash(e.data.id);
      qc.invalidateQueries({ queryKey: ["incident", e.data.id] });
      refreshPulse();
      if (e.type === "incident.created" && e.data.priority === "P1") {
        announce(`New critical problem reported: ${e.data.title}${e.data.location_name ? `, ${e.data.location_name}` : ""}.`);
      }
    };
    const offs = [
      realtime.on<IncidentEventData>("incident.created", onIncident),
      realtime.on<IncidentEventData>("incident.updated", onIncident),
      realtime.on<IncidentEventData>("incident.resolved", onIncident),
      realtime.on("hotspot.created", () => qc.invalidateQueries({ queryKey: ["hotspots"] })),
      realtime.on("hotspot.updated", () => qc.invalidateQueries({ queryKey: ["hotspots"] })),
      realtime.on("hotspot.cooled", () => qc.invalidateQueries({ queryKey: ["hotspots"] })),
      realtime.on<ScoreEventData>("environmental_score.updated", (e) => {
        qc.invalidateQueries({ queryKey: ["score", e.data.location_id] });
        qc.invalidateQueries({ queryKey: ["scores"] });
      }),
      realtime.on<AlertEventData>("alert.created", (e) => {
        const d = e.data;
        announce(`Critical alert: ${d.title}${d.location_name ? `, ${d.location_name}` : ""}.`);
        toast({
          tone: "critical",
          title: d.title,
          body: d.location_name ?? undefined,
          action: {
            label: "Open this problem",
            onClick: () => {
              navigate("/");
              const geo = e.geo;
              useSelection.getState().select(incidentSel({ id: d.incident_id, lon: geo?.lon ?? 0, lat: geo?.lat ?? 0 }), { fly: !!geo });
            },
          },
        });
      }),
      realtime.on("resync", () => qc.invalidateQueries()),
    ];
    return () => {
      offs.forEach((o) => o());
      if (pulseTimer) clearTimeout(pulseTimer);
    };
  }, [qc, navigate, markFlash, announce]);

  return null;
}

function LiveRegion() {
  const msg = useLive((s) => s.announcement);
  return (
    <div className="sr-only" aria-live="polite" aria-atomic="true">
      {msg}
    </div>
  );
}
