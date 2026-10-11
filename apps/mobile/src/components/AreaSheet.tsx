import { useQuery } from "@tanstack/react-query";
import { TrendingDown, TrendingUp, Wind } from "lucide-react";
import { DOMAIN, RECOMMENDATION_KIND, formatDate, formatTrend, humanize, scoreColor, type Domain, type Selection } from "@ecopulse/core";
import { timeAgo } from "../lib/format";
import { api } from "../lib/api";
import { useHotspot } from "../lib/queries";
import { DIMENSIONS, DIMENSION_WORD, aqiWord, categoryWord, gradeWord, problemTitle, urgencyWord } from "../lib/words";
import { CategoryBadge } from "./CategoryIcon";
import type { IncidentPreview } from "./IncidentSheet";
import { DemoTag, DimensionBar, Disclosure, ListRow, PriorityChip, ProvenanceLabel, Sheet, Skeleton, cx, type Snap } from "./ui";

/** Map selections other than single problems: problem area, neighbourhood, suggestion, grid cell, air reading. */
export function AreaSheet({
  sel,
  snap,
  onSnapChange,
  onClose,
  onOpenIncident,
}: {
  sel: Selection | null;
  snap: Snap;
  onSnapChange: (s: Snap) => void;
  onClose: () => void;
  onOpenIncident: (p: IncidentPreview) => void;
}) {
  const title = sel ? titleFor(sel) : "";
  return (
    <Sheet open={!!sel} onClose={onClose} title={title} mode="snap" snap={snap} onSnapChange={onSnapChange} peekHeight={200} header={sel && <Header sel={sel} />}>
      {sel && (
        <div className="pb-[calc(24px+env(safe-area-inset-bottom))]">
          {sel.kind === "hotspot" && <HotspotBody id={String(sel.id)} p={sel.properties} onOpenIncident={onOpenIncident} />}
          {sel.kind === "neighbourhood" && <NeighbourhoodBody p={sel.properties} />}
          {sel.kind === "recommendation" && <RecommendationBody id={String(sel.id)} />}
          {sel.kind === "cell" && <CellBody sel={sel} />}
          {sel.kind === "aqi" && <AqiBody p={sel.properties} />}
        </div>
      )}
    </Sheet>
  );
}

function titleFor(s: Selection): string {
  const p = s.properties;
  switch (s.kind) {
    case "hotspot":
      return p.name ?? "Problem area";
    case "neighbourhood":
      return p.name ?? "Neighbourhood";
    case "recommendation":
      return p.title ?? "Suggestion";
    case "cell":
      return s.layer === "flood-pred" ? "Chance of flooding here" : "Unfixed problems here";
    case "aqi":
      return `Air quality in ${p.name ?? "this area"}`;
    default:
      return "Details";
  }
}

const json = <T,>(v: unknown): T | null => {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.875rem] text-ink-2">{label}</div>
      <div className="mt-0.5 text-[1.1875rem] font-semibold leading-6 text-ink">{value}</div>
      {sub && <div className="text-[0.875rem] text-ink-2">{sub}</div>}
    </div>
  );
}

function Header({ sel }: { sel: Selection }) {
  const p = sel.properties;
  const kindLine = (() => {
    switch (sel.kind) {
      case "hotspot":
        return p.kind === "predicted" ? "We expect problems here in the next 2 weeks" : "Many problems reported close together";
      case "neighbourhood":
        return "Neighbourhood score";
      case "recommendation":
        return "A suggestion for the city — not a fact";
      case "cell":
        return sel.layer === "flood-pred" ? "Our estimate — not flooding that has been seen" : "Our estimate, from open problems";
      case "aqi":
        return "From public air quality data";
      default:
        return null;
    }
  })();
  const domain: Domain | undefined = sel.kind === "hotspot" ? p.domain : sel.kind === "aqi" ? "air" : sel.kind === "cell" && sel.layer === "flood-pred" ? "flood" : undefined;
  return (
    <div className="px-4 pb-3">
      <div className="flex items-start gap-3">
        {domain ? <CategoryBadge domain={domain} size={44} /> : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.1875rem] font-semibold leading-6 text-ink line-clamp-2">{titleFor(sel)}</h2>
          {kindLine && <p className="mt-0.5 text-[0.9375rem] text-ink-2">{kindLine}</p>}
        </div>
      </div>
      <div className="mt-3">
        <Summary sel={sel} />
      </div>
    </div>
  );
}

