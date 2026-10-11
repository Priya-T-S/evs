import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { SCORE_DIMENSIONS, aqiBand, formatDate, formatNumber, formatPct, gradeLabel, humanize, scoreColor, type ExternalReading, type Selection } from "@ecopulse/core";
import { api } from "@/lib/api";
import { ago } from "@/lib/hooks";
import { DemoTag, Drawer, ErrorState, Fact, InfoTip, Meter, ProvenanceBadge, Section } from "@/components/ui";
import { DIMENSION_HELP, SCORE_HELP } from "@/lib/glossary";
import { DrawerSkeleton } from "./IncidentDetail";

/* ------------------------------------------------------------------ neighbourhood */

export function NeighbourhoodDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ["score", id], queryFn: () => api.scores.location(id) });
  if (q.isPending) return <DrawerSkeleton onClose={onClose} />;
  if (q.isError || !q.data)
    return (
      <Drawer title="Neighbourhood" onClose={onClose}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Drawer>
    );
  const { location, score, change_7d, external, city_rank } = q.data;
  return (
    <Drawer
      onClose={onClose}
      eyebrow={
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span>Neighbourhood</span>
          <span aria-hidden>·</span>
          <span>
            pop. <span className="num">{formatNumber(location.population)}</span>
          </span>
          {location.boundary_is_demo && <DemoTag className="ml-auto" label="Demo boundary" />}
        </div>
      }
      title={location.name}
    >
      {!score ? (
        <p className="px-5 pb-4 text-[14px] text-ink-3">No environment score for this area yet. Scores are recalculated regularly as reports and readings come in.</p>
      ) : (
        <>
          <div className="flex items-end gap-5 px-5 pb-4">
            <div>
              <p className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
                Environment score <InfoTip label="Environment score">{SCORE_HELP}</InfoTip>
              </p>
              <p className="flex items-baseline gap-2">
                <span className="text-[34px] font-semibold leading-none tracking-tight" style={{ color: scoreColor(score.overall) }}>
                  {Math.round(score.overall)}
                </span>
                <span className="text-[14px] font-medium text-ink-2">{gradeLabel(score.overall)}</span>
              </p>
            </div>
            <dl className="flex gap-5 pb-1">
              {city_rank && (
                <div>
                  <dt className="text-[12px] text-ink-3">City rank</dt>
                  <dd className="num text-[14px]">
                    {city_rank.rank}
                    <span className="text-ink-3"> / {city_rank.of}</span>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[12px] text-ink-3">7-day change</dt>
                <dd className="num text-[14px]">{change_7d == null ? <span className="font-sans text-[13px] text-ink-3">no history yet</span> : `${change_7d > 0 ? "+" : ""}${change_7d.toFixed(1)} points`}</dd>
              </div>
            </dl>
            <span className="ml-auto pb-1">
              <ProvenanceBadge kind="model" detail={score.model_version} />
            </span>
          </div>

          <Section title="What the score is made of" help="Six parts, each scored 0–100 (higher is better). “Counts for” is how much each part weighs in the overall score." aside={<span className="text-[12px] text-ink-3">0–100, higher is better</span>}>
            <ul className="space-y-3.5">
              {SCORE_DIMENSIONS.map((dim) => {
                const v = score.dimensions[dim.key];
                const ex = score.explanation.dimensions[dim.key] ?? { method: "" };
                const weakest = score.explanation.weakest.includes(dim.key);
                const facts = Object.entries(ex).filter(([k, val]) => k !== "method" && k !== "external" && (typeof val === "number" || typeof val === "string"));
                return (
                  <li key={dim.key}>
                    <Meter
                      value={v}
                      color={scoreColor(v)}
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[14px] text-ink">{dim.label}</span>
                          <InfoTip label={dim.label} width={340}>
                            <span className="font-medium">How it’s calculated:</span> {ex.method}
                            {facts.length > 0 && <span className="mt-1 block text-ink-2">{facts.map(([k, val]) => `${humanize(k)} ${fmt(val)}`).join(" · ")}</span>}
                          </InfoTip>
                          {weakest && <span className="text-[11.5px] font-medium uppercase tracking-wide text-[color:var(--danger-ink)]">weakest</span>}
                          <span className="text-[12.5px] text-ink-3">· counts for {formatPct(score.explanation.weights[dim.key])}</span>
                        </span>
                      }
                    />
                    <p className="mt-1 text-[13px] leading-snug text-ink-3">{DIMENSION_HELP[dim.key]}</p>
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}

      <Section title="Air and weather readings" aside={<ProvenanceBadge kind="external" />}>
        {!external.aqi && !external.weather && <p className="text-[13px] text-ink-3">No air or weather readings for this area yet.</p>}
        {external.aqi && <AqiReading r={external.aqi} />}
        {external.weather && <WeatherReading r={external.weather} />}
      </Section>

      {location.boundary_is_demo && (
        <p className="flex gap-2 border-t border-line px-5 py-3 text-[12.5px] leading-snug text-ink-3">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          Neighbourhood boundaries are synthetic demo boundaries, not official ward limits. Scores aggregate data inside them.
        </p>
      )}
    </Drawer>
  );
}

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-IN") : v < 1 && v > 0 ? v.toFixed(2) : v.toFixed(1);
  return String(v);
}

function Source({ r }: { r: ExternalReading }) {
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
      <span>{r.source}</span>
      <span aria-hidden>·</span>
      <span title={formatDate(r.observed_at)}>observed {ago(r.observed_at)}</span>
      {r.is_demo && <DemoTag />}
    </p>
  );
}

function AqiReading({ r }: { r: ExternalReading }) {
  const aqi = r.value.us_aqi ?? null;
  const band = aqiBand(aqi);
  return (
    <div className="mb-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-ink-3 w-[84px]">Air quality</span>
        <span className="num text-[15px] font-medium">{aqi ?? "–"}</span>
        <span className="text-[12px] text-ink-3">US AQI</span>
        <span className="inline-flex items-center gap-1 text-[13px]">
          <span className="size-2 rounded-full" style={{ background: band.color }} aria-hidden />
          {band.label}
        </span>
      </div>
      <p className="ml-[92px] text-[12.5px] text-ink-2 tabular-nums">
        PM2.5 {r.value.pm2_5 ?? "–"} · PM10 {r.value.pm10 ?? "–"} · NO₂ {r.value.no2 ?? "–"} · O₃ {r.value.o3 ?? "–"} µg/m³
      </p>
      <div className="ml-[92px]">
        <Source r={r} />
      </div>
    </div>
  );
}

function WeatherReading({ r }: { r: ExternalReading }) {
  const v = r.value;
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] text-ink-3 w-[84px]">Weather</span>
        <span className="num text-[15px] font-medium">{v.temperature_c != null ? `${v.temperature_c}°C` : "–"}</span>
        <span className="tabular-nums text-[13px] text-ink-2">humidity {v.humidity_pct ?? "–"}% · wind {v.wind_kmh ?? "–"} km/h</span>
      </div>
      <p className="ml-[92px] tabular-nums text-[12.5px] text-ink-2">
        Rain: past 24 h {v.precip_past_24h_mm ?? "–"} mm · next 48 h {v.precip_next_48h_mm ?? "–"} mm (max {v.precip_max_probability_48h ?? "–"}% chance)
      </p>
      <div className="ml-[92px]">
        <Source r={r} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ grid cell */

const FLOOD_COMPONENT: Record<string, string> = {
  rain: "Rain forecast",
  low_lying: "Low-lying terrain",
  history: "Past waterlogging",
  drainage: "Drainage complaints",
  impervious: "Impervious surface",
};

function parseMaybe<T>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return null;
    }
  }
  return v as T;
}

