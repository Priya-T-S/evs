import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";

/**
 * Non-modal side panel. The map stays interactive behind/next to it; Esc handling is done
 * by the owner so it can coordinate with selection state.
 */
export function Drawer({ title, eyebrow, onClose, children, actions, className, labelId = "drawer-title" }: { title: ReactNode; eyebrow?: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; className?: string; labelId?: string }) {
  return (
    <aside role="complementary" aria-labelledby={labelId} className={cn("flex h-full flex-col bg-surface border-l border-line", className)}>
      <header className="flex items-start gap-2 px-5 pt-4 pb-3">
        <div className="flex-1 min-w-0">
          {eyebrow && <div className="mb-1">{eyebrow}</div>}
          <h2 id={labelId} className="text-[17px] font-semibold leading-snug text-ink">
            {title}
          </h2>
        </div>
        <IconButton label="Close details (Esc)" size="sm" onClick={onClose} className="-mr-1.5 -mt-0.5">
          <X className="size-4" />
        </IconButton>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      {actions && <footer className="border-t border-line px-5 py-3 bg-surface" data-tour="drawer-actions">{actions}</footer>}
    </aside>
  );
}