function Summary({ sel }: { sel: Selection }) {
  const p = sel.properties;
  switch (sel.kind) {
    case "hotspot": {
      const t = p.trend_pct ?? 0;
      const up = t > 5;
      const down = t < -5;
      return (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Urgency" value={urgencyWord(p.risk_score)} />
          <Stat
            label="Lately"
            value={
              <span className={cx("inline-flex items-center gap-1", up ? "text-p2" : "text-ink")}>
                {up ? <TrendingUp size={17} aria-hidden /> : down ? <TrendingDown size={17} aria-hidden /> : null}
                {up ? "Getting worse" : down ? "Getting better" : "No change"}
              </span>
            }
          />
          <Stat label="Reports" value={<span className="num">{p.report_count ?? "–"}</span>} sub={p.primary_category ? categoryWord(p.primary_category, p.primary_category_label) : p.primary_category_label} />
        </div>
      );
    }
    case "neighbourhood": {
      const g = gradeWord(p.overall);
      return (
        <div className="flex items-center gap-3">
          <span aria-hidden className="inline-block h-3.5 w-3.5 rounded-[3px]" style={{ background: scoreColor(p.overall) }} />
          <div>
            <div className="text-[1.25rem] font-semibold text-ink">{g.word}</div>
            <div className="text-[0.9375rem] text-ink-2">
              Score <span className="num">{p.overall != null ? Math.round(p.overall) : "–"}</span> out of 100 · about <span className="num">{Number(p.population ?? 0).toLocaleString("en-IN")}</span> people live here
            </div>
          </div>
        </div>
      );
    }
    case "recommendation":
      return (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Kind" value={<span className="text-[1rem]">{RECOMMENDATION_KIND[p.kind] ?? humanize(p.kind ?? "")}</span>} />
          <Stat label="Expected effect" value={<span className="text-[1rem] capitalize">{p.impact ?? "–"}</span>} />
        </div>
      );
    case "cell":
      return sel.layer === "flood-pred" ? (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Chance of flooding" value={(p.value ?? 0) >= 0.6 ? "High" : (p.value ?? 0) >= 0.3 ? "Medium" : "Low"} />
          <Stat label="Rain expected (2 days)" value={p.rain_mm != null ? `${Number(p.rain_mm).toFixed(0)} mm` : "–"} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Unfixed problems" value={urgencyWord(p.value)} />
          <Stat label="People living here" value={<span className="num">{Number(p.population ?? 0).toLocaleString("en-IN")}</span>} />
        </div>
      );
    case "aqi": {
      const w = aqiWord(p.us_aqi);
      return (
        <div>
          <p className="text-[1.25rem] font-semibold capitalize text-ink">{w.word}</p>
          <p className="mt-0.5 text-[0.9375rem] text-ink-2">
            Reading <span className="num">{p.us_aqi ?? "–"}</span> · {timeAgo(p.observed_at)} {p.is_demo && <DemoTag className="ml-1 align-middle" />}
          </p>
        </div>
      );
    }
    default:
      return null;
  }
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 pt-5">
      <h3 className="mb-2 text-[1.0625rem] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function HotspotBody({ id, p, onOpenIncident }: { id: string; p: Record<string, any>; onOpenIncident: (p: IncidentPreview) => void }) {
  const q = useHotspot(id);
  const d = q.data;
  const max = d ? Math.max(1, ...d.weekly_reports.map((w) => w.reports)) : 1;
  const kind = String(p.primary_category ? categoryWord(p.primary_category, p.primary_category_label) : (p.primary_category_label ?? DOMAIN[p.domain as Domain]?.label ?? "")).toLowerCase();
  return (
    <div className="border-t border-line">
      <Block title="What's happening">
        <p className="text-[1rem] leading-6 text-ink-2">
          People sent <span className="text-ink">{p.report_count}</span> reports here, mostly about {kind}. <span className="text-ink">{p.active_incidents ?? 0}</span> of these problems are
          still not fixed.
        </p>
        <Disclosure className="mt-0.5">
          <p>
            Urgency score <span className="num">{Math.round(p.risk_score ?? 0)}</span>/100 · change in reports over 14 days <span className="num">{formatTrend(p.trend_pct)}</span> ·{" "}
            <span className="num">{p.incident_count ?? "–"}</span> problems in total.
          </p>
          <p>
            Found by grouping reports that are close together. Method: {String(p.method ?? "hotspot-1").replace(/:/g, " · ")}, {Math.round((p.confidence ?? 0) * 100)}% sure.
          </p>
          <p>
            <ProvenanceLabel kind="model+observed" />
          </p>
        </Disclosure>
      </Block>
      {!d ? (
        <div className="px-4 pt-5 space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <>
          {d.weekly_reports.length > 0 && (
            <Block title="Reports each week">
              <div className="flex h-16 items-end gap-1" role="img" aria-label={`Reports each week: ${d.weekly_reports.map((w) => w.reports).join(", ")}`}>
                {d.weekly_reports.map((w) => (
                  <div key={w.week} className="flex-1 rounded-t-[2px] bg-brand/70" style={{ height: `${Math.max(4, (w.reports / max) * 100)}%` }} />
                ))}
              </div>
              <p className="mt-1 flex justify-between text-[0.8125rem] text-ink-2">
                <span>Earlier</span>
                <span>This week</span>
              </p>
            </Block>
          )}
          {d.incidents.length > 0 && (
            <Block title="Open problems here">
              <div className="-mx-4 border-y border-line divide-y divide-line">
                {d.incidents.slice(0, 6).map((i) => (
                  <ListRow
                    key={i.id}
                    leading={<CategoryBadge category={i.category} domain={i.domain} size={36} />}
                    title={problemTitle(i.title, i.category)}
                    subtitle={`Reported ${timeAgo(i.first_reported_at)}`}
                    trailing={<PriorityChip priority={i.priority} compact />}
                    onClick={() => onOpenIncident(i)}
                  />
                ))}
              </div>
            </Block>
          )}
          {d.recommendations.length > 0 && (
            <Block title="Ideas for the city">
              {d.recommendations.slice(0, 2).map((r) => (
                <div key={r.id} className="mb-2 rounded-md border border-line bg-surface-2 p-3">
                  <p className="text-[1rem] font-medium text-ink">{r.title}</p>
                  <p className="mt-0.5 text-[0.875rem] text-ink-2">A suggestion, not a fact.</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-[0.9375rem] text-ink-2">
                    {r.actions.slice(0, 3).map((a) => (
                      <li key={a.rank}>{a.title}</li>
                    ))}
                  </ol>
                  <p className="mt-1.5 text-[0.8125rem] text-ink-3">How sure we are: {Math.round(r.confidence * 100)}%</p>
                </div>
              ))}
            </Block>
          )}
        </>
      )}
    </div>
  );
}

