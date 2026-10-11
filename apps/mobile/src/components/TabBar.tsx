import { NavLink, useNavigate } from "react-router-dom";
import { Activity, Home, Map, Plus, UserRound } from "lucide-react";
import { haptic } from "../lib/haptics";
import { cx } from "./ui";

const TABS = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/map", label: "Map", icon: Map },
  { to: "/report", label: "Report", icon: Plus, primary: true },
  { to: "/pulse", label: "Activity", icon: Activity },
  { to: "/profile", label: "Profile", icon: UserRound },
];

export function TabBar() {
  const navigate = useNavigate();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 bg-surface border-t border-line pb-safe"
      style={{ height: "var(--tabbar-h)" }}
    >
      <ul className="grid h-16 grid-cols-5">
        {TABS.map((t) =>
          t.primary ? (
            <li key={t.to} className="flex items-center justify-center">
              <button
                type="button"
                onClick={() => {
                  haptic.medium();
                  navigate("/report");
                }}
                aria-label="Report a problem"
                className="pressable flex h-[3.25rem] w-[4.25rem] flex-col items-center justify-center gap-0.5 rounded-md bg-brand text-brand-ink active:bg-brand-2"
              >
                <t.icon size={22} strokeWidth={2.4} aria-hidden />
                <span className="text-[0.8125rem] font-medium leading-none">{t.label}</span>
              </button>
            </li>
          ) : (
            <li key={t.to}>
              <NavLink
                to={t.to}
                end={t.end}
                replace
                onClick={() => haptic.select()}
                className={({ isActive }) =>
                  cx("flex h-full flex-col items-center justify-center gap-1 text-[0.8125rem] font-medium", isActive ? "text-brand" : "text-ink-3")
                }
              >
                {({ isActive }) => (
                  <>
                    <t.icon size={22} strokeWidth={isActive ? 2.2 : 1.8} aria-hidden />
                    <span>{t.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
