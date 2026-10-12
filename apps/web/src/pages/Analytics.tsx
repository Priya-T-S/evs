import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { DOMAIN, LIFECYCLE, STATUS, formatPct, gradeLabel, scoreColor, type Analytics as A, type Domain } from "@ecopulse/core";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { TopBar } from "@/components/layout/AppShell";
import { DemoTag, ErrorState, InfoTip, ProvenanceBadge, Segmented, Skeleton } from "@/components/ui";
import { CHART_HELP, SCORE_HELP, SLA_HELP } from "@/lib/glossary";
import { DRIVES_HELP } from "@/features/detail/Drives";

const PERIODS = [
  { key: 7, label: "7 days" },
  { key: 30, label: "30 days" },
  { key: 90, label: "90 days" },
];
const DOMAINS = Object.keys(DOMAIN) as Domain[];

export default function Analytics() {
  const [days, setDays] = useState(30);
  const cur = useQuery({ queryKey: ["analytics", days], queryFn: () => api.analytics(days), placeholderData: (p) => p });
  // The API reports the current window; a double-length window lets us derive the previous one.
  const dbl = useQuery({ queryKey: ["analytics", days * 2], queryFn: () => api.analytics(Math.min(365, days * 2)), placeholderData: (p) => p });
  const status = useQuery({ queryKey: ["external-status"], queryFn: api.external.status, staleTime: 300_000 });
  const a = cur.data;
  const refetching = cur.isFetching && cur.isPlaceholderData;

  return (
    <>
      <TopBar title="Analytics" />
      <main id="main" className="min-h-0 flex-1 overflow-y-auto bg-bg">
        <div className="mx-auto max-w-[1240px] px-6 py-5">
          <div className="mb-5 flex items-center gap-3">
            <h1 className="text-[17px] font-semibold">How the city is doing</h1>
            <Segmented label="Period" items={PERIODS} value={days} onChange={setDays} />
            <span className="text-[13px] text-ink-3">Arrows compare with the {days} days before. Green = better, red = worse.</span>
            {status.data && status.data.synthetic.incident_share > 0 && <DemoTag className="ml-auto" label={`${Math.round(status.data.synthetic.incident_share * 100)}% demo incidents`} />}
          </div>

          {cur.isError && <ErrorState error={cur.error} onRetry={() => cur.refetch()} />}
          {cur.isPending && <AnalyticsSkeleton />}
          {a && (
            <div className={cn("space-y-8 transition-opacity", refetching && "opacity-60")}>
              <Headline a={a} prev={dbl.data && !dbl.isPlaceholderData ? dbl.data : undefined} />
              <DailyByDomain a={a} />
              <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
                <Funnel a={a} />
                <Teams a={a} />
              </div>
              <CleanUps days={days} />
              <Categories a={a} />
              <League a={a} />
            </div>
          )}
        </div>
      </main>
    </>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-16" />
      <Skeleton className="h-64" />
      <div className="grid grid-cols-2 gap-6">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </div>
  );
}

/** A chart block with a one-line "what this shows" and an optional "how to read it" tip. */
function Panel({ title, sub, how, aside, children, className }: { title: string; sub?: string; how?: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-t border-line pt-3", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
            {title}
            {how && <InfoTip label={title} side="right">{how}</InfoTip>}
          </h2>
          {sub && (
            <p className="mt-0.5 max-w-[760px] text-[14px] leading-snug text-ink-2">
              <span className="text-ink-3">What this shows: </span>
              {sub}
            </p>
          )}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ headline */

function Delta({ pct, goodWhenUp }: { pct: number | null; goodWhenUp: boolean }) {
  if (pct == null || !isFinite(pct)) return <span className="text-[12.5px] text-ink-3">no prior data</span>;
  const up = pct > 0;
  const flat = Math.abs(pct) < 0.5;
  const good = flat ? null : up === goodWhenUp;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12.5px] tabular-nums", good === null ? "text-ink-3" : good ? "text-ok" : "text-[color:var(--danger-ink)]")}>
      {!flat && <Icon className="size-3" aria-hidden />}
      {flat ? "no change" : `${up ? "+" : ""}${Math.round(pct)}%`}
      <span className="sr-only">{good === null ? "" : good ? " (improvement)" : " (worse)"}</span>
    </span>
  );
}

