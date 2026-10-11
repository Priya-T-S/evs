import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { animate, motion, useDragControls, useMotionValue, useReducedMotion, useTransform, type PanInfo } from "framer-motion";
import { cx } from "./cx";

export type Snap = "peek" | "full";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Accessible name (screen readers announce it as the dialog title). */
  title: string;
  /** "fit": sized to content, drag down to dismiss. "snap": peek ↔ full, used for map selections. */
  mode?: "fit" | "snap";
  snap?: Snap;
  onSnapChange?: (s: Snap) => void;
  peekHeight?: number;
  /** Always-visible top area (drag handle region). */
  header?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Dim the page behind the sheet (fit mode, or snap mode when full). */
  backdrop?: boolean;
  className?: string;
}

const SPRING = { type: "spring", damping: 36, stiffness: 340, mass: 0.9 } as const;

/**
 * Bottom sheet with drag (framer-motion). Header area is the drag handle; in peek state the
 * whole sheet drags. Body scrolls in the full state. 16 px top corners, hairline border.
 */
export function Sheet({
  open,
  onClose,
  title,
  mode = "fit",
  snap = "full",
  onSnapChange,
  peekHeight = 200,
  header,
  children,
  footer,
  backdrop = true,
  className,
}: SheetProps) {
  const [mounted, setMounted] = useState(open);
  const [height, setHeight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(4000);
  const controls = useDragControls();
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: 0 } : SPRING;

  // Peek height is given in px at normal text size; scale it with the Text size setting.
  const scale = typeof window !== "undefined" ? parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1 : 1;
  const peekY = Math.max(0, height - peekHeight * scale);
  const target = mode === "snap" && snap === "peek" ? peekY : 0;

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // Measure (content-sized in fit mode, fixed in snap mode).
  useLayoutEffect(() => {
    if (!mounted || !ref.current) return;
    const el = ref.current;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    setHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, [mounted]);

  // Animate to the target snap / closed position.
  useEffect(() => {
    if (!mounted || !height) return;
    if (open) {
      if (y.get() > height) y.set(height);
      const a = animate(y, target, transition);
      return () => a.stop();
    }
    const a = animate(y, height + 24, { ...transition, ...(reduced ? {} : { damping: 40 }) });
    a.then(() => {
      setMounted(false);
      y.set(4000);
    });
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, height, target]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && mounted) ref.current?.focus({ preventScroll: true });
  }, [open, mounted]);

  useEffect(() => {
    if (snap === "peek" && bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [snap]);

  const onDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const projected = y.get() + info.velocity.y * 0.18;
      const stops: { pos: number; act: () => void }[] =
        mode === "snap"
          ? [
              { pos: 0, act: () => onSnapChange?.("full") },
              { pos: peekY, act: () => onSnapChange?.("peek") },
              { pos: height, act: onClose },
            ]
          : [
              { pos: 0, act: () => undefined },
              { pos: height, act: onClose },
            ];
      const best = stops.reduce((a, b) => (Math.abs(b.pos - projected) < Math.abs(a.pos - projected) ? b : a));
      if (best.pos === target) animate(y, target, transition);
      best.act();
    },
    [mode, peekY, height, target, onSnapChange, onClose, transition, y],
  );

  const dimRange = mode === "snap" ? [0, Math.max(1, peekY)] : [0, Math.max(1, height)];
  const dim = useTransform(y, dimRange, [0.34, 0]);

  if (!mounted) return null;

  const isPeek = mode === "snap" && snap === "peek";
  const startDrag = (e: React.PointerEvent) => controls.start(e);

  return createPortal(
    <div className="fixed inset-x-0 top-0 z-40 pointer-events-none overflow-hidden" style={{ bottom: "var(--sheet-bottom)" }}>
      {backdrop && (
        <motion.div
          aria-hidden
          className="absolute inset-0 bg-black pointer-events-auto"
          style={{ opacity: dim, pointerEvents: isPeek || !open ? "none" : "auto" }}
          onClick={() => (mode === "snap" ? onSnapChange?.("peek") : onClose())}
        />
      )}
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal={!isPeek}
        aria-label={title}
        tabIndex={-1}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: height }}
        dragElastic={{ top: 0.04, bottom: 0.4 }}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        style={{
          y,
          height: mode === "snap" ? "calc(100% - env(safe-area-inset-top) - 10px)" : undefined,
          maxHeight: "calc(100% - env(safe-area-inset-top) - 10px)",
        }}
        className={cx(
          "absolute inset-x-0 bottom-0 flex flex-col bg-surface border-t border-line rounded-t-[16px] shadow-[0_-6px_24px_rgba(22,32,27,0.10)] pointer-events-auto outline-none",
          className,
        )}
      >
        <div className="shrink-0 touch-none" onPointerDown={startDrag}>
          <button
            type="button"
            className="flex w-full justify-center pt-2 pb-1.5"
            aria-label={mode === "snap" ? (isPeek ? "Expand details" : "Collapse") : "Close"}
            onClick={() => (mode === "snap" ? onSnapChange?.(isPeek ? "full" : "peek") : onClose())}
          >
            <span className="block w-9 h-[5px] rounded-full bg-line-strong" />
          </button>
          {header}
        </div>
        <div
          ref={bodyRef}
          className={cx("min-h-0 flex-1", isPeek ? "overflow-hidden touch-none" : "scroll-area")}
          onPointerDown={isPeek ? startDrag : undefined}
          onClick={isPeek ? () => onSnapChange?.("full") : undefined}
        >
          {children}
        </div>
        {footer && <div className="shrink-0 border-t border-line px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </motion.div>
    </div>,
    // Portal into #root (not body) so sheets stay inside the centred column on desktop.
    document.getElementById("root") ?? document.body,
  );
}

/** Standard sheet title row. */
export function SheetTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="px-4 pb-3">
      <h2 className="text-[1.2188rem] font-semibold leading-6 text-ink">{children}</h2>
      {sub && <div className="mt-0.5 text-[0.9063rem] text-ink-3">{sub}</div>}
    </div>
  );
}
