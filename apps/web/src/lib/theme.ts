import { create } from "zustand";

export type Theme = "dark" | "light";

/**
 * Theme follows the operating system (light or dark) until the user picks one with the
 * toggle; that explicit choice is remembered. A new key is used so the old always-dark
 * default that was saved for every visitor no longer overrides the system preference.
 */
const KEY = "ecopulse.theme.choice";

const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
const system = (): Theme => (mq?.matches ? "dark" : "light");

function readChoice(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null;
  }
}

function apply(t: Theme) {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = t;
}

interface ThemeState {
  theme: Theme;
  /** True when the user chose a theme; false while following the system. */
  explicit: boolean;
  toggle(): void;
}

const initialChoice = readChoice();
const initial = initialChoice ?? system();
apply(initial);

export const useTheme = create<ThemeState>()((set, get) => ({
  theme: initial,
  explicit: initialChoice != null,
  toggle: () => {
    const theme: Theme = get().theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* storage unavailable: the choice lasts for this session only */
    }
    apply(theme);
    set({ theme, explicit: true });
  },
}));

// Follow live OS changes while the user hasn't made an explicit choice.
mq?.addEventListener?.("change", () => {
  if (useTheme.getState().explicit) return;
  const t = system();
  apply(t);
  useTheme.setState({ theme: t });
});
