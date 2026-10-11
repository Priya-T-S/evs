import { forwardRef, useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

const field =
  "w-full rounded-sm border border-line-strong bg-surface-2 text-ink placeholder:text-ink-3 text-[14px] transition-colors focus:outline-none focus:border-focus focus:ring-2 focus:ring-[color-mix(in_srgb,var(--focus)_25%,transparent)]";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(field, "h-8 px-2.5", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(field, "px-2.5 py-2 min-h-[64px] resize-y leading-snug", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select ref={ref} className={cn(field, "h-8 pl-2.5 pr-7 appearance-none cursor-pointer")} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-ink-3" aria-hidden />
    </span>
  );
});

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: (id: string) => ReactNode; required?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
        {required && <span className="text-ink-3"> · required</span>}
      </label>
      {children(id)}
      {hint && <p className="text-[12px] text-ink-3">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Tabs */

export interface TabItem<K extends string> {
  key: K;
  label: ReactNode;
  count?: number;
}

/** Underline tabs with roving focus (arrow keys) per WAI-ARIA tabs pattern. */
export function Tabs<K extends string>({ items, value, onChange, className, size = "md", label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string; size?: "sm" | "md"; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + items.length) % items.length;
    refs.current[n]?.focus();
    onChange(items[n].key);
  };
  return (
    <div role="tablist" aria-label={label} className={cn("flex items-end gap-4 border-b border-line", className)}>
      {items.map((t, i) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onKeyDown={(e) => onKey(e, i)}
            onClick={() => onChange(t.key)}
            className={cn(
              "relative -mb-px inline-flex items-center gap-1.5 border-b-2 transition-colors",
              size === "sm" ? "h-8 text-[13px]" : "h-9 text-[14px]",
              on ? "border-brand text-ink font-medium" : "border-transparent text-ink-3 hover:text-ink-2",
            )}
          >
            {t.label}
            {t.count != null && <span className="num text-[12px] text-ink-3">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Compact segmented control (for small mutually-exclusive options like a time window). */
export function Segmented<K extends string | number>({ items, value, onChange, label, className }: { items: { key: K; label: string; title?: string }[]; value: K; onChange: (k: K) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex h-7 items-center rounded-sm border border-line-strong p-0.5 bg-surface-2", className)}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button
            key={String(it.key)}
            role="radio"
            aria-checked={on}
            title={it.title}
            onClick={() => onChange(it.key)}
            className={cn(
              "h-full px-2 rounded-[4px] text-[12.5px] tabular-nums transition-colors",
              on ? "bg-surface-3 text-ink font-medium shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, id, className }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; id?: string; className?: string }) {
  return (
    <label className={cn("inline-flex items-center gap-2 cursor-pointer select-none", className)} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--brand)] cursor-pointer" />
      {label}
    </label>
  );
}
