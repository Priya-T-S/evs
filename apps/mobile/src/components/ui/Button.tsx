import { forwardRef, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "./cx";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  loading?: boolean;
  icon?: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  trailing?: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink active:bg-brand-2",
  secondary: "bg-surface text-ink border border-line-strong active:bg-surface-2",
  ghost: "bg-transparent text-brand active:bg-brand-soft",
  danger: "bg-surface text-p1 border border-line-strong active:bg-danger-soft",
};

const SIZE: Record<Size, string> = {
  sm: "h-12 px-3.5 text-[0.9688rem] gap-1.5",
  md: "h-12 px-4 text-[1.0625rem] gap-2",
  lg: "h-14 px-5 text-[1.0938rem] gap-2.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block, loading, icon: Icon, trailing, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "pressable inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap disabled:opacity-50 disabled:active:scale-100",
        VARIANT[variant],
        SIZE[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={18} className="spin" aria-hidden /> : Icon ? <Icon size={size === "lg" ? 20 : 18} strokeWidth={2} aria-hidden /> : null}
      {children}
      {trailing}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  variant?: "plain" | "surface" | "float";
  size?: number;
  badge?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon: Icon, variant = "plain", size = 48, badge, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={badge ? `${label}, ${badge} unread` : label}
      title={label}
      className={cx(
        "pressable relative inline-flex shrink-0 items-center justify-center rounded-md text-ink disabled:opacity-40",
        variant === "plain" && "active:bg-surface-3",
        variant === "surface" && "bg-surface border border-line active:bg-surface-2",
        variant === "float" && "bg-surface/92 backdrop-blur-sm border border-line shadow-[var(--shadow-1)] active:bg-surface-2",
        className,
      )}
      // rem, so icon buttons grow with the Text size setting
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}
      {...rest}
    >
      <Icon size={20} strokeWidth={1.9} aria-hidden />
      {badge ? (
        <span className="num absolute top-1.5 right-1.5 min-w-[1.25rem] h-[1.25rem] px-1 rounded-full bg-p1 text-white text-[0.75rem] font-medium leading-[1.25rem] text-center">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
});
