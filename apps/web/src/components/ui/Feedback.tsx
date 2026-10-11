import type { ReactNode } from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/query";
import { Button } from "./Button";

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton rounded-sm", className)} style={style} aria-hidden />;
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3 border-b border-line">
          <Skeleton className="h-5 w-7" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${70 - ((i * 13) % 30)}%` }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-8" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint, icon, action, className }: { title: string; hint?: ReactNode; icon?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center gap-2 px-6 py-10", className)}>
      <div className="text-ink-3">{icon ?? <Inbox className="size-5" aria-hidden />}</div>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {hint && <p className="text-[13px] text-ink-3 max-w-[280px]">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center text-center gap-2", compact ? "px-4 py-4" : "px-6 py-10", className)}>
      <AlertTriangle className="size-5 text-p2" aria-hidden />
      <p className="text-[14px] font-medium text-ink">Couldn’t load this</p>
      <p className="text-[13px] text-ink-3 max-w-[300px]">{errorMessage(error)}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" icon={<RotateCw className="size-3.5" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
