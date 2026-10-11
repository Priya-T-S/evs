import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp } from "lucide-react";
import { DOMAIN, RECOMMENDATION_KIND, formatDate, formatPct, formatTrend, humanize, type HotspotDetail as HD, type Selection } from "@ecopulse/core";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DomainTag, Drawer, ErrorState, InfoTip, PriorityChip, ProvenanceBadge, Section, StatusPill } from "@/components/ui";
import { CONFIDENCE_HELP, FORECAST_HELP, HOTSPOT_HELP, RISK_HELP } from "@/lib/glossary";
import { DrawerSkeleton } from "./IncidentDetail";

export function useHotspot(id: string) {
  return useQuery({ queryKey: ["hotspots", "detail", id], queryFn: () => api.hotspots.get(id), enabled: !!id });
}

export function HotspotDetail({ id, onClose, onSelect }: { id: string; onClose: () => void; onSelect: (s: Selection) => void }) {
  const q = useHotspot(id);
  if (q.isPending) return <DrawerSkeleton onClose={onClose} />;
  if (q.isError || !q.data)
    return (
      <Drawer title="Hotspot" onClose={onClose}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Drawer>
    );
  const h = q.data;
  return (
    <Drawer
      onClose={onClose}
      eyebrow={
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            Hotspot <InfoTip label="Hotspot" side="bottom">{HOTSPOT_HELP}</InfoTip>
          </span>
          <span aria-hidden>·</span>
          <DomainTag domain={h.domain} />
          <span className="ml-auto">
            <ProvenanceBadge kind="model" detail={h.method} />
          </span>
        </div>
      }
      title={h.name}
    >
      <HotspotBody h={h} onSelect={onSelect} />
    </Drawer>
  );
}