function Headline({ a, prev }: { a: A; prev?: A }) {
  const t = a.totals;
  const prior = (k: "incidents" | "resolved") => (prev ? prev.totals[k] - t[k] : null);
  const pct = (curV: number, p: number | null) => (p == null || p <= 0 ? null : ((curV - p) / p) * 100);
  const tiles: { label: string; value: string; delta?: React.ReactNode; hint?: string }[] = [
    { label: "Reports received", value: t.reports.toLocaleString("en-IN"), delta: <Delta pct={t.reports_change_pct} goodWhenUp />, hint: "Reports sent by residents. More reports usually means more people are using the app." },
    { label: "New problems", value: t.incidents.toLocaleString("en-IN"), delta: <Delta pct={pct(t.incidents, prior("incidents"))} goodWhenUp={false} />, hint: "Reports about the same thing in the same place are grouped into one problem." },
    { label: "Fixed", value: t.resolved.toLocaleString("en-IN"), delta: <Delta pct={pct(t.resolved, prior("resolved"))} goodWhenUp />, hint: "Problems marked as fixed by staff in this period." },
    { label: "Typical days to fix", value: t.median_resolution_days == null ? "–" : `${t.median_resolution_days.toFixed(1)} d`, hint: "Median: half of the problems were fixed faster than this, half slower." },
    { label: "Overdue now", value: t.overdue.toLocaleString("en-IN"), hint: `Open problems past their fix target right now (${t.open.toLocaleString("en-IN")} open in total). ${SLA_HELP}` },
    { label: "Fixed on time", value: formatPct(t.on_time_share), hint: `Share of problems fixed in this period within the target for their priority. ${SLA_HELP}` },
    { label: "Fixes confirmed", value: formatPct(t.citizen_confirmed_share), hint: "Share of fixed problems that residents confirmed as really fixed." },
    { label: "Active reporters", value: t.active_reporters.toLocaleString("en-IN"), hint: "Residents who sent at least one report in this period." },
    { label: "Duplicate reports", value: formatPct(t.duplicate_share), hint: "Share of reports about a problem that was already reported. These are merged, not lost." },
  ];
  return (
    <dl className="grid grid-cols-9 divide-x divide-line border-y border-line">
      {tiles.map((x, i) => (
        <div key={x.label} className={cn("py-3", i === 0 ? "pr-3" : "px-3")}>
          <dt className="flex items-center gap-1.5 text-[13px] leading-tight text-ink-3">
            <span>{x.label}</span>
            {x.hint && <InfoTip label={x.label} side="bottom">{x.hint}</InfoTip>}
          </dt>
          <dd className="mt-1 text-[22px] font-semibold leading-none tracking-tight">{x.value}</dd>
          <dd className="mt-1.5 h-4">{x.delta}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------------ daily by domain (small multiples) */

function ChartTooltip({ active, payload, label, color }: { active?: boolean; payload?: { value: number }[]; label?: string; color: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-line-strong bg-surface px-2 py-1.5 shadow-2">
      <p className="text-[14px] font-semibold tabular-nums">{payload[0].value} reports</p>
      <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
        <span className="inline-block h-[2px] w-2.5" style={{ background: color }} aria-hidden />
        {label && new Date(label).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
      </p>
    </div>
  );
}

function DailyByDomain({ a }: { a: A }) {
  const [table, setTable] = useState(false);
  const { days, byDomain, max, totals } = useMemo(() => {
    const end = new Date();
    const days: string[] = [];
    for (let i = a.period_days - 1; i >= 0; i--) days.push(new Date(end.getTime() - i * 86400_000).toISOString().slice(0, 10));
    const byDomain: Record<string, { day: string; reports: number }[]> = {};
    const totals: Record<string, number> = {};
    for (const d of DOMAINS) {
      const m = new Map(a.daily_by_domain.filter((x) => x.domain === d).map((x) => [x.day.slice(0, 10), x.reports]));
      byDomain[d] = days.map((day) => ({ day, reports: m.get(day) ?? 0 }));
      totals[d] = byDomain[d].reduce((s, x) => s + x.reports, 0);
    }
    const max = Math.max(1, ...Object.values(byDomain).flatMap((r) => r.map((x) => x.reports)));
    return { days, byDomain, max, totals };
  }, [a]);
  const shown = DOMAINS.filter((d) => totals[d] > 0);

  return (
    <Panel
      title="Reports per day, by type of problem"
      sub={CHART_HELP.daily}
      how="All small charts use the same scale, so you can compare bar heights between them directly. Hover a bar for the exact number and date, or switch to the table."
      aside={
        <div className="flex items-center gap-3">
          <ProvenanceBadge kind="observed" />
          <button onClick={() => setTable((t) => !t)} className="text-[13px] text-brand hover:underline" aria-expanded={table}>
            {table ? "Show charts" : "Show as table"}
          </button>
        </div>
      }
    >
      {table ? (
        <div className="max-h-[360px] overflow-auto rounded-sm border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-line text-ink-3">
                <th className="px-3 py-1.5 font-medium">Day</th>
                {shown.map((d) => (
                  <th key={d} className="px-3 py-1.5 text-right font-medium">
                    {DOMAIN[d].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((day, i) => (
                <tr key={day} className="border-b border-line last:border-0">
                  <td className="px-3 py-1 tabular-nums text-ink-2">{day}</td>
                  {shown.map((d) => (
                    <td key={d} className="px-3 py-1 text-right tabular-nums">
                      {byDomain[d][i].reports}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 lg:grid-cols-4">
          {shown.map((d) => (
            <figure key={d}>
              <figcaption className="mb-1 flex items-baseline gap-2">
                <span className="size-2 rounded-[2px]" style={{ background: DOMAIN[d].color }} aria-hidden />
                <span className="text-[14px] font-medium">{DOMAIN[d].label}</span>
                <span className="ml-auto text-[13px] tabular-nums text-ink-2">{totals[d]}</span>
              </figcaption>
              <div className="h-[96px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byDomain[d]} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
                    <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
                    <XAxis dataKey="day" hide />
                    <YAxis domain={[0, max]} width={22} tickCount={3} allowDecimals={false} tick={{ fontSize: 10, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: "var(--surface-3)" }} content={<ChartTooltip color={DOMAIN[d].color} />} isAnimationActive={false} />
                    <Bar dataKey="reports" fill={DOMAIN[d].color} radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </figure>
          ))}
        </div>
      )}
      <p className="mt-2 flex justify-between text-[12px] tabular-nums text-ink-3">
        <span>{new Date(days[0]).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
        <span>Each panel spans the same {a.period_days} days</span>
        <span>{new Date(days[days.length - 1]).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ lifecycle funnel */

function Funnel({ a }: { a: A }) {
  const f = a.status_funnel;
  // Current status counts -> how many incidents have reached at least each stage.
  const stages = LIFECYCLE.map((s, i) => ({ s, now: f[s] ?? 0, reached: LIFECYCLE.slice(i).reduce((sum, x) => sum + (f[x] ?? 0), 0) }));
  const total = stages[0].reached || 1;
  return (
    <Panel title="How far problems got" sub={CHART_HELP.funnel} how="Each bar counts the problems from this period that reached that step or a later one. A big drop between two bars shows where work is getting stuck.">
      <ul className="space-y-1.5" aria-label="Lifecycle funnel">
        {stages.map((st) => (
          <li key={st.s} className="group grid grid-cols-[120px_1fr_88px] items-center gap-3" title={`${STATUS[st.s].label}: ${st.reached} reached · ${st.now} currently here`}>
            <span className="text-[13px] text-ink-2">{STATUS[st.s].label}</span>
            <span className="h-[14px]">
              <span className="block h-full rounded-r-[3px] bg-brand group-hover:opacity-85" style={{ width: `${(st.reached / total) * 100}%`, minWidth: st.reached ? 2 : 0 }} />
            </span>
            <span className="text-right text-[13px] tabular-nums">
              {st.reached} <span className="text-ink-3">({st.now})</span>
            </span>
          </li>
        ))}
      </ul>
      {f.dismissed ? <p className="mt-2 text-[12.5px] text-ink-3">Dismissed (duplicates or not a problem): {f.dismissed}</p> : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ open vs resolved bars */

function SeriesLegend() {
  return (
    <ul className="flex shrink-0 items-center gap-3 whitespace-nowrap text-[12.5px] text-ink-2" aria-label="Legend">
      <li className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--series-open)" }} aria-hidden />
        Still open
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--series-resolved)" }} aria-hidden />
        Fixed
      </li>
    </ul>
  );
}

function OpenResolvedBar({ open, resolved, max }: { open: number; resolved: number; max: number }) {
  return (
    <span className="flex h-[14px] gap-[2px]">
      {open > 0 && <span className="h-full rounded-l-[3px] hover:opacity-85" title={`${open} open`} style={{ width: `${(open / max) * 100}%`, background: "var(--series-open)" }} />}
      {resolved > 0 && <span className={cn("h-full hover:opacity-85 rounded-r-[3px]", open === 0 && "rounded-l-[3px]")} title={`${resolved} resolved`} style={{ width: `${(resolved / max) * 100}%`, background: "var(--series-resolved)" }} />}
    </span>
  );
}

function Teams({ a }: { a: A }) {
  const max = Math.max(1, ...a.teams.map((t) => t.open + t.resolved));
  return (
    <Panel title="Team workload" sub={CHART_HELP.teams} how={`Numbers on the right: still open / already fixed. Red = how many of the open ones are overdue. ${SLA_HELP}`} aside={<SeriesLegend />}>
      {a.teams.length === 0 ? (
        <p className="text-[13px] text-ink-3">No problems were assigned to teams in this period. Try a longer period above.</p>
      ) : (
        <ul className="space-y-1.5">
          {a.teams.map((t) => (
            <li key={t.team} className="grid grid-cols-[170px_1fr_88px_84px] items-center gap-3">
              <span className="truncate text-[13px] text-ink-2">{t.team}</span>
              <OpenResolvedBar open={t.open} resolved={t.resolved} max={max} />
              <span className="text-right text-[13px] tabular-nums">
                {t.open} <span className="text-ink-3">/ {t.resolved}</span>
              </span>
              <span className={cn("text-right text-[12.5px] tabular-nums", t.overdue ? "text-[color:var(--danger-ink)]" : "text-ink-3")}>
                {t.overdue} overdue
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CleanUps({ days }: { days: number }) {
  const q = useQuery({ queryKey: ["drives", "stats", days], queryFn: () => api.drives.stats(days), placeholderData: (p) => p });
  const s = q.data;
  const tiles = s
    ? [
        { label: "Clean-ups done", value: s.completed },
        { label: "Bags of waste collected", value: s.bags_collected },
        { label: "Volunteers took part", value: s.volunteers },
        { label: "Coming up", value: s.upcoming },
      ]
    : [];
  return (
    <Panel
      title="Community clean-ups"
      sub="Clean-up drives that residents organised and joined from the citizen app, and what they collected."
      how={DRIVES_HELP}
      aside={<ProvenanceBadge kind="observed" />}
    >
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} compact />}
      {q.isPending && <Skeleton className="h-14" />}
      {s && (
        <dl className="grid grid-cols-4 divide-x divide-line border-y border-line">
          {tiles.map((x, i) => (
            <div key={x.label} className={cn("py-3", i === 0 ? "pr-3" : "px-3")}>
              <dt className="text-[13px] text-ink-3">{x.label}</dt>
              <dd className="mt-1 text-[22px] font-semibold leading-none tracking-tight tabular-nums">{x.value.toLocaleString("en-IN")}</dd>
            </div>
          ))}
        </dl>
      )}
      {s && s.completed === 0 && s.upcoming === 0 && <p className="mt-2 text-[13px] text-ink-3">No clean-up drives in this period yet.</p>}
    </Panel>
  );
}

function Categories({ a }: { a: A }) {
  const rows = [...a.by_category].sort((x, y) => y.incidents - x.incidents);
  const max = Math.max(1, ...rows.map((r) => r.incidents));
  return (
    <Panel title="Types of problem" sub={CHART_HELP.categories} how="Bar length = number of problems of that type (orange still open, blue fixed). “Avg. days” is the average time to fix." aside={<SeriesLegend />}>
      <div className="grid grid-cols-[180px_1fr_70px_90px] gap-x-3 border-b border-line pb-1 text-[11.5px] uppercase tracking-wider text-ink-3">
        <span>Category</span>
        <span />
        <span className="text-right">Open / all</span>
        <span className="text-right">Avg. days</span>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((r) => (
          <li key={r.category} className="grid grid-cols-[180px_1fr_70px_90px] items-center gap-x-3">
            <span className="truncate text-[13px] text-ink-2">{r.label}</span>
            <OpenResolvedBar open={r.open} resolved={r.incidents - r.open} max={max} />
            <span className="text-right text-[13px] tabular-nums">
              {r.open} <span className="text-ink-3">/ {r.incidents}</span>
            </span>
            <span className="text-right text-[13px] tabular-nums text-ink-2">{r.avg_days_to_resolve == null ? "–" : r.avg_days_to_resolve.toFixed(1)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------------ league table */

type LKey = "score" | "open" | "new" | "resolved" | "name";

function League({ a }: { a: A }) {
  const [sort, setSort] = useState<{ k: LKey; asc: boolean }>({ k: "score", asc: true });
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const r = [...a.by_location];
    r.sort((x, y) => {
      const v = (o: A["by_location"][number]) => (sort.k === "name" ? o.name : sort.k === "score" ? (o.score ?? 999) : o[sort.k]);
      const c = v(x) < v(y) ? -1 : v(x) > v(y) ? 1 : 0;
      return sort.asc ? c : -c;
    });
    return r;
  }, [a, sort]);
  const shown = all ? rows : rows.slice(0, 12);
  const H = ({ k, label, right }: { k: LKey; label: string; right?: boolean }) => (
    <th className={cn("py-2 font-medium", right ? "pl-3 text-right" : "pr-3")} aria-sort={sort.k === k ? (sort.asc ? "ascending" : "descending") : "none"}>
      <button onClick={() => setSort((s) => ({ k, asc: s.k === k ? !s.asc : k === "score" || k === "name" }))} className={cn("inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink-2", sort.k === k && "text-ink-2")}>
        {label}
        {sort.k === k && <ChevronDown className={cn("size-3", sort.asc && "rotate-180")} aria-hidden />}
      </button>
    </th>
  );
  return (
    <Panel title="Neighbourhoods compared" sub={CHART_HELP.league} how={`${SCORE_HELP} Click a column heading to sort. Calculated by model pulse-1.`} aside={<ProvenanceBadge kind="model" detail="pulse-1" />}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[11.5px] text-ink-3">
            <th className="w-8 py-2 pr-2 font-medium">#</th>
            <H k="name" label="Neighbourhood" />
            <H k="score" label="Environment score" />
            <H k="open" label="Open" right />
            <H k="new" label="New" right />
            <H k="resolved" label="Fixed" right />
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={r.id} className="border-b border-line last:border-0">
              <td className="py-1.5 pr-2 text-[12.5px] tabular-nums text-ink-3">{i + 1}</td>
              <td className="py-1.5 pr-3 text-[14px]">{r.name}</td>
              <td className="py-1.5 pr-3">
                <span className="flex items-center gap-2.5">
                  <span className="w-7 text-right text-[14px] font-medium tabular-nums">{r.score == null ? "–" : Math.round(r.score)}</span>
                  <span className="h-1.5 w-[160px] rounded-full" style={{ background: `color-mix(in srgb, ${scoreColor(r.score)} 16%, var(--surface-3))` }}>
                    <span className="block h-full rounded-full" style={{ width: `${r.score ?? 0}%`, background: scoreColor(r.score) }} />
                  </span>
                  <span className="text-[12.5px] text-ink-3">{gradeLabel(r.score)}</span>
                </span>
              </td>
              <td className="py-1.5 pl-3 text-right text-[14px] tabular-nums">{r.open}</td>
              <td className="py-1.5 pl-3 text-right text-[14px] tabular-nums text-ink-2">{r.new}</td>
              <td className="py-1.5 pl-3 text-right text-[14px] tabular-nums text-ink-2">{r.resolved}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 12 && (
        <button onClick={() => setAll((x) => !x)} className="mt-2 text-[13px] text-brand hover:underline">
          {all ? "Show fewer" : `Show all ${rows.length} neighbourhoods`}
        </button>
      )}
    </Panel>
  );
}
