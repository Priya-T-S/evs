import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Bell, Camera, ChevronRight, CircleCheck, Frown, Lightbulb, MapPin, Meh, Smile, Users } from "lucide-react";
import { greeting, humanize, scoreColor, type AreaScore, type ScoreDimension } from "@ecopulse/core";
import { formatDistance, timeAgo } from "../lib/format";
import { useMe, useMeta, useNearby, useNotifications, usePulse, useScore, type NearbyIncident } from "../lib/queries";
import { usePosition } from "../lib/location";
import { useUi } from "../lib/ui";
import { useNetwork } from "../lib/network";
import { haptic } from "../lib/haptics";
import { DEFAULT_CITY, NEARBY_RADIUS_M, PULSE_RADIUS_M } from "../lib/config";
import { DIMENSIONS, DIMENSION_WORD, TIPS, aqiWord, areaSentence, gradeWord, levelWord, problemTitle } from "../lib/words";
import { CategoryBadge } from "../components/CategoryIcon";
import { PulseFeedRow } from "../components/PulseFeedRow";
import { StatusBanners } from "../components/StatusBanners";
import {
  Button,
  DemoTag,
  DimensionBar,
  Disclosure,
  EmptyState,
  ErrorState,
  IconButton,
  ListRow,
  PriorityChip,
  ProvenanceLabel,
  SectionHeader,
  Sheet,
  SheetTitle,
  Skeleton,
  SkeletonRows,
} from "../components/ui";

const WEEK = 7 * 24 * 3600 * 1000;
/** Open problems that still need neighbours to say "yes, it's real". */
const needsConfirming = (i: NearbyIncident) => i.status === "reported" || i.status === "ai_classified";

export function HomeScreen() {
  const navigate = useNavigate();
  const pos = usePosition();
  const me = useMe();
  const meta = useMeta();
  const city = meta.data?.city.name ?? DEFAULT_CITY;
  const score = useScore(pos);
  const nearby = useNearby(pos);
  const notifications = useNotifications();
  const unread = notifications.data?.unread ?? 0;
  const firstName = me.data && !me.data.is_guest ? me.data.display_name.split(" ")[0] : null;
  const area = score.data?.location.name;

  return (
    <div className="scroll-area h-full pb-10">
      <header className="flex items-start justify-between gap-3 px-4 pt-[calc(env(safe-area-inset-top)+14px)]">
        <div className="min-w-0">
          <p className="text-[1rem] text-ink-2">
            {greeting()}
            {firstName ? `, ${firstName}` : ""}
          </p>
          <h1 className="mt-0.5 text-[1.625rem] font-semibold leading-8 tracking-[-0.015em] text-ink">
            <span className="block truncate">{area ?? (score.isLoading ? <Skeleton className="h-6 w-40" /> : city)}</span>
          </h1>
          <p className="mt-0.5 flex items-center gap-1 text-[0.9375rem] text-ink-2">
            <MapPin size={15} aria-hidden />
            {pos.source === "gps" ? `Near you · ${city}` : pos.fallback === "home" ? `Your home area · ${city}` : `${city} city centre`}
          </p>
        </div>
        <IconButton label="Messages for you" icon={Bell} badge={unread} onClick={() => navigate("/inbox")} className="-mr-2" />
      </header>

      <StatusBanners />

      <Summary data={score.data} nearby={nearby.data} />

      <WhatYouCanDo data={score.data} nearby={nearby.data} />

      <AreaCard data={score.data} loading={score.isLoading} error={score.isError && !score.data} onRetry={() => score.refetch()} />

      <Nearby />
      <LiveActivity />
    </div>
  );
}

/** One or two plain sentences about the area right now. */
function Summary({ data, nearby }: { data?: AreaScore; nearby?: NearbyIncident[] }) {
  const aqi = data?.external.aqi?.value.us_aqi;
  const sentences: string[] = [];
  if (aqi != null) sentences.push(`Air quality is ${aqiWord(aqi).word} today.`);
  if (nearby) {
    const week = nearby.filter((i) => Date.now() - Date.parse(i.first_reported_at) < WEEK).length;
    sentences.push(
      week === 0
        ? "No new problems were reported near you this week."
        : `${week >= 20 ? "Many" : week} problem${week === 1 ? " was" : "s were"} reported near you this week.`,
    );
  }
  if (!sentences.length)
    return (
      <div className="px-4 pt-3">
        <Skeleton className="h-5 w-4/5" />
      </div>
    );
  return (
    <p className="px-4 pt-3 text-[1.125rem] leading-[1.625rem] text-ink" aria-live="polite">
      {sentences.join(" ")}
    </p>
  );
}

