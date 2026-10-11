import { motion, useReducedMotion } from "framer-motion";
import { scoreColor } from "@ecopulse/core";
import { levelWord } from "../../lib/words";
import { cx } from "./cx";

export function ScoreRing({ score, size = 104, stroke = 8, label }: { score: number | null; size?: number; stroke?: number; label?: string }) {
  const reduced = useReducedMotion();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = score == null ? 0 : Math.max(0, Math.min(100, score));
  const color = scoreColor(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label ?? (score == null ? "No score" : `Score ${Math.round(v)} out of 100`)}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="butt"
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduced ? c * (1 - v / 100) : c }}
          animate={{ strokeDashoffset: c * (1 - v / 100) }}
          transition={{ duration: reduced ? 0 : 0.8, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num font-medium text-ink leading-none" style={{ fontSize: size * 0.32 }}>
          {score == null ? "–" : Math.round(v)}
        </span>
        <span className="num mt-1 text-[0.75rem] text-ink-3">/100</span>
      </div>
    </div>
  );
}

export function DimensionBar({ label, value, weakest }: { label: string; value: number | null | undefined; weakest?: boolean }) {
  const v = value == null ? null : Math.max(0, Math.min(100, value));
  const word = levelWord(v);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.9375rem] text-ink truncate">
          {label}
          {weakest && <span className="sr-only"> (one of the weakest)</span>}
        </span>
        <span className={cx("text-[0.9375rem] font-medium", word === "Poor" ? "text-[var(--poor-ink)]" : word === "Good" ? "text-ok" : "text-ink-2")}>{word}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-3 overflow-hidden" aria-hidden>
        <div className="h-full rounded-full" style={{ width: `${v ?? 0}%`, background: scoreColor(v) }} />
      </div>
    </div>
  );
}
