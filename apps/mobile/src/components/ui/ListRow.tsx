import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "./cx";

export interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onClick?: () => void;
  className?: string;
  /** Accessible label when the visible content is not descriptive enough. */
  label?: string;
}

/** A tappable row in a list; lists render rows inside one surface separated by hairlines. */
export function ListRow({ leading, title, subtitle, meta, trailing, chevron, onClick, className, label }: ListRowProps) {
  const content = (
    <>
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="text-[1.0625rem] font-medium leading-6 text-ink line-clamp-2">{title}</div>
        {subtitle && <div className="mt-0.5 text-[0.9375rem] leading-5 text-ink-2">{subtitle}</div>}
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{meta}</div>}
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
      {chevron && <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden />}
    </>
  );
  const cls = cx("flex w-full items-center gap-3 px-4 py-3 min-h-[3.5rem] text-left", className);
  return onClick ? (
    <button type="button" onClick={onClick} aria-label={label} className={cx(cls, "pressable active:bg-surface-2")}>
      {content}
    </button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

/** A grouped list surface (hairline-separated rows). */
export function ListGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("bg-surface border-y border-line divide-y divide-line", className)}>{children}</div>;
}

export function SectionHeader({ title, aside, id }: { title: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 px-4 pt-7 pb-2.5">
      <h2 id={id} className="text-[1.0625rem] font-semibold text-ink">
        {title}
      </h2>
      {aside && <div className="text-[0.9063rem] text-ink-3">{aside}</div>}
    </div>
  );
}
