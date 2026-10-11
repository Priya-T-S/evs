import type { ReactNode } from "react";
import { EVENT_LABEL, LIFECYCLE, STATUS, formatDate, type IncidentStatus, type MapLayerDef, type TimelineEvent } from "@ecopulse/core";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/hooks";
import { PRIORITY_WORD, STATUS_HELP } from "@/lib/glossary";
import { InfoTip } from "./Tip";

/* ------------------------------------------------------------------ Stat */

export function Stat({ label, value, sub, tone, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "critical" | "ok"; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <span className="text-[12px] text-ink-3 whitespace-nowrap">{label}</span>
      <span className={cn("text-[15px] font-semibold leading-tight", tone === "critical" && "text-[color:var(--danger-ink)]", tone === "ok" && "text-ok")}>{value}</span>
      {sub && <span className="text-[12px] text-ink-3">{sub}</span>}
    </div>
  );
}

/** Key/value row used in detail panes. */
export function Fact({ label, children, className, help }: { label: string; children: ReactNode; className?: string; help?: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5", className)}>
      <dt className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-ink-3">
        {label}
        {help && <InfoTip label={label}>{help}</InfoTip>}
      </dt>
      <dd className="text-[14px] text-ink text-right min-w-0">{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ Meter */

/** Horizontal meter. Track is a faint step of the fill colour so state reads across the bar. */
export function Meter({ value, max = 100, color, label, valueLabel, className, height = 6 }: { value: number | null; max?: number; color: string; label?: ReactNode; valueLabel?: ReactNode; className?: string; height?: number }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {(label || valueLabel) && (
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-ink-2">{label}</span>
          <span className="num text-[13px] text-ink">{valueLabel ?? (value == null ? "–" : Math.round(value))}</span>
        </div>
      )}
      <div
        className="w-full overflow-hidden rounded-full"
        style={{ height, background: `color-mix(in srgb, ${color} 16%, var(--surface-3))` }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value ?? undefined}
        aria-label={typeof label === "string" ? label : undefined}
      >
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/** Stacked contribution bar (e.g. risk drivers). Segments separated by a 2px surface gap. */
export function ContributionBar({ parts, total = 100, height = 10 }: { parts: { key: string; label: string; value: number; color: string }[]; total?: number; height?: number }) {
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="flex w-full overflow-hidden rounded-[3px] bg-surface-3" style={{ height, gap: 2 }}>
      {shown.map((p) => (
        <div key={p.key} title={`${p.label}: ${p.value.toFixed(1)}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Stepper */

export function LifecycleStepper({ status }: { status: IncidentStatus }) {
  const dismissed = status === "dismissed";
  const current = STATUS[status].step;
  return (
    <div>
      {dismissed && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-sm border border-dashed border-line-strong px-2 py-1 text-[13px] text-ink-2">
          Dismissed — removed from the lifecycle. A moderator can reopen it.
        </p>
      )}
      <ol className={cn("grid grid-cols-4 gap-x-1 gap-y-2.5", dismissed && "opacity-40")} aria-label="Problem progress">
        {LIFECYCLE.map((s, i) => {
          const done = !dismissed && i < current;
          const now = !dismissed && i === current;
          return (
            <li key={s} className="flex flex-col gap-1.5 min-w-0" aria-current={now ? "step" : undefined}>
              <div className={cn("h-1 rounded-full", done ? "bg-brand" : now ? "bg-ink" : "bg-surface-3")} />
              <span title={STATUS_HELP[s]} className={cn("text-[12.5px] leading-tight", now ? "text-ink font-semibold" : done ? "text-ink-2" : "text-ink-3")}>
                {STATUS[s].label}
                {now && <span className="sr-only"> (current)</span>}
              </span>
            </li>
          );
        })}
      </ol>
      {!dismissed && (
        <p className="mt-2.5 text-[14px] leading-snug text-ink-2">
          <span className="font-medium text-ink">Now: {STATUS[status].label}.</span> {STATUS_HELP[status]}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Timeline */

export function Timeline({ events }: { events: TimelineEvent[] }) {
  const sorted = [...events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  return (
    <ol className="relative">
      {sorted.map((e, i) => (
        <li key={i} className="relative grid grid-cols-[12px_1fr] gap-x-3 pb-3 last:pb-0">
          <span className="relative flex justify-center">
            <span className={cn("mt-[5px] size-[7px] rounded-full border", i === 0 ? "bg-ink border-ink" : "bg-surface border-line-strong")} />
            {i < sorted.length - 1 && <span className="absolute top-[14px] bottom-[-4px] w-px bg-line" />}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] text-ink">{EVENT_LABEL[e.kind] ?? e.kind}</span>
              <time className="tabular-nums text-[12px] text-ink-3 shrink-0" dateTime={e.created_at} title={formatDate(e.created_at)}>
                {ago(e.created_at)}
              </time>
            </div>
            <p className="text-[12.5px] text-ink-3">
              {e.actor ?? "System"}
              {typeof e.data?.team === "string" && ` → ${e.data.team}`}
              {typeof e.data?.provider === "string" && ` · ${e.data.provider}`}
            </p>
            {e.note && <p className="mt-0.5 text-[13px] text-ink-2 leading-snug">“{e.note}”</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ Legend */

const SHAPE: Record<string, ReactNode> = {
  solid: <span className="inline-block w-4 h-2.5 rounded-[2px] border-2 border-ink-2 bg-[color-mix(in_srgb,var(--ink-2)_25%,transparent)]" />,
  dashed: <span className="inline-block w-4 h-2.5 rounded-[2px] border-2 border-dashed border-ink-2" />,
  star: <span className="text-[14px] leading-none" style={{ color: "#b07a12" }}>★</span>,
  line: <span className="inline-block w-4 h-0 border-t-[3px] border-dotted" style={{ borderColor: "#3f8f3c" }} />,
  area: <span className="inline-block w-4 h-2.5 rounded-[2px] border border-dashed" style={{ borderColor: "#3a5fae", background: "rgba(58,95,174,.18)" }} />,
  ring: <span className="text-[14px] leading-none" style={{ color: "#8a63b3" }}>◎</span>,
  dot: <span className="inline-block size-2 rounded-full border" style={{ background: "#a08454", borderColor: "var(--surface)" }} />,
};

export function Legend({ legend, compact }: { legend: MapLayerDef["legend"]; compact?: boolean }) {
  if (legend.type === "gradient") {
    const stops = legend.stops;
    const min = stops[0][0];
    const max = stops[stops.length - 1][0];
    const grad = stops.map(([v, c]) => `${c} ${((v - min) / (max - min || 1)) * 100}%`).join(", ");
    return (
      <div className={cn("flex flex-col gap-1", compact ? "w-[150px]" : "w-full")}>
        <div className="h-2 rounded-[2px] border border-line" style={{ background: `linear-gradient(90deg, ${grad})` }} />
        <div className="flex justify-between text-[11px] text-ink-3 num">
          <span>{formatStop(min)}</span>
          <span className="font-sans">{legend.unit}</span>
          <span>{formatStop(max)}</span>
        </div>
      </div>
    );
  }
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {legend.items.map(([label, v]) => (
        <li key={label} className="inline-flex items-center gap-1 text-[12px] text-ink-2">
          {v.startsWith("#") ? (
            legend.shape === "priority" ? (
              <span className="num inline-flex h-4 min-w-[20px] items-center justify-center rounded-[3px] px-0.5 text-[10.5px] font-semibold text-white" style={{ background: v }}>
                {label}
              </span>
            ) : (
              <span className="size-2.5 rounded-full" style={{ background: v }} />
            )
          ) : (
            SHAPE[v] ?? SHAPE.dot
          )}
          {legend.shape === "priority" ? <span>{PRIORITY_WORD[label as keyof typeof PRIORITY_WORD] ?? ""}</span> : label}
        </li>
      ))}
    </ul>
  );
}

function formatStop(v: number) {
  return v <= 1 && v > 0 ? `${Math.round(v * 100)}%` : String(v);
}

/* ------------------------------------------------------------------ Section */

export function Section({ title, aside, children, className, id, help }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string; help?: ReactNode }) {
  return (
    <section className={cn("px-5 py-4 border-t border-line", className)} aria-labelledby={id}>
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <h3 id={id} className="eyebrow">
            {title}
          </h3>
          {help && <InfoTip label={typeof title === "string" ? title : "this section"}>{help}</InfoTip>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
