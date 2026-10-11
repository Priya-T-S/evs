import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/lib/cn";
import { IconButton } from "./Button";

/* ------------------------------------------------------------------ Dialog */

export function Dialog({ open, onClose, title, children, footer, width = 440 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input,textarea,select,button:not([data-close])")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && ref.current) {
        const f = Array.from(ref.current.querySelectorAll<HTMLElement>("a,button,input,textarea,select,[tabindex]:not([tabindex='-1'])")).filter((el) => !el.hasAttribute("disabled"));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <motion.div className="absolute inset-0 bg-black/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative w-full rounded-lg border border-line-strong bg-surface shadow-2"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h2 className="text-[15px] font-semibold">{title}</h2>
              <IconButton label="Close" size="sm" onClick={onClose} data-close>
                <X className="size-4" />
              </IconButton>
            </div>
            <div className="px-5 pb-4">{children}</div>
            {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-line">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------------ Toasts */

export interface ToastItem {
  id: number;
  tone: "info" | "success" | "error" | "critical";
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  ttl?: number;
}

interface ToastState {
  items: ToastItem[];
  push(t: Omit<ToastItem, "id">): void;
  dismiss(id: number): void;
}

let seq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push(t) {
    const id = ++seq;
    set({ items: [...get().items.slice(-3), { ...t, id }] });
    const ttl = t.ttl ?? (t.tone === "critical" ? 12_000 : 5_000);
    setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = (t: Omit<ToastItem, "id">) => useToasts.getState().push(t);

const TONE_BAR: Record<ToastItem["tone"], string> = {
  info: "var(--ink-3)",
  success: "var(--ok)",
  error: "var(--p2)",
  critical: "var(--p1)",
};

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[360px] flex-col gap-2" role="region" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ duration: 0.2 }}
            role={t.tone === "critical" || t.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto relative overflow-hidden rounded-md border bg-surface shadow-2 pl-4 pr-2 py-2.5",
              t.tone === "critical" ? "border-[color-mix(in_srgb,var(--p1)_60%,transparent)]" : "border-line-strong",
            )}
          >
            <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: TONE_BAR[t.tone] }} aria-hidden />
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                {t.tone === "critical" && <p className="eyebrow !text-[color:var(--danger-ink)] mb-0.5">Critical alert</p>}
                <p className="text-[14px] font-medium leading-snug">{t.title}</p>
                {t.body && <p className="text-[13px] text-ink-2 mt-0.5">{t.body}</p>}
                {t.action && (
                  <button
                    className="mt-1.5 text-[13px] font-medium text-brand hover:underline"
                    onClick={() => {
                      t.action!.onClick();
                      dismiss(t.id);
                    }}
                  >
                    {t.action.label}
                  </button>
                )}
              </div>
              <IconButton label="Dismiss notification" size="sm" onClick={() => dismiss(t.id)}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
