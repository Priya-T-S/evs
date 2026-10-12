import { useRef, useState, type KeyboardEvent } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AlarmClock, ChevronDown, School } from "lucide-react";
import { DOMAIN, STATUS, type Domain, type Incident, type IncidentStatus, type Priority } from "@ecopulse/core";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useLive, type QueueKey } from "@/lib/live";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import { Button, Checkbox, DemoTag, ErrorState, InfoTip, PriorityChip, Select, Skeleton, StatusPill, Tooltip } from "@/components/ui";
import { PRIORITY_DEADLINE, PRIORITY_HELP, PRIORITY_WORD, RISK_HELP, SLA_HELP, STATUS_HELP, dueIn, openFor, plural } from "@/lib/glossary";

const PRIORITIES: Priority[] = ["P1", "P2", "P3", "P4"];
const PAGE = 20;

export interface QueueFilters {
  domain: Domain | "";
  status: "open" | IncidentStatus;
  since?: string;
  bbox?: string;
  viewportOnly: boolean;
  overdueOnly: boolean;
}

const STATUS_OPTIONS: { value: QueueFilters["status"]; label: string }[] = [
  { value: "open", label: "All open statuses" },
  { value: "reported", label: "Reported" },
  { value: "ai_classified", label: "AI classified" },
  { value: "verified", label: "Verified" },
  { value: "prioritized", label: "Prioritised" },
  { value: "assigned", label: "Assigned" },
  { value: "action_started", label: "Action started" },
];

