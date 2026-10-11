import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand-2 border border-transparent",
  secondary: "bg-surface-2 text-ink border border-line-strong hover:bg-surface-3",
  ghost: "bg-transparent text-ink-2 border border-transparent hover:bg-surface-3 hover:text-ink",
  danger: "bg-transparent text-[var(--danger-ink)] border border-[color-mix(in_srgb,var(--p1)_55%,transparent)] hover:bg-danger-soft",
};
const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5",
  md: "h-8 px-3 text-[14px] gap-2",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors duration-150 select-none",
        "disabled:opacity-50 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md" | "lg";
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = "md", active, className, children, type = "button", ...rest },
  ref,
) {
  const s = size === "sm" ? "size-7" : size === "lg" ? "size-10" : "size-8";
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center justify-center rounded-sm text-ink-2 transition-colors duration-150",
        "hover:bg-surface-3 hover:text-ink disabled:opacity-40",
        active && "bg-surface-3 text-ink",
        s,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
