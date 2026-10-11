import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Bell, CheckCircle2, X } from "lucide-react";
import { useToasts } from "../../lib/toast";
import { cx } from "./cx";

const ICON = { info: Bell, ok: CheckCircle2, warn: AlertTriangle, danger: AlertTriangle };
const ICON_CLS = { info: "text-brand", ok: "text-ok", warn: "text-[var(--prov-recommendation)]", danger: "text-p1" };

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const reduced = useReducedMotion();
  return (
    <div className="fixed inset-x-0 top-0 z-[60] pointer-events-none px-3 pt-[calc(env(safe-area-inset-top)+8px)] space-y-2" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const tone = t.tone ?? "info";
          const Icon = ICON[tone];
          return (
            <motion.div
              key={t.id}
              layout={!reduced}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              drag={reduced ? false : "y"}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0.6, bottom: 0 }}
              onDragEnd={(_, i) => i.offset.y < -24 && dismiss(t.id)}
              className="pointer-events-auto mx-auto max-w-[480px] flex items-start gap-3 rounded-md border border-line bg-surface px-3.5 py-3 shadow-[var(--shadow-2)]"
              role="status"
            >
              <Icon size={18} className={cx("mt-0.5 shrink-0", ICON_CLS[tone])} aria-hidden />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  t.onTap?.();
                  dismiss(t.id);
                }}
              >
                <div className="text-[0.9688rem] font-medium text-ink leading-5">{t.title}</div>
                {t.body && <div className="text-[0.9063rem] text-ink-2 leading-[1.25rem] mt-0.5">{t.body}</div>}
              </button>
              <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="-m-2 h-12 w-12 shrink-0 flex items-center justify-center text-ink-3">
                <X size={16} aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