export function compactAge(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function PriorityQueue({
  filters,
  onFiltersChange,
  selectedId,
  onSelect,
  onHover,
}: {
  filters: QueueFilters;
  onFiltersChange: (f: QueueFilters) => void;
  selectedId: string | null;
  onSelect: (i: Incident) => void;
  onHover: (i: Incident | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Record<Priority, boolean>>({ P1: false, P2: false, P3: false, P4: true });

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-queue-row]") ?? []);
    if (!rows.length) return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    rows[next].focus();
    rows[next].scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-3 pb-2.5 border-b border-line space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <h2 className="text-[15px] font-semibold">Priority queue</h2>
            <InfoTip label="Priority queue" side="right">
              Open problems, most urgent first. {PRIORITY_HELP} Within each group, the highest urgency score comes first.
            </InfoTip>
          </span>
          <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
            most urgent first
            <DemoDataTag />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select aria-label="Filter by type of problem" value={filters.domain} onChange={(e) => onFiltersChange({ ...filters, domain: e.target.value as Domain | "" })} className="[&_select]:h-7 [&_select]:text-[13px]">
            <option value="">All problem types</option>
            {(Object.keys(DOMAIN) as Domain[]).map((d) => (
              <option key={d} value={d}>
                {DOMAIN[d].label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by status" value={filters.status} onChange={(e) => onFiltersChange({ ...filters, status: e.target.value as QueueFilters["status"] })} className="[&_select]:h-7 [&_select]:text-[13px]">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <Checkbox
              checked={filters.viewportOnly}
              onChange={(v) => onFiltersChange({ ...filters, viewportOnly: v })}
              label={<span className="text-[13px] text-ink-2">Only visible on map</span>}
            />
            <span className="inline-flex items-center gap-1">
              <Checkbox
                checked={filters.overdueOnly}
                onChange={(v) => onFiltersChange({ ...filters, overdueOnly: v })}
                label={<span className="text-[13px] text-ink-2">Only overdue</span>}
              />
              <InfoTip label="Overdue" side="right">
                {SLA_HELP}
              </InfoTip>
            </span>
          </span>
          <span className="flex items-center gap-1.5 whitespace-nowrap text-[12.5px] text-ink-3">
            Statuses
            <InfoTip label="Statuses" side="right" width={380}>
              <span className="mb-1 block">Each problem moves through these steps:</span>
              {STATUS_OPTIONS.filter((o) => o.value !== "open").map((o) => (
                <span key={o.value} className="mb-0.5 block">
                  <span className="font-medium">{STATUS[o.value as IncidentStatus].label}</span> — {STATUS_HELP[o.value as IncidentStatus]}
                </span>
              ))}
              <span className="block text-ink-3">Then Resolved, and finally Citizen verified when residents confirm the fix.</span>
            </InfoTip>
          </span>
        </div>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto" onKeyDown={onKeyDown} aria-label="Open problems by priority" role="region">
        {PRIORITIES.map((p) => (
          <QueueSection
            key={p}
            priority={p}
            filters={filters}
            collapsed={collapsed[p]}
            onToggle={() => setCollapsed((c) => ({ ...c, [p]: !c[p] }))}
            selectedId={selectedId}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

/** Shown when the platform is running on (partly) synthetic incidents. */
function DemoDataTag() {
  const q = useQuery({ queryKey: ["external-status"], queryFn: api.external.status, staleTime: 300_000 });
  const share = q.data?.synthetic.incident_share ?? 0;
  if (!share) return null;
  return <DemoTag label={share >= 0.99 ? "Demo data" : `${Math.round(share * 100)}% demo data`} />;
}

export function queueKey(priority: Priority, f: QueueFilters): QueueKey {
  return { priority, status: f.status, domain: f.domain || undefined, since: f.since, bbox: f.viewportOnly ? f.bbox : undefined, overdue: f.overdueOnly || undefined };
}

function QueueSection({
  priority,
  filters,
  collapsed,
  onToggle,
  selectedId,
  onSelect,
  onHover,
}: {
  priority: Priority;
  filters: QueueFilters;
  collapsed: boolean;
  onToggle: () => void;
  selectedId: string | null;
  onSelect: (i: Incident) => void;
  onHover: (i: Incident | null) => void;
}) {
  const key = queueKey(priority, filters);
  const q = useInfiniteQuery({
    queryKey: ["queue", key],
    queryFn: ({ pageParam, signal }) =>
      api.incidents.list({ sort: "risk", status: key.status, domain: key.domain, priority, since: key.since, bbox: key.bbox, overdue: key.overdue, limit: PAGE, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.items.length < last.total ? last.offset + last.items.length : undefined),
    placeholderData: (prev) => prev,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total;
  const now = useNow(60_000);

  return (
    <section aria-labelledby={`q-${priority}`} className="border-b border-line">
      <div className="sticky top-0 z-10 flex items-center bg-surface pr-3 hover:bg-surface-2">
        <h3 id={`q-${priority}`} className="min-w-0 flex-1">
          <button onClick={onToggle} aria-expanded={!collapsed} className="flex h-10 w-full items-center gap-2 pl-4 pr-2 text-left">
            <ChevronDown className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", collapsed && "-rotate-90")} aria-hidden />
            <PriorityChip priority={priority} size="sm" />
            <span className="text-[14px] font-medium text-ink">{PRIORITY_WORD[priority]}</span>
            <span className="truncate text-[13px] text-ink-3">· {PRIORITY_DEADLINE[priority]}</span>
            <span className="ml-auto whitespace-nowrap text-[13px] text-ink-2">
              <span className="num">{total ?? "–"}</span>
              <span className="sr-only"> problems</span>
            </span>
          </button>
        </h3>
        <InfoTip label={`${priority} priority`} side="right">
          {PRIORITY_HELP}
        </InfoTip>
      </div>
      {!collapsed && (
        <div className={cn(q.isFetching && !q.isFetchingNextPage && q.isPlaceholderData && "opacity-60 transition-opacity")}>
          {q.isPending && (
            <div className="px-4 pb-2 space-y-2">
              {Array.from({ length: priority === "P1" ? 2 : 3 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          )}
          {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} compact />}
          {q.isSuccess && !items.length && (
            <p className="px-4 pb-3 pl-10 text-[13px] text-ink-3">
              {filters.overdueOnly && priority === "P4"
                ? "Low-priority problems have no deadline, so they are never overdue."
                : <>No {filters.overdueOnly ? "overdue " : ""}{PRIORITY_WORD[priority].toLowerCase()} problems{filters.viewportOnly ? " in the visible map area" : ""} right now.</>}
              {(filters.viewportOnly || filters.overdueOnly || filters.domain || filters.status !== "open") && " Clear the filters above to see more."}
            </p>
          )}
          {items.length > 0 && (
            <ul>
              {items.map((i) => (
                <QueueRow key={i.id} i={i} now={now} selected={i.id === selectedId} onSelect={onSelect} onHover={onHover} />
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <div className="px-4 pb-2.5 pt-1">
              <Button size="sm" variant="ghost" className="w-full text-ink-3" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                Show {Math.min(PAGE, (total ?? 0) - items.length)} more · {(total ?? 0) - items.length} not shown yet
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function QueueRow({ i, now, selected, onSelect, onHover }: { i: Incident; now: number; selected: boolean; onSelect: (i: Incident) => void; onHover: (i: Incident | null) => void }) {
  const flashAt = useLive((s) => s.flash[i.id]);
  const flashing = !!flashAt && Date.now() - flashAt < 3000;
  return (
    <li>
      <button
        data-queue-row
        key={flashAt ?? 0}
        onClick={() => onSelect(i)}
        onMouseEnter={() => onHover(i)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(i)}
        onBlur={() => onHover(null)}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "group relative grid w-full grid-cols-[auto_1fr_auto] items-baseline gap-x-2.5 gap-y-0.5 py-2.5 pl-4 pr-4 text-left transition-colors",
          "focus-visible:outline-offset-[-2px]",
          selected ? "bg-surface-3" : "hover:bg-surface-2",
          flashing && "row-flash",
        )}
      >
        {selected && <span className="absolute left-0 top-0 bottom-0 w-[2px] bg-brand" aria-hidden />}
        <span className="row-span-3 self-start pt-0.5">
          <PriorityChip priority={i.priority} size="sm" />
        </span>
        <span className="truncate text-[14px] font-medium leading-snug text-ink">{i.title}</span>
        <Tooltip
          content={
            <>
              <span className="font-medium">Risk {i.risk_score.toFixed(0)}/100.</span> {RISK_HELP}
            </>
          }
          side="right"
        >
          <span className="whitespace-nowrap text-right text-[12.5px] text-ink-3">
            Risk <span className="num text-[14px] font-medium text-ink">{i.risk_score.toFixed(0)}</span>
          </span>
        </Tooltip>
        <span className="truncate text-[13px] text-ink-2">{i.location_name ?? "Location not named"}</span>
        <StatusPill status={i.status} className="justify-self-end" />
        <span className="col-span-2 flex min-w-0 items-center gap-1.5 overflow-hidden text-[12.5px] text-ink-3">
          <span className="whitespace-nowrap">{plural(i.reporter_count, "person", "people")} reported</span>
          <span aria-hidden>·</span>
          {i.sla_due_at && i.overdue ? (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-[color:var(--danger-ink)]"
              title={`Target was ${new Date(i.sla_due_at).toLocaleString()} (${PRIORITY_DEADLINE[i.priority]}). First reported ${new Date(i.first_reported_at).toLocaleString()}.`}
            >
              <AlarmClock className="size-3.5 shrink-0" aria-hidden />
              {dueIn(i.sla_due_at, now).text}
            </span>
          ) : (
            <span className="whitespace-nowrap" title={`First reported ${new Date(i.first_reported_at).toLocaleString()}${i.sla_due_at ? ` · ${dueIn(i.sla_due_at, now).text}` : ""}`}>
              open {openFor(i.first_reported_at, now)}
            </span>
          )}
          {i.near_sensitive && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 truncate text-ink-2" title="Near a school or hospital — this raises the urgency">
                <School className="size-3.5 shrink-0" aria-hidden />
                <span className="hidden min-[1400px]:inline">near</span>
                school/hospital
                <span className="sr-only min-[1400px]:hidden"> nearby</span>
              </span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}
