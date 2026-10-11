import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, placeFloating } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { prefersReducedMotion } from "@/lib/hooks";
import { markTourSeen, useHelp } from "./help";

interface Step {
  /** Value of the data-tour attribute to highlight. */
  anchor: string;
  title: string;
  body: string;
  /** "inside" centres the popover over a large anchor such as the map. */
  side: "right" | "left" | "bottom" | "top" | "inside";
  /** Runs when the step opens (e.g. open an incident so its actions exist). */
  prepare?: () => void;
}

const STEPS: Step[] = [
  {
    anchor: "queue",
    title: "Most urgent problems first",
    body: "Residents’ reports are grouped into problems and sorted by priority — P1 is critical and needs action within 24 hours. Click any row to see the details.",
    side: "right",
  },
  {
    anchor: "map",
    title: "Coloured dots are problems; shaded areas are hotspots",
    body: "Each dot is a reported problem, coloured by priority. Orange-to-red shading shows how urgent an area is; outlined areas are hotspots where problems cluster.",
    side: "inside",
  },
  {
    anchor: "layers",
    title: "Choose what the map shows",
    body: "Open Layers to switch on air quality, flooding, noise, green cover and more. Each layer has a one-line explanation and a legend.",
    side: "left",
  },
  {
    anchor: "drawer-actions",
    title: "Act on a problem here",
    body: "The details panel shows why a problem is urgent and its history. Use the buttons at the bottom to verify it, assign a team or mark it fixed — each one explains what happens before you confirm.",
    side: "left",
    prepare: () => {
      if (!document.querySelector('[data-tour="drawer-actions"]')) document.querySelector<HTMLButtonElement>("[data-queue-row]")?.click();
    },
  },
  {
    anchor: "search",
    title: "Find a place or a problem",
    body: "Type a neighbourhood, street or reference number (like EP-TXUXBC). Press / to jump here from anywhere, and ? to see all keyboard shortcuts.",
    side: "bottom",
  },
];

const W = 340;

/** First-run welcome tour: highlights one part of the command center at a time. */
export function Tour() {
  const { tour, step, setStep, endTour } = useHelp();
  const user = useAuth((s) => s.user);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const s = STEPS[step];

  const finish = () => {
    if (user) markTourSeen(user.id);
    endTour();
  };

  // Find (and keep tracking) the highlighted element; it may appear a moment later.
  useEffect(() => {
    if (!tour || !s) return;
    s.prepare?.();
    setRect(null);
    setPos(null);
    let scrolled = false;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${s.anchor}"]`);
      if (!el) return;
      if (!scrolled) {
        el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
        scrolled = true;
      }
      const r = el.getBoundingClientRect();
      setRect((prev) => (prev && prev.x === r.x && prev.y === r.y && prev.width === r.width && prev.height === r.height ? prev : r));
    };
    measure();
    const t = setInterval(measure, 150);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, [tour, step]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!pop.current) return;
    const b = pop.current.getBoundingClientRect();
    if (rect && s.side === "inside") setPos({ x: rect.left + (rect.width - b.width) / 2, y: rect.top + (rect.height - b.height) / 2 });
    else if (rect) setPos(placeFloating(rect, b.width, b.height, s.side as "right", 14));
    else setPos({ x: (window.innerWidth - b.width) / 2, y: (window.innerHeight - b.height) / 2 });
  }, [rect, step, s?.side]);

  useEffect(() => {
    if (tour) setTimeout(() => next.current?.focus(), 30);
  }, [tour, step]);

  // Esc ends the tour even when focus has moved outside the popover.
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || pop.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      if (user) markTourSeen(user.id);
      endTour();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tour, user, endTour]);

  if (!tour || !s) return null;
  const last = step === STEPS.length - 1;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      finish();
    } else if (e.key === "ArrowRight" && !last) setStep(step + 1);
    else if (e.key === "ArrowLeft" && step > 0) setStep(step - 1);
    else if (e.key === "Tab" && pop.current) {
      const f = Array.from(pop.current.querySelectorAll<HTMLElement>("button:not([disabled])"));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    }
  };

  const pad = 4;
  return createPortal(
    <>
      {rect && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[240] rounded-md"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            outline: "2px solid var(--focus)",
            boxShadow: "0 0 0 9999px rgba(8, 12, 10, 0.42)",
          }}
        />
      )}
      <div
        ref={pop}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-tour-popover
        onKeyDown={onKeyDown}
        className="fixed z-[250] rounded-md border border-line-strong bg-surface p-4 shadow-2"
        style={{ width: W, left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}
      >
        <p className="eyebrow mb-1">
          Welcome tour · step {step + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="text-[16px] font-semibold leading-snug text-ink">
          {s.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-[14px] leading-[1.5] text-ink-2">
          {s.body}
        </p>
        <div className="mt-2.5 flex gap-1" aria-hidden>
          {STEPS.map((_, i) => (
            <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= step ? "var(--brand)" : "var(--surface-3)" }} />
          ))}
        </div>
        <div className="mt-3.5 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={finish} className="-ml-2">
            Skip tour
          </Button>
          <span className="ml-auto" />
          {step > 0 && (
            <Button size="sm" onClick={() => setStep(step - 1)}>
              Back
            </Button>
          )}
          <Button ref={next} size="sm" variant="primary" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
