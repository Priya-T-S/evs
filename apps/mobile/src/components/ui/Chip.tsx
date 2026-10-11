import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { PRIORITY, PROVENANCE, PULSE_LEVEL, STATUS, type IncidentStatus, type Priority, type Provenance, type PulseLevel } from "@ecopulse/core";
import { LEVEL_WORD, PRIORITY_WORD, SOURCE_WORD, STATUS_WORD } from "../../lib/words";
import { cx } from "./cx";

/** Selectable chip (filters, time windows). */
export function Chip({ selected, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx(
        "pressable relative h-10 px-3.5 rounded-md text-[0.9375rem] font-medium border",
        "after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
        selected ? "bg-ink text-bg border-ink" : "bg-surface text-ink-2 border-line-strong",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Shape differs per priority as well as colour, so it never relies on colour alone. */
function PriorityMark({ priority }: { priority: Priority }) {
  const c = PRIORITY[priority].color;
  if (priority === "P1")
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden className="shrink-0">
        <path d="M6 1 11 11H1z" fill={c} />
      </svg>
    );
  if (priority === "P2") return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: c }} />;
  if (priority === "P3") return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />;
  return <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2" style={{ borderColor: c }} />;
}

/** Priority in words ("High priority") with a small coloured shape. */
export function PriorityChip({ priority, compact }: { priority: Priority; compact?: boolean }) {
  const p = PRIORITY[priority];
  const w = PRIORITY_WORD[priority];
  return (
    <span
      className="inline-flex items-center gap-1.5 min-h-7 px-2 rounded-sm border text-[0.875rem] font-medium text-ink whitespace-nowrap"
      style={{ borderColor: `color-mix(in srgb, ${p.color} 45%, var(--line))`, background: `color-mix(in srgb, ${p.color} 9%, var(--surface))` }}
      title={w.hint}
    >
      <PriorityMark priority={priority} />
      {compact ? w.short : w.long}
    </span>
  );
}

const TONE: Record<string, string> = {
  open: "bg-surface-2 text-ink-2 border-line-strong",
  progress: "bg-brand-soft text-brand border-transparent",
  done: "bg-ok-soft text-ok border-transparent",
  muted: "bg-surface-3 text-ink-3 border-transparent",
};

export function StatusPill({ status }: { status: IncidentStatus }) {
  const s = STATUS[status];
  return <span className={cx("inline-flex items-center min-h-7 px-2 rounded-sm border text-[0.875rem] font-medium whitespace-nowrap", TONE[s.tone])}>{STATUS_WORD[status]}</span>;
}

function Marker({ color, shape = "square" }: { color: string; shape?: "square" | "ring" }) {
  return (
    <span
      aria-hidden
      className="inline-block w-2.5 h-2.5 shrink-0"
      style={shape === "ring" ? { border: `2px solid ${color}`, borderRadius: 999 } : { background: color, borderRadius: 2 }}
    />
  );
}

/** Activity level: Urgent / Needs attention / Open / Fixed, colour + text. */
export function LevelTag({ level }: { level: PulseLevel }) {
  const l = PULSE_LEVEL[level];
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-ink-2 whitespace-nowrap">
      <Marker color={l.color} shape={level === "resolved" ? "ring" : "square"} />
      {LEVEL_WORD[level]}
    </span>
  );
}

/**
 * Where an insight comes from, in plain words ("From people's reports", "Our estimate", …).
 * Accepts combined strings from the API like "observed+external".
 */
export function ProvenanceLabel({ kind, detail, className }: { kind: Provenance | string; detail?: ReactNode; className?: string }) {
  const kinds = String(kind)
    .split("+")
    .filter((k): k is Provenance => k in PROVENANCE);
  return (
    <span className={cx("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.875rem] leading-5 text-ink-3", className)}>
      {kinds.map((k, i) => (
        <span key={k} className="inline-flex items-center gap-1 font-medium" style={{ color: `var(--prov-${k})` }} title={PROVENANCE[k].description}>
          {i > 0 && <span className="text-ink-3 font-normal">+</span>}
          <span aria-hidden className="inline-block w-2 h-2 rounded-[1px]" style={{ background: `var(--prov-${k})` }} />
          {i > 0 ? SOURCE_WORD[k].charAt(0).toLowerCase() + SOURCE_WORD[k].slice(1) : SOURCE_WORD[k]}
        </span>
      ))}
      {detail ? <span>· {detail}</span> : null}
    </span>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      className={cx("inline-flex items-center min-h-6 px-1.5 rounded-sm border border-dashed border-line-strong text-[0.8125rem] font-medium text-ink-2 whitespace-nowrap", className)}
      title="Sample data for demonstration"
    >
      Sample data
    </span>
  );
}

/**
 * "How do we know this?" — a small disclosure that keeps the technical detail (model names,
 * sources, raw numbers) one tap away without putting it in the way.
 */
export function Disclosure({ label = "How do we know this?", children, className }: { label?: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="pressable -ml-1 inline-flex min-h-12 items-center gap-1.5 px-1 text-[0.9375rem] font-medium text-brand"
      >
        {label}
        <ChevronDown size={17} aria-hidden className={cx("transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id} className="selectable mt-1 space-y-1.5 rounded-md border border-line bg-surface-2 px-3.5 py-3 text-[0.875rem] leading-5 text-ink-2">
          {children}
        </div>
      )}
    </div>
  );
}