export function HotspotBody({ h, onSelect }: { h: HD; onSelect: (s: Selection) => void }) {
  const predicted = h.kind === "predicted";
  const risk = h.risk as { model?: string; components?: Record<string, number>; weights?: Record<string, number>; inputs?: Record<string, number> };
  const mix = Object.entries(h.category_mix);
  const mixMax = Math.max(1, ...mix.map(([, n]) => n));
  return (
    <>
      <div className="px-5 pb-4">
        {predicted ? (
          <div className="rounded-sm border border-dashed px-3 py-2.5" style={{ borderColor: "color-mix(in srgb, var(--prov-model) 60%, transparent)" }}>
            <p className="flex items-center gap-2 text-[14px] font-medium" style={{ color: "var(--prov-model)" }}>
              Forecast — not happening yet
              <InfoTip label="Forecast">{FORECAST_HELP}</InfoTip>
            </p>
            <p className="mt-0.5 text-[14px] leading-snug text-ink-2">
              Likely to appear in the next 14 days, based on how reports nearby have grown over the last 8 weeks. Confidence <span className="num">{formatPct(h.confidence)}</span>.
            </p>
          </div>
        ) : (
          <p className="text-[14px] leading-snug text-ink-2">
            <span className="font-medium text-ink">Happening now:</span> a cluster of residents’ reports, first detected {formatDate(h.detected_at, false)}. Status <span className="text-ink">{h.status}</span> · confidence{" "}
            <span className="num">{formatPct(h.confidence)}</span> <InfoTip label="Confidence">{CONFIDENCE_HELP}</InfoTip>
          </p>
        )}
        <dl className="mt-3 grid grid-cols-4 gap-3">
          <div>
            <dt className="flex items-center gap-1 text-[12.5px] text-ink-3">
              Risk <InfoTip label="Risk">{RISK_HELP}</InfoTip>
            </dt>
            <dd className="text-[13px] text-ink-3">
              <span className="num text-[18px] font-medium leading-tight text-ink">{h.risk_score.toFixed(0)}</span>/100
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-[12.5px] text-ink-3">
              Trend <InfoTip label="Trend">Change in the number of reports over the last 14 days, compared with the 14 days before.</InfoTip>
            </dt>
            <dd className={cn("num flex items-center gap-1 text-[14px] leading-tight mt-0.5", h.trend_pct > 0 ? "text-[color:var(--danger-ink)]" : "text-ok")}>
              {h.trend_pct > 0 ? <TrendingUp className="size-3.5" aria-label="rising" /> : <TrendingDown className="size-3.5" aria-label="falling" />}
              {formatTrend(h.trend_pct)}
            </dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Total reports</dt>
            <dd className="num text-[14px] leading-tight mt-0.5">{h.report_count}</dd>
          </div>
          <div>
            <dt className="text-[12.5px] text-ink-3">Open problems</dt>
            <dd className="num text-[14px] leading-tight mt-0.5">
              {h.active_incidents}
              <span className="font-sans text-[12.5px] text-ink-3"> of {h.incident_count}</span>
            </dd>
          </div>
        </dl>
      </div>

      {risk.components && (
        <Section title="What makes it risky" help="Each bar is one factor in the hotspot’s risk score. Numbers show the factor’s value (0–1) × how much it counts." aside={<ProvenanceBadge kind="model" detail={risk.model} />}>
          <ul className="space-y-1.5">
            {Object.entries(risk.components).map(([k, v]) => (
              <li key={k} className="grid grid-cols-[100px_1fr_92px] items-center gap-2">
                <span className="text-[12.5px] text-ink-2">{humanize(k)}</span>
                <span className="h-2 rounded-r-[2px] bg-surface-3">
                  <span className="block h-full rounded-r-[2px]" style={{ width: `${v * 100}%`, background: "var(--prov-model)" }} />
                </span>
                <span className="num whitespace-nowrap text-right text-[12px] text-ink-3" title="component × weight">
                  {v.toFixed(2)} × {(risk.weights?.[k] ?? 0).toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
          {risk.inputs && (
            <p className="mt-2 text-[12px] text-ink-3">
              Inputs:{" "}
              {Object.entries(risk.inputs)
                .map(([k, v]) => `${humanize(k)} ${v}`)
                .join(" · ")}
            </p>
          )}
        </Section>
      )}

      {h.weekly_reports.length > 0 && (
        <Section title="Reports per week" help="How many reports residents sent from this area each week. Rising bars mean the problem is growing." aside={<ProvenanceBadge kind="observed" />}>
          <WeeklyBars data={h.weekly_reports} color={DOMAIN[h.domain]?.color ?? DOMAIN.other.color} />
        </Section>
      )}

      {mix.length > 0 && (
        <Section title="Types of problem" aside={<span className="text-[12px] text-ink-3">number of problems</span>}>
          <ul className="space-y-1">
            {mix.map(([label, n]) => (
              <li key={label} className="grid grid-cols-[130px_1fr_28px] items-center gap-2">
                <span className="truncate text-[13px] text-ink-2">{label}</span>
                <span className="h-2 rounded-r-[2px] bg-surface-3">
                  <span className="block h-full rounded-r-[2px] bg-ink-3" style={{ width: `${(n / mixMax) * 100}%` }} />
                </span>
                <span className="num text-right text-[12.5px]">{n}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Problems in this hotspot" aside={<span className="num text-[12px] text-ink-3">{h.incidents.length}</span>}>
        {h.incidents.length === 0 ? (
          <p className="text-[13px] text-ink-3">{predicted ? "None yet — this is a forecast. Keep an eye on new reports here." : "No problems linked to this hotspot."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {h.incidents.slice(0, 12).map((i) => (
              <li key={i.id}>
                <button onClick={() => onSelect({ kind: "incident", id: i.id, lon: i.lon, lat: i.lat, properties: {} })} className="-mx-2 flex w-[calc(100%+16px)] items-center gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2">
                  <PriorityChip priority={i.priority} size="sm" />
                  <span className="flex-1 truncate text-[13px]">{i.title}</span>
                  <span className="num text-[12.5px] text-ink-3">{i.risk_score.toFixed(0)}</span>
                  <StatusPill status={i.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Recommendations" aside={<ProvenanceBadge kind="recommendation" />}>
        {h.recommendations.length === 0 ? (
          <p className="text-[13px] text-ink-3">No suggestion for this hotspot yet. Suggestions are updated as new data arrives.</p>
        ) : (
          h.recommendations.map((r) => (
            <div key={r.id} className="mb-3 last:mb-0">
              <button onClick={() => onSelect({ kind: "recommendation", id: r.id, lon: h.lon, lat: h.lat, properties: {} })} className="text-left text-[14px] font-medium text-ink hover:underline">
                {r.title}
              </button>
              <p className="text-[12px] text-ink-3">
                {RECOMMENDATION_KIND[r.kind] ?? r.kind} · {r.expected_impact} impact · <span className="num">{formatPct(r.confidence)}</span> confidence · {r.status}
              </p>
              <ol className="mt-1.5 space-y-1">
                {r.actions.slice(0, 3).map((a) => (
                  <li key={a.rank} className="grid grid-cols-[16px_1fr] gap-1.5 text-[13px]">
                    <span className="num text-ink-3">{a.rank}</span>
                    <span className="text-ink-2">{a.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
      </Section>
    </>
  );
}

/** Single-series weekly column chart (hand-built SVG: thin bars, hairline baseline, last value labelled). */
export function WeeklyBars({ data, color }: { data: { week: string; reports: number }[]; color: string }) {
  const max = Math.max(1, ...data.map((d) => d.reports));
  const H = 56;
  return (
    <figure>
      <div className="flex h-[72px] items-end gap-[6px] border-b border-line" role="img" aria-label={`Weekly reports: ${data.map((d) => d.reports).join(", ")}`}>
        {data.map((d, i) => {
          const h = Math.max(2, (d.reports / max) * H);
          const last = i === data.length - 1;
          return (
            <div key={d.week} className="group relative flex flex-1 flex-col items-center justify-end" title={`Week of ${formatDate(d.week, false)}: ${d.reports} reports`}>
              {last && <span className="num mb-0.5 text-[11.5px] text-ink-2">{d.reports}</span>}
              <span className="w-full max-w-[20px] rounded-t-[3px] group-hover:opacity-80" style={{ height: h, background: color }} />
            </div>
          );
        })}
      </div>
      <figcaption className="mt-1 flex justify-between text-[11.5px] text-ink-3 num">
        <span>{formatDate(data[0].week, false)}</span>
        <span>{formatDate(data[data.length - 1].week, false)}</span>
      </figcaption>
    </figure>
  );
}
