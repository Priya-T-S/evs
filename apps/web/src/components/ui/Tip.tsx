import { Fragment, cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type Side = "top" | "bottom" | "right" | "left";

/** Place a floating box next to an anchor rect, flipping/clamping to stay on screen. */
export function placeFloating(a: DOMRect, w: number, h: number, side: Side, gap = 8) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 8;
  let s = side;
  if (s === "top" && a.top - h - gap < m) s = "bottom";
  else if (s === "bottom" && a.bottom + h + gap > vh - m) s = "top";
  else if (s === "right" && a.right + w + gap > vw - m) s = "left";
  else if (s === "left" && a.left - w - gap < m) s = "right";
  let x: number;
  let y: number;
  if (s === "top" || s === "bottom") {
    x = a.left + a.width / 2 - w / 2;
    y = s === "top" ? a.top - h - gap : a.bottom + gap;
  } else {
    x = s === "right" ? a.right + gap : a.left - w - gap;
    y = a.top + a.height / 2 - h / 2;
  }
  return { x: Math.max(m, Math.min(vw - w - m, x)), y: Math.max(m, Math.min(vh - h - m, y)) };
}

function Floating({ anchor, side, id, children, width }: { anchor: HTMLElement; side: Side; id: string; children: ReactNode; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(placeFloating(anchor.getBoundingClientRect(), r.width, r.height, side));
  }, [anchor, side, children]);
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      id={id}
      className="pointer-events-none fixed z-[300] rounded-sm border border-line-strong bg-surface px-2.5 py-2 text-[13px] leading-[1.45] text-ink shadow-2"
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, maxWidth: width, width: "max-content" }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Hover/focus tooltip rendered in a portal (never clipped by scrolling panels).
 * The trigger gets aria-describedby so screen readers read the explanation too.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
  width = 280,
  as = "span",
  focusable,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: Side;
  className?: string;
  width?: number;
  /** Wrapper element; use "div" where a span isn't allowed (e.g. inside a dl). */
  as?: "span" | "div";
  /** Make the wrapper itself keyboard-focusable (when the children aren't). */
  focusable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 120);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const describe = !focusable && isValidElement(children) && children.type !== Fragment;
  const child = describe ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, { "aria-describedby": open ? id : undefined }) : children;
  const Tag = as;
  return (
    <Tag
      ref={wrap as never}
      className={cn("inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={focusable ? 0 : undefined}
      aria-describedby={focusable && open ? id : undefined}
    >
      {child}
      {open && wrap.current && (
        <Floating anchor={wrap.current} side={side} id={id} width={width}>
          {content}
        </Floating>
      )}
    </Tag>
  );
}

/**
 * Small "?" button that explains the thing next to it. Opens on hover, keyboard focus or
 * click (click pins it open until clicking elsewhere or pressing Esc).
 */
export function InfoTip({ children, label, side = "top", className, width = 300 }: { children: ReactNode; label: string; side?: Side; className?: string; width?: number }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const open = hover || pinned;
  const close = useCallback(() => {
    setPinned(false);
    setHover(false);
  }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const out = (e: MouseEvent) => !btn.current?.contains(e.target as Node) && close();
    window.addEventListener("keydown", esc, true);
    document.addEventListener("mousedown", out);
    return () => {
      window.removeEventListener("keydown", esc, true);
      document.removeEventListener("mousedown", out);
    };
  }, [open, close]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`What is “${label}”?`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        data-infotip
        onClick={(e) => {
          e.stopPropagation();
          setPinned((p) => !p);
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={() => setHover(false)}
        className={cn(
          "inline-flex size-[16px] shrink-0 items-center justify-center rounded-full border border-line-strong text-[10.5px] font-semibold leading-none text-ink-2 align-middle",
          "hover:border-ink-3 hover:text-ink",
          open && "border-ink-2 text-ink",
          className,
        )}
      >
        ?
      </button>
      {open && btn.current && (
        <Floating anchor={btn.current} side={side} id={id} width={width}>
          {children}
        </Floating>
      )}
    </>
  );
}