function WhatYouCanDo({ data, nearby }: { data?: AreaScore; nearby?: NearbyIncident[] }) {
  const navigate = useNavigate();
  const open = useUi((s) => s.openIncident);
  const toConfirm = (nearby ?? []).filter(needsConfirming);
  const s = data?.score;
  const weakest: ScoreDimension | undefined = s ? (s.explanation.weakest[0] ?? [...DIMENSIONS].sort((a, b) => s.dimensions[a] - s.dimensions[b])[0]) : undefined;

  return (
    <section aria-labelledby="do-h">
      <SectionHeader id="do-h" title="What you can do" />
      <div className="px-4">
        <Button
          block
          size="lg"
          icon={Camera}
          onClick={() => {
            haptic.medium();
            navigate("/report");
          }}
          className="h-16 text-[1.1875rem]"
        >
          Report a problem
        </Button>
      </div>
      <div className="mx-4 mt-3 overflow-hidden rounded-lg border border-line bg-surface divide-y divide-line">
        <ListRow
          leading={
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-brand-soft text-brand" aria-hidden>
              <CircleCheck size={21} />
            </span>
          }
          title="Confirm problems near you"
          subtitle={
            !nearby
              ? "Checking…"
              : toConfirm.length
                ? `${toConfirm.length} problem${toConfirm.length === 1 ? " needs" : "s need"} a quick yes or no from someone nearby`
                : "Nothing to confirm right now. Thank you!"
          }
          chevron={toConfirm.length > 0}
          onClick={
            toConfirm.length
              ? () => {
                  haptic.tap();
                  open(toConfirm[0].id);
                }
              : undefined
          }
        />
        {weakest && (
          <div className="flex items-start gap-3 px-4 py-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-warn-soft text-[var(--prov-recommendation)]" aria-hidden>
              <Lightbulb size={21} />
            </span>
            <div className="min-w-0">
              <p className="text-[1.0625rem] font-medium text-ink">Tip for {DIMENSION_WORD[weakest].label.toLowerCase()}</p>
              <p className="mt-0.5 text-[0.9375rem] leading-[1.375rem] text-ink-2">{TIPS[weakest]}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const GRADE_ICON = { Good: Smile, Okay: Meh, Poor: Frown, "Very poor": AlertTriangle, "No data": Meh } as const;

function AreaCard({ data, loading, error, onRetry }: { data?: AreaScore; loading: boolean; error: boolean; onRetry: () => void }) {
  const [open, setOpen] = useState(false);
  const online = useNetwork((s) => s.online);
  const s = data?.score;
  const aqi = data?.external.aqi;
  const change = data?.change_7d;
  const g = gradeWord(s?.overall);
  const Icon = GRADE_ICON[g.word as keyof typeof GRADE_ICON] ?? Meh;
  const color = scoreColor(s?.overall);

  return (
    <section aria-labelledby="area-h">
      <SectionHeader id="area-h" title="How your area is doing" aside={data?.city_rank ? <span>No. {data.city_rank.rank} of {data.city_rank.of} areas</span> : null} />
      <div className="mx-4 rounded-lg border border-line bg-surface">
        {loading && !data ? (
          <div className="space-y-3 px-4 py-4" aria-busy="true" aria-label="Loading">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : error ? (
          <ErrorState offline={!online} message="We couldn't load your area's score." onRetry={onRetry} className="py-6" />
        ) : !s ? (
          <EmptyState title="No score for this area yet" body="We only have scores for neighbourhoods in the city for now." className="py-6" />
        ) : (
          <>
            <div className="px-4 pt-4">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg" style={{ background: `color-mix(in srgb, ${color} 14%, var(--surface))`, color }} aria-hidden>
                  <Icon size={26} strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <p className="text-[1.5rem] font-semibold leading-7 text-ink">{g.word}</p>
                  <p className="text-[0.9375rem] text-ink-2">
                    Score <span className="num text-ink">{Math.round(s.overall)}</span> out of 100
                    {change != null && Math.abs(change) >= 1 ? (change > 0 ? " · better than last week" : " · worse than last week") : change != null ? " · same as last week" : ""}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-[1.0625rem] leading-6 text-ink">{areaSentence(s.overall, s.dimensions, s.explanation.weakest)}</p>
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 px-4 pt-4">
              {DIMENSIONS.map((d) => (
                <DimensionBar key={d} label={DIMENSION_WORD[d].label} value={s.dimensions[d]} weakest={s.explanation.weakest.includes(d)} />
              ))}
            </div>
            <div className="mt-4 border-t border-line px-4 pt-3 pb-1">
              <p className="text-[0.9375rem] leading-[1.375rem] text-ink-2">
                Based on reports from people nearby{aqi ? " and today's air quality reading" : ""}. Updated {timeAgo(s.computed_at)}.
              </p>
              {(aqi?.is_demo || data?.location.boundary_is_demo) && (
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.875rem] text-ink-2">
                  <DemoTag />
                  {aqi?.is_demo ? "The air reading is an example, used for demonstration." : "The area's border is an example, used for demonstration."}
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  haptic.tap();
                  setOpen(true);
                }}
                className="pressable -ml-1 inline-flex min-h-12 items-center gap-1 px-1 text-[0.9375rem] font-medium text-brand"
              >
                How do we know this? <ChevronRight size={17} aria-hidden />
              </button>
            </div>
          </>
        )}
      </div>
      {data && s && <ScoreSheet open={open} onClose={() => setOpen(false)} data={data} />}
    </section>
  );
}

const INPUT_LABEL: Record<string, string> = {
  citizen_load_per_km2: "Problems per km² (weighted)",
  open_incidents: "Open problems",
  us_aqi: "Air quality index (US AQI)",
  pm2_5: "Fine dust (PM2.5)",
  incidents_60d: "Problems in 60 days",
  resolved_share: "Share fixed",
  median_days_open: "Typical days open",
  green_area_share: "Green area",
  tree_loss_incidents: "Tree-loss reports",
  mean_measured_db_30d: "Measured noise (30 days)",
};

function formatInput(key: string, v: unknown): string {
  if (v == null) return "–";
  if (typeof v === "number") {
    if (/share/.test(key)) return `${Math.round(v * 100)}%`;
    if (/days/.test(key)) return `${v.toFixed(1)} days`;
    if (/per_km2/.test(key)) return `${v.toFixed(1)}`;
    if (/db/.test(key)) return `${v.toFixed(0)} dB`;
    return Number.isInteger(v) ? String(v) : v.toFixed(1);
  }
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function ScoreSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: AreaScore }) {
  const s = data.score!;
  return (
    <Sheet open={open} onClose={onClose} title="How we work out your area's score" header={<SheetTitle sub={data.location.name}>How we work out your area's score</SheetTitle>}>
      <div className="px-4 pb-[calc(24px+env(safe-area-inset-bottom))]">
        <p className="text-[1rem] leading-6 text-ink-2">
          We look at six things and give each a mark out of 100 — higher is better. The overall score is a mix of the six. It changes as people report problems and as problems get
          fixed. Updated {timeAgo(s.computed_at)}.
        </p>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {DIMENSIONS.map((d) => {
            const ex = s.explanation.dimensions[d];
            const inputs = Object.entries(ex ?? {}).filter(([k]) => k !== "method");
            const flat = inputs.flatMap(([k, v]) =>
              v && typeof v === "object" ? Object.entries(v as Record<string, unknown>).filter(([kk]) => kk !== "source" && kk !== "is_demo").map(([kk, vv]) => [kk, vv] as const) : [[k, v] as const],
            );
            const ext = inputs.find(([k]) => k === "external")?.[1] as { source?: string; is_demo?: boolean } | undefined;
            const v = s.dimensions[d];
            return (
              <li key={d} className="py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[1.0625rem] font-medium text-ink">{DIMENSION_WORD[d].label}</span>
                  <span className="text-[1rem] font-medium text-ink">
                    {levelWord(v)} <span className="num text-[0.9375rem] font-normal text-ink-2">· {Math.round(v)}/100</span>
                  </span>
                </div>
                <p className="mt-0.5 text-[0.9375rem] text-ink-2">{DIMENSION_WORD[d].hint}</p>
                {ext?.is_demo && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[0.875rem] text-ink-2">
                    <DemoTag /> Uses sample data for demonstration
                  </p>
                )}
                <Disclosure label="Details" className="mt-0.5">
                  <p>
                    Counts for <span className="num">{Math.round((s.explanation.weights[d] ?? 0) * 100)}%</span> of the overall score.
                  </p>
                  {flat.length > 0 && (
                    <dl className="grid grid-cols-1 gap-y-1">
                      {flat.map(([k, val]) => (
                        <div key={k} className="flex justify-between gap-3">
                          <dt className="text-ink-2">{INPUT_LABEL[k] ?? humanize(k)}</dt>
                          <dd className="num text-ink">{formatInput(k, val)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {ex?.method && <p className="num break-words text-[0.8125rem] text-ink-2">Formula: {ex.method}</p>}
                  {ext?.source && (
                    <p>
                      <ProvenanceLabel kind="external" detail={ext.source} />
                    </p>
                  )}
                </Disclosure>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[0.9375rem] leading-[1.375rem] text-ink-2">Scores come from what people report. An area with few reports can look better than it really is.</p>
        <Disclosure label="Technical details" className="mt-1">
          <p>
            Model <span className="num">{s.model_version}</span> · area <span className="num">{s.explanation.area_km2.toFixed(1)}</span> km² · computed {timeAgo(s.computed_at)}.
          </p>
          <p>“Problems per km²” counts open problems in the area, weighted by how serious they are.</p>
          <p>
            <ProvenanceLabel kind={data.external.aqi ? "model+external" : "model"} detail={data.external.aqi ? `air reading from ${data.external.aqi.source}` : undefined} />
          </p>
        </Disclosure>
      </div>
    </Sheet>
  );
}

function Nearby() {
  const pos = usePosition();
  const navigate = useNavigate();
  const online = useNetwork((s) => s.online);
  const q = useNearby(pos);
  const open = useUi((s) => s.openIncident);
  const items = q.data ?? [];
  return (
    <section aria-labelledby="nearby-h">
      <SectionHeader id="nearby-h" title="Problems near you" aside={q.data ? <>within {formatDistance(NEARBY_RADIUS_M)}</> : null} />
      {q.isLoading && !q.data ? (
        <SkeletonRows rows={3} />
      ) : q.isError && !q.data ? (
        <ErrorState offline={!online} message="We couldn't load problems near you." onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <div className="border-y border-line bg-surface">
          <EmptyState title="No open problems near you" body="Nothing has been reported within 2 km. Seen something? Report it." />
        </div>
      ) : (
        <>
          <div className="border-y border-line bg-surface divide-y divide-line">
            {items.slice(0, 5).map((i) => (
              <ListRow
                key={i.id}
                leading={<CategoryBadge category={i.category} domain={i.domain} />}
                title={problemTitle(i.title, i.category)}
                subtitle={`${formatDistance(i.distance_m)} away · ${timeAgo(i.last_reported_at)}`}
                meta={
                  <>
                    <PriorityChip priority={i.priority} />
                    {i.reporter_count > 1 && (
                      <span className="inline-flex items-center gap-1 text-[0.875rem] text-ink-2">
                        <Users size={15} aria-hidden />
                        {i.reporter_count} people reported this
                      </span>
                    )}
                  </>
                }
                onClick={() => open(i.id)}
              />
            ))}
          </div>
          {items.length > 5 && (
            <button type="button" onClick={() => navigate("/map")} className="pressable flex min-h-12 w-full items-center justify-center gap-1 text-[1rem] font-medium text-brand">
              See all {items.length} on the map <ChevronRight size={17} aria-hidden />
            </button>
          )}
        </>
      )}
    </section>
  );
}

function LiveActivity() {
  const pos = usePosition();
  const q = usePulse("near", pos);
  const open = useUi((s) => s.openIncident);
  const navigate = useNavigate();
  const feed = q.data?.feed.slice(0, 5) ?? [];
  return (
    <section aria-labelledby="live-h">
      <SectionHeader
        id="live-h"
        title={
          <span className="inline-flex items-center gap-2">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-ok" aria-hidden />
            Happening nearby
          </span>
        }
        aside={<span>within {formatDistance(PULSE_RADIUS_M)}</span>}
      />
      {q.isLoading && !q.data ? (
        <SkeletonRows rows={3} />
      ) : feed.length === 0 ? (
        <div className="border-y border-line bg-surface">
          <EmptyState title="All quiet near you" body="New reports and fixes nearby will show up here as they happen." />
        </div>
      ) : (
        <>
          <div className="border-y border-line bg-surface divide-y divide-line" aria-live="polite">
            {feed.map((item) => (
              <PulseFeedRow key={`${item.incident_id}-${item.at}`} item={item} onClick={() => open(item.incident_id)} />
            ))}
          </div>
          <button type="button" onClick={() => navigate("/pulse")} className="pressable flex min-h-12 w-full items-center justify-center gap-1 text-[1rem] font-medium text-brand">
            See activity across the city <ChevronRight size={17} aria-hidden />
          </button>
        </>
      )}
    </section>
  );
}
