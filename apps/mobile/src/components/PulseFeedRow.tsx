import { humanize, type PulseItem } from "@ecopulse/core";
import { timeAgo } from "../lib/format";
import { EVENT_WORD, problemTitle } from "../lib/words";
import { CategoryIcon } from "./CategoryIcon";
import { DemoTag, LevelTag, cx } from "./ui";

export function pulseEventLabel(item: PulseItem): string {
  if ((item.event === "report_merged" || item.event === "auto_verified") && item.reporter_count > 1) return `${item.reporter_count} people reported this`;
  return EVENT_WORD[item.event] ?? humanize(item.event);
}

export function PulseFeedRow({ item, onClick, fresh }: { item: PulseItem; onClick: () => void; fresh?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx("pressable flex w-full gap-3 px-4 py-3 text-left active:bg-surface-2", fresh && "bg-brand-soft/60")}>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-ink-2 border border-line" aria-hidden>
        <CategoryIcon category={item.category} domain={item.domain} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <LevelTag level={item.level} />
          <span className="text-[0.8438rem] text-ink-3 whitespace-nowrap">{timeAgo(item.at)}</span>
        </span>
        <span className="mt-0.5 block text-[1rem] font-medium leading-6 text-ink line-clamp-2">{problemTitle(item.title, item.category)}</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] text-ink-2">
          <span className="truncate">
            {pulseEventLabel(item)}
            {item.location_name ? ` · ${item.location_name}` : ""}
          </span>
          {item.is_demo && <DemoTag className="ml-auto shrink-0" />}
        </span>
      </span>
    </button>
  );
}
