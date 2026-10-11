import type { ReactNode } from "react";
import {
  DOMAIN,
  PRIORITY,
  PROVENANCE,
  PULSE_LEVEL,
  STATUS,
  type Domain,
  type IncidentStatus,
  type Priority,
  type Provenance,
  type PulseLevel,
} from "@ecopulse/core";
import { cn } from "@/lib/cn";
import { PRIORITY_DEADLINE, PRIORITY_WORD, PROVENANCE_PLAIN, STATUS_HELP } from "@/lib/glossary";
import { Tooltip } from "./Tip";

export function Badge({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 h-5 px-1.5 rounded-[4px] text-[12px] font-medium leading-none whitespace-nowrap border border-line text-ink-2",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Priority is always a coloured chip WITH its text label (never colour alone). */
export function PriorityChip({ priority, withLabel, size = "md" }: { priority: Priority; withLabel?: boolean; size?: "sm" | "md" }) {
  const p = PRIORITY[priority];
  return (
    <span className="inline-flex items-center gap-1.5" title={`${priority} · ${PRIORITY_WORD[priority]} — ${PRIORITY_DEADLINE[priority]}`}>
      <span
        className={cn(
          "num inline-flex items-center justify-center rounded-[4px] font-semibold leading-none",
          size === "sm" ? "h-[18px] min-w-[24px] px-1 text-[11.5px]" : "h-5 min-w-[26px] px-1 text-[12px]",
        )}
        style={{ background: p.color, color: p.text }}
      >
        {p.label}
      </span>
      {withLabel ? <span className="text-[13px] font-medium text-ink">{PRIORITY_WORD[priority]}</span> : <span className="sr-only">{PRIORITY_WORD[priority]}</span>}
    </span>
  );
}

const TONE: Record<string, string> = {
  open: "var(--ink-2)",
  progress: "var(--brand)",
  done: "var(--ok)",
  muted: "var(--ink-3)",
};

/** Lifecycle status with its own shape; hover explains the step in plain words. */
export function StatusPill({ status, className, plain }: { status: IncidentStatus; className?: string; plain?: boolean }) {
  const s = STATUS[status];
  const shape =
    s.tone === "done" ? (
      <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
        <path d="M1 4.2 3.2 6.2 7 1.8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ) : s.tone === "muted" ? (
      <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
        <path d="M1.5 1.5 6.5 6.5M6.5 1.5 1.5 6.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ) : s.tone === "progress" ? (
      <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
        <circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 1a3 3 0 0 1 0 6z" fill="currentColor" />
      </svg>
    ) : (
      <svg viewBox="0 0 8 8" className="size-2" aria-hidden>
        <circle cx="4" cy="4" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  const pill = (
    <span className={cn("inline-flex items-center gap-1 text-[12.5px] whitespace-nowrap", !plain && className)} style={{ color: TONE[s.tone] }}>
      {shape}
      <span className={s.tone === "muted" ? "line-through decoration-1" : undefined}>{s.label}</span>
    </span>
  );
  if (plain) return pill;
  return (
    <Tooltip content={<><span className="font-medium">{s.label}:</span> {STATUS_HELP[status]}</>} className={className} side="left">
      {pill}
    </Tooltip>
  );
}

const PROV_VAR: Record<Provenance, string> = {
  observed: "var(--prov-observed)",
  external: "var(--prov-external)",
  model: "var(--prov-model)",
  recommendation: "var(--prov-recommendation)",
};

/** Origin of an insight. Accepts compound values from the API such as "observed+external". */
export function ProvenanceBadge({ kind, className, detail }: { kind: Provenance | string; className?: string; detail?: string }) {
  const parts = String(kind)
    .split("+")
    .filter((k): k is Provenance => k in PROVENANCE);
  if (!parts.length) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {parts.map((k) => (
        <Tooltip
          key={k}
          content={
            <>
              <span className="font-medium">{PROVENANCE_PLAIN[k].label}:</span> {PROVENANCE_PLAIN[k].help}
              {detail && <span className="mt-1 block text-[12px] text-ink-3">Source: {detail}</span>}
            </>
          }
        >
        <span
          tabIndex={0}
          aria-label={`${PROVENANCE_PLAIN[k].label} data`}
          className="inline-flex items-center gap-1 h-[18px] px-1.5 rounded-[4px] text-[11.5px] font-medium leading-none whitespace-nowrap border"
          style={{
            color: PROV_VAR[k],
            borderColor: `color-mix(in srgb, ${PROV_VAR[k]} 45%, transparent)`,
            background: `color-mix(in srgb, ${PROV_VAR[k]} 9%, transparent)`,
          }}
        >
          <ProvenanceGlyph kind={k} />
          {PROVENANCE_PLAIN[k].label}
        </span>
        </Tooltip>
      ))}
    </span>
  );
}

/** Each provenance also has its own glyph, so it reads without colour. */
function ProvenanceGlyph({ kind }: { kind: Provenance }) {
  const c = "size-2 shrink-0";
  switch (kind) {
    case "observed":
      return (
        <svg viewBox="0 0 8 8" className={c} aria-hidden>
          <circle cx="4" cy="4" r="3" fill="currentColor" />
        </svg>
      );
    case "external":
      return (
        <svg viewBox="0 0 8 8" className={c} aria-hidden>
          <rect x="1" y="1" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "model":
      return (
        <svg viewBox="0 0 8 8" className={c} aria-hidden>
          <path d="M4 0.8 7.2 4 4 7.2 0.8 4z" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 8 8" className={c} aria-hidden>
          <path d="M4 0.8 7.2 7 0.8 7z" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
  }
}

export function DomainTag({ domain, className }: { domain: Domain; className?: string }) {
  const d = DOMAIN[domain] ?? DOMAIN.other;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] text-ink-2 whitespace-nowrap", className)}>
      <span className="size-2 rounded-[2px]" style={{ background: d.color }} aria-hidden />
      {d.label}
    </span>
  );
}

export function LevelTag({ level }: { level: PulseLevel }) {
  const l = PULSE_LEVEL[level];
  return (
    <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap" style={{ color: l.color }}>
      <span className="size-1.5 rounded-full" style={{ background: l.color }} aria-hidden />
      {l.label}
    </span>
  );
}

export function DemoTag({ className, label = "Demo data" }: { className?: string; label?: string }) {
  return (
    <span
      title="Synthetic demonstration data — not a real observation"
      className={cn("inline-flex items-center h-[17px] px-1.5 rounded-[4px] text-[11px] leading-none text-ink-3 border border-dashed border-line-strong whitespace-nowrap", className)}
    >
      {label}
    </span>
  );
}
