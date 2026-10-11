import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { IconButton } from "./ui";

/** Header for pushed screens (back button + title + optional action). */
export function ScreenHeader({ title, action, onBack }: { title: string; action?: ReactNode; onBack?: () => void }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-10 bg-bg/95 backdrop-blur-sm pt-safe border-b border-line">
      <div className="flex h-14 items-center gap-1 px-2">
        <IconButton label="Back" icon={ArrowLeft} onClick={onBack ?? (() => (window.history.length > 1 ? navigate(-1) : navigate("/")))} />
        <h1 className="min-w-0 flex-1 truncate text-[1.1563rem] font-semibold text-ink">{title}</h1>
        {action}
      </div>
    </header>
  );
}

/** Large title used at the top of tab screens. */
export function TabTitle({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="pt-[calc(env(safe-area-inset-top)+14px)] px-4 pb-1 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.6875rem] font-semibold leading-8 tracking-[-0.015em] text-ink">{title}</h1>
        {sub && <div className="mt-0.5 text-[0.9688rem] text-ink-2">{sub}</div>}
      </div>
      {action && <div className="-mr-2 flex items-center">{action}</div>}
    </header>
  );
}