export function CellDetail({ sel, onClose }: { sel: Extract<Selection, { kind: "cell" }>; onClose: () => void }) {
  const p = sel.properties;
  const flood = sel.layer === "flood-pred";
  const comps = parseMaybe<Record<string, number>>(p.components);
  const value = Number(p.value ?? 0);
  return (
    <Drawer
      onClose={onClose}
      eyebrow={
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span>{flood ? "Flood risk cell" : "Risk cell"} · ~0.7 km²</span>
          <span className="ml-auto">
            <ProvenanceBadge kind="model" detail={flood ? "flood-1" : "grid-1"} />
          </span>
        </div>
      }
      title={flood ? "Predicted flooding" : "Environmental risk"}
    >
      <div className="px-5 pb-4">
        {flood && (
          <p className="mb-3 rounded-sm border border-dashed px-3 py-2 text-[13px] text-ink-2" style={{ borderColor: "color-mix(in srgb, var(--prov-model) 60%, transparent)" }}>
            <span className="font-medium" style={{ color: "var(--prov-model)" }}>
              Predicted
            </span>{" "}
            — a model estimate from the rain forecast and terrain, not observed water. Observed waterlogging reports are drawn as dashed outlines.
          </p>
        )}
        <div className="flex items-baseline gap-2">
          <span className="num text-[30px] font-medium leading-none">{flood ? formatPct(value) : value.toFixed(0)}</span>
          <span className="text-[13px] text-ink-3">{flood ? "predicted flood risk" : "combined risk (0–100) of open incidents"}</span>
        </div>
        <dl className="mt-3 divide-y divide-line">
          {p.population != null && <Fact label="Population (est.)">{<span className="num">{formatNumber(Number(p.population))}</span>}</Fact>}
          {flood && p.rain_mm != null && (
            <Fact label="Rain forecast">
              <span className="num">{Number(p.rain_mm).toFixed(1)} mm</span>
              <span className="text-ink-3"> · Open-Meteo Forecast</span>
            </Fact>
          )}
          {flood && p.elevation_m != null && (
            <Fact label="Elevation">
              <span className="num">{Number(p.elevation_m).toFixed(0)} m</span>
              <span className="text-ink-3"> · Copernicus DEM</span>
            </Fact>
          )}
          <Fact label="Cell">
            <span className="num text-ink-3">{String(p.h3 ?? sel.id)}</span>
          </Fact>
        </dl>
      </div>
      {flood && comps && (
        <Section title="Why this cell" aside={<span className="text-[12px] text-ink-3">component scores 0–1</span>}>
          <ul className="space-y-1.5">
            {Object.entries(comps).map(([k, v]) => (
              <li key={k} className="grid grid-cols-[140px_1fr_40px] items-center gap-2">
                <span className="text-[13px] text-ink-2">{FLOOD_COMPONENT[k] ?? humanize(k)}</span>
                <span className="h-2 rounded-r-[2px] bg-surface-3">
                  <span className="block h-full rounded-r-[2px]" style={{ width: `${Math.min(1, v) * 100}%`, background: "var(--prov-model)" }} />
                </span>
                <span className="num text-right text-[12.5px]">{v.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ AQI station */

export function AqiDetail({ sel, onClose }: { sel: Extract<Selection, { kind: "aqi" }>; onClose: () => void }) {
  const p = sel.properties;
  const aqi = p.us_aqi != null ? Number(p.us_aqi) : null;
  const band = aqiBand(aqi);
  const demo = p.is_demo === true || p.is_demo === "true";
  return (
    <Drawer
      onClose={onClose}
      eyebrow={
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span>Air quality</span>
          <span className="ml-auto flex items-center gap-1.5">
            {demo && <DemoTag />}
            <ProvenanceBadge kind="external" />
          </span>
        </div>
      }
      title={String(p.name ?? "Neighbourhood")}
    >
      <div className="px-5 pb-4">
        <div className="flex items-baseline gap-3">
          <span className="num text-[34px] font-medium leading-none">{aqi ?? "–"}</span>
          <span className="text-[13px] text-ink-3">US AQI</span>
          <span className="inline-flex items-center gap-1.5 text-[14px] font-medium">
            <span className="size-2.5 rounded-full" style={{ background: band.color }} aria-hidden />
            {band.label}
          </span>
        </div>
        <dl className="mt-4 divide-y divide-line">
          <Fact label="PM2.5">
            <span className="num">{p.pm2_5 ?? "–"} µg/m³</span>
          </Fact>
          <Fact label="Source">{String(p.source ?? "–")}</Fact>
          <Fact label="Observed">
            <span className="num" title={formatDate(String(p.observed_at))}>
              {p.observed_at ? ago(String(p.observed_at)) : "–"}
            </span>
          </Fact>
        </dl>
        <p className="mt-3 text-[12.5px] text-ink-3">Modelled atmospheric reading (CAMS) for the neighbourhood centroid — not a ground sensor.</p>
      </div>
    </Drawer>
  );
}
