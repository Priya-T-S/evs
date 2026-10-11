import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, WifiOff } from "lucide-react";
import { Button } from "./Button";
import { cx } from "./cx";

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cx("skeleton", className)} style={style} />;
}

/** A list-shaped skeleton (rows with leading badge + two lines). */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="bg-surface border-y border-line divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 min-h-[4rem]">
          <Skeleton className="w-10 h-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

type IconT = ComponentType<{ size?: number; className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

export function EmptyState({ icon: Icon, title, body, action, className }: { icon?: IconT; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center text-center px-8 py-10", className)}>
      {Icon && <Icon size={28} strokeWidth={1.6} className="text-ink-3" aria-hidden />}
      <p className="mt-3 text-[1.0625rem] font-medium text-ink">{title}</p>
      {body && <p className="mt-1 text-[0.9375rem] text-ink-3 max-w-[280px]">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Couldn't load this", message, onRetry, offline, className }: { title?: string; message?: string; onRetry?: () => void; offline?: boolean; className?: string }) {
  return (
    <EmptyState
      className={className}
      icon={offline ? WifiOff : AlertTriangle}
      title={offline ? "You're offline" : title}
      body={offline ? "Showing what we have. This will refresh when you're back online." : message}
      action={onRetry && !offline ? <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button> : undefined}
    />
  );
}

const BANNER_TONE = {
  info: { cls: "bg-surface-2 border-line text-ink", icon: Info, iconCls: "text-ink-2" },
  warn: { cls: "bg-warn-soft border-[color-mix(in_srgb,var(--p3)_35%,var(--line))] text-ink", icon: AlertTriangle, iconCls: "text-[var(--prov-recommendation)]" },
  danger: { cls: "bg-danger-soft border-[color-mix(in_srgb,var(--p1)_30%,var(--line))] text-ink", icon: AlertTriangle, iconCls: "text-p1" },
  ok: { cls: "bg-ok-soft border-[color-mix(in_srgb,var(--ok)_30%,var(--line))] text-ink", icon: CheckCircle2, iconCls: "text-ok" },
} as const;

export function Banner({
  tone = "info",
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof BANNER_TONE;
  icon?: IconT;
  title?: ReactNode;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  const t = BANNER_TONE[tone];
  const Icon = icon ?? t.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("flex items-start gap-3 rounded-md border px-3.5 py-3", t.cls, className)}>
      <Icon size={18} strokeWidth={2} className={cx("mt-px shrink-0", t.iconCls)} aria-hidden />
      <div className="min-w-0 flex-1 text-[1rem] leading-[1.4375rem]">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cx(title ? "text-ink-2 mt-0.5" : "text-ink")}>{children}</div>}
        {action && (
          <button type="button" onClick={action.onClick} className="pressable -mb-2 -ml-1 mt-0.5 inline-flex min-h-11 items-center px-1 text-[1rem] font-semibold text-brand">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
