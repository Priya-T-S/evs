import { useState } from "react";
import { ChevronUp } from "lucide-react";
import { EVENT_LABEL, type PulseItem } from "@ecopulse/core";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import { LevelTag } from "@/components/ui";
import { usePulse } from "./HeaderParts";
import { compactAge } from "./PriorityQueue";

/** Collapsible "City pulse" strip: the latest city-wide events, updating live. */
export function PulseTicker({ onPick }: { onPick: (p: PulseItem) => void }) {
  const [open, setOpen] = useState(false);
  const { data, isError } = usePulse();
  const now = useNow(30_000);
  const feed = data?.feed ?? [];
  const items = open ? feed.slice(0, 8) : feed.slice(0, 1);

  return (
    <section aria-labelledby="pulse-title" className="border-t border-line bg-surface-2">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 h-8 hover:bg-surface-3">
        <span className="size-[6px] rounded-full bg-brand live-dot" aria-hidden />
        <h2 id="pulse-title" className="eyebrow !text-ink-2">
          City pulse
        </h2>
        <span className="text-[12px] text-ink-3">latest activity across the city</span>
        <ChevronUp className={cn("ml-auto size-3.5 text-ink-3 transition-transform", !open && "rotate-180")} aria-hidden />
      </button>
      {isError && <p className="px-4 pb-2 text-[12.5px] text-ink-3">Pulse feed unavailable.</p>}
      <ul className={cn(open && "max-h-[280px] overflow-y-auto", "pb-1")} aria-live="off">
        {items.map((p) => (
          <li key={`${p.incident_id}-${p.at}`}>
            <button onClick={() => onPick(p)} className="grid w-full grid-cols-[72px_1fr_auto] items-baseline gap-2 px-4 py-1.5 text-left hover:bg-surface-3">
              <LevelTag level={p.level} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-ink">{p.title}</span>
                <span className="block truncate text-[12px] text-ink-3">
                  {EVENT_LABEL[p.event] ?? p.event}
                  {p.reporter_count > 1 && ` · ${p.reporter_count} people reported`}
                </span>
              </span>
              <span className="num text-[12px] text-ink-3">{compactAge(p.at, now)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