function NeighbourhoodBody({ p }: { p: Record<string, any> }) {
  return (
    <div className="border-t border-line">
      <Block title="How it's doing">
        <div className="grid grid-cols-2 gap-x-5 gap-y-3">
          {DIMENSIONS.map((d) => (
            <DimensionBar key={d} label={DIMENSION_WORD[d].label} value={p[d]} />
          ))}
        </div>
        <Disclosure className="mt-1">
          <p>
            Each mark is out of 100 (higher is better). Worked out from people's reports and public data by our area score model (pulse-1).
          </p>
          <p className="num">{DIMENSIONS.map((d) => `${DIMENSION_WORD[d].label} ${p[d] != null ? Math.round(p[d]) : "–"}`).join(" · ")}</p>
        </Disclosure>
      </Block>
      {p.boundary_is_demo && (
        <p className="flex items-center gap-2 px-4 pt-3 text-[0.9375rem] text-ink-2">
          <DemoTag /> The area's border is sample data for demonstration.
        </p>
      )}
    </div>
  );
}

function RecommendationBody({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["recommendation", id], queryFn: () => api.recommendations.get(id) });
  const r = q.data;
  if (!r)
    return (
      <div className="px-4 pt-4 space-y-3 border-t border-line">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  const observed = Object.entries(r.observed ?? {}).filter(([, v]) => typeof v === "number" || typeof v === "string");
  return (
    <div className="border-t border-line">
      <Block title="What could be done">
        <ol className="space-y-2.5">
          {r.actions.map((a) => (
            <li key={a.rank} className="flex gap-3">
              <span className="num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface-3 text-[0.875rem] text-ink-2">{a.rank}</span>
              <div>
                <p className="text-[1rem] font-medium text-ink">{a.title}</p>
                <p className="text-[0.9375rem] text-ink-2">{a.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[0.9375rem] text-ink-2">This is a suggestion for the city team, not a fact.</p>
      </Block>
      <Block title="Why it's suggested">
        <Disclosure label="Show the numbers">
          <dl className="grid grid-cols-1 gap-y-1">
            {observed.slice(0, 8).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-2">{humanize(k)}</dt>
                <dd className="num text-ink">{typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(2)) : String(v)}</dd>
              </div>
            ))}
          </dl>
          <p>
            Model {r.model_version} · status {r.status} · {formatDate(r.created_at, false)} · {Math.round(r.confidence * 100)}% sure
          </p>
        </Disclosure>
      </Block>
    </div>
  );
}

function CellBody({ sel }: { sel: Extract<Selection, { kind: "cell" }> }) {
  const p = sel.properties;
  if (sel.layer !== "flood-pred")
    return (
      <div className="border-t border-line">
        <Block title="What this means">
          <p className="text-[1rem] leading-6 text-ink-2">The darker this patch, the more serious problems are still waiting to be fixed here.</p>
          <Disclosure className="mt-0.5">
            <p>
              Combined urgency of open problems in this ~0.7 km² hexagon (root-sum-square of problem urgency scores): <span className="num">{Math.round(p.value ?? 0)}</span>/100. Model grid-1.
            </p>
          </Disclosure>
        </Block>
      </div>
    );
  const c = json<Record<string, number>>(p.components) ?? {};
  return (
    <div className="border-t border-line">
      <Block title="What this means">
        <p className="text-[1rem] leading-6 text-ink-2">
          This is our <strong className="font-medium text-ink">guess</strong> of how likely this place is to flood, based on the rain forecast, how low the land is, past flooding and
          drain complaints. Places where people have actually seen flooding are drawn with a dashed line.
        </p>
      </Block>
      <Block title="What adds to the risk">
        <div className="space-y-2.5">
          {Object.entries(c).map(([k, v]) => (
            <div key={k}>
              <div className="flex justify-between text-[0.9375rem]">
                <span className="text-ink-2">{humanize(k)}</span>
                <span className="num text-ink">{Math.round(v * 100)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-[#3a5fae]" style={{ width: `${Math.round(v * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <Disclosure className="mt-1">
          <p>
            Predicted risk <span className="num">{Math.round((p.value ?? 0) * 100)}%</span> (model flood-1). About <span className="num">{Number(p.population ?? 0).toLocaleString("en-IN")}</span> people
            live in this patch.
          </p>
          {p.elevation_m != null && (
            <p>
              Height above sea level <span className="num">{Math.round(p.elevation_m)}</span> m (Copernicus DEM). Rain from the Open-Meteo forecast.
            </p>
          )}
          <p>
            <ProvenanceLabel kind="model+external" />
          </p>
        </Disclosure>
      </Block>
    </div>
  );
}

function AqiBody({ p }: { p: Record<string, any> }) {
  const w = aqiWord(p.us_aqi);
  return (
    <div className="border-t border-line">
      <Block title="What this means for you">
        <p className="flex items-start gap-2 text-[1rem] leading-6 text-ink-2">
          <Wind size={18} className="mt-1 shrink-0 text-ink-3" aria-hidden />
          {w.advice}
        </p>
        <Disclosure className="mt-0.5">
          <p>
            US AQI <span className="num">{p.us_aqi ?? "–"}</span> · fine dust (PM2.5) <span className="num">{p.pm2_5 != null ? Number(p.pm2_5).toFixed(1) : "–"}</span> µg/m³.
          </p>
          <p>
            This is an estimate for the whole area from {p.source ?? "a public weather service"}, not a sensor on your street.
            {p.is_demo ? " It is sample data for demonstration." : ""}
          </p>
        </Disclosure>
      </Block>
    </div>
  );
}
