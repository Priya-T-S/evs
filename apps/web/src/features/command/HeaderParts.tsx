import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Flame, MapPin, Search, CircleDot, Building2 } from "lucide-react";
import { formatNumber, type SearchResult, type Selection } from "@ecopulse/core";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/hooks";
import { useSelection } from "@/lib/selection";
import { cn } from "@/lib/cn";
import { Tooltip } from "@/components/ui";

export function usePulse() {
  return useQuery({ queryKey: ["pulse"], queryFn: () => api.pulse(), refetchInterval: 60_000 });
}

/** Compact inline stats (not cards). Live via the pulse query, which realtime invalidates. */
export function StatRow() {
  const { data, isPending } = usePulse();
  const s = data?.stats;
  const items: { label: string; value: number | undefined; tone?: "critical" | "ok"; title: string }[] = [
    { label: "Open", value: s?.open_incidents, title: "Problems across the city that are not fixed yet" },
    { label: "Critical", value: s?.p1_open, tone: s && s.p1_open > 0 ? "critical" : undefined, title: "Open P1 (critical) problems — these need action within 24 hours" },
    { label: "New 24 h", value: s?.new_incidents_24h, title: "Problems first reported in the last 24 hours" },
    { label: "Fixed 24 h", value: s?.resolved_24h, tone: "ok", title: "Problems marked as fixed in the last 24 hours" },
    { label: "Hotspots", value: s?.active_hotspots, title: "Areas where problems cluster, including forecasts for the next 14 days" },
  ];
  return (
    <dl className="flex items-center divide-x divide-line" aria-label="City status" aria-busy={isPending}>
      {items.map((it) => (
        <Tooltip key={it.label} as="div" focusable content={it.title} side="bottom" width={240} className="items-baseline gap-1.5 px-3 first:pl-0">
          <dt className="text-[13px] text-ink-3 whitespace-nowrap">{it.label}</dt>
          <dd
            className={cn(
              "num text-[14px] font-medium",
              it.tone === "critical" && "text-[color:var(--danger-ink)]",
              it.tone === "ok" && "text-ok",
            )}
          >
            {it.value == null ? <span className="inline-block h-3 w-5 rounded-sm skeleton align-middle" /> : formatNumber(it.value)}
          </dd>
        </Tooltip>
      ))}
    </dl>
  );
}

const TYPE_META: Record<SearchResult["type"], { label: string; icon: typeof MapPin }> = {
  neighbourhood: { label: "Neighbourhood", icon: Building2 },
  incident: { label: "Problem", icon: CircleDot },
  hotspot: { label: "Hotspot", icon: Flame },
  place: { label: "Place", icon: MapPin },
};

/** Global search: debounced, abortable, keyboard navigable; flies the map and selects. */
export function SearchBox() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q.trim(), 250);
  const res = useQuery({
    queryKey: ["search", dq],
    queryFn: ({ signal }) => api.map.search(dq, signal),
    enabled: dq.length >= 2,
    staleTime: 60_000,
  });
  const results = res.data?.results ?? [];

  useEffect(() => setActive(0), [dq]);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (r: SearchResult) => {
    const { handle, select } = useSelection.getState();
    handle?.map.flyTo({ center: [r.lon, r.lat], zoom: r.zoom, essential: true });
    const base = { lon: r.lon, lat: r.lat, properties: { name: r.label } };
    let sel: Selection | null = null;
    if (r.type === "incident") sel = { kind: "incident", id: String(r.id), ...base };
    else if (r.type === "hotspot") sel = { kind: "hotspot", id: String(r.id), ...base };
    else if (r.type === "neighbourhood") sel = { kind: "neighbourhood", id: Number(r.id), ...base };
    if (sel) select(sel);
    setOpen(false);
    setQ("");
    input.current?.blur();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      input.current?.blur();
    }
  };

  const showList = open && dq.length >= 2;
  return (
    <div className="relative w-full max-w-[340px]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={input}
        role="combobox"
        aria-expanded={showList}
        aria-controls="search-results"
        aria-activedescendant={showList && results[active] ? `sr-${active}` : undefined}
        aria-label="Search places, neighbourhoods, incidents and hotspots"
        placeholder="Search an area, street or reference…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        className="h-8 w-full rounded-sm border border-line-strong bg-surface-2 pl-8 pr-8 text-[13.5px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-focus"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[3px] border border-line-strong px-1 text-[11px] text-ink-3 num">/</kbd>
      {showList && (
        <ul id="search-results" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[360px] overflow-y-auto rounded-md border border-line-strong bg-surface py-1 shadow-2">
          {res.isFetching && !results.length && <li className="px-3 py-2 text-[13px] text-ink-3">Searching…</li>}
          {res.isError && <li className="px-3 py-2 text-[13px] text-ink-3">Search isn’t working right now. Try again in a moment.</li>}
          {!res.isFetching && res.isSuccess && !results.length && <li className="px-3 py-2 text-[13px] leading-snug text-ink-3">No matches for “{dq}”. Try a neighbourhood name (e.g. Koramangala) or a reference like EP-TXUXBC.</li>}
          {results.map((r, i) => {
            const M = TYPE_META[r.type];
            return (
              <li
                key={`${r.type}-${r.id}`}
                id={`sr-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(r);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-2.5 px-3 py-1.5", i === active && "bg-surface-3")}
              >
                <M.icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                <span className="flex-1 truncate text-[14px]">{r.label}</span>
                <span className="text-[11.5px] text-ink-3">{M.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
