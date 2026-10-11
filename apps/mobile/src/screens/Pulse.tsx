import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import { formatTrend, type PulseItem } from "@ecopulse/core";
import { usePulse } from "../lib/queries";
import { usePosition } from "../lib/location";
import { useRealtimeStatus } from "../lib/realtime";
import { useUi } from "../lib/ui";
import { useNetwork } from "../lib/network";
import { useNavigate } from "react-router-dom";
import { TabTitle } from "../components/ScreenHeader";
import { PulseFeedRow } from "../components/PulseFeedRow";
import { CategoryBadge } from "../components/CategoryIcon";
import { StatusBanners } from "../components/StatusBanners";
import { Disclosure, EmptyState, ErrorState, ListRow, ProvenanceLabel, SectionHeader, Segmented, Skeleton, SkeletonRows, cx } from "../components/ui";
import { urgencyWord } from "../lib/words";

const keyOf = (i: PulseItem) => `${i.incident_id}-${i.event}-${i.at}`;

export function PulseScreen() {
  const [scope, setScope] = useState<"near" | "city">("near");
  const pos = usePosition();
  const q = usePulse(scope, pos);
  const online = useNetwork((s) => s.online);
  const open = useUi((s) => s.openIncident);
  const focusMap = useUi((s) => s.focusMap);
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const data = q.data;

  // Track which feed items arrived after the first render, so they can animate in and be highlighted.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    seen.current = null;
    setFresh(new Set());
  }, [scope]);
  useEffect(() => {
    if (!data) return;
    const keys = data.feed.map(keyOf);
    if (!seen.current) {
      seen.current = new Set(keys);
      return;
    }
    const added = keys.filter((k) => !seen.current!.has(k));
    added.forEach((k) => seen.current!.add(k));
    if (added.length) {
      setFresh(new Set(added));
      const t = setTimeout(() => setFresh(new Set()), 6000);
      return () => clearTimeout(t);
    }
  }, [data]);

  return (
    <div className="scroll-area h-full pb-8">
      <TabTitle title="Activity" sub={<ConnectionState />} />
      <StatusBanners showLocation={scope === "near"} />

      <div className="px-4 pt-3">
        <Stats loading={q.isLoading && !data} stats={data?.stats} />
      </div>

      <div className="px-4 pt-4">
        <Segmented
          label="Show activity"
          value={scope}
          onChange={setScope}
          options={[
            { value: "near", label: "Near me" },
            { value: "city", label: data?.city ?? "City" },
          ]}
        />
      </div>

      <SectionHeader title="Latest updates" aside={<ProvenanceLabel kind="observed" />} />
      {q.isLoading && !data ? (
        <SkeletonRows rows={5} />
      ) : q.isError && !data ? (
        <ErrorState offline={!online} message="We couldn't load the latest updates." onRetry={() => q.refetch()} />
      ) : !data?.feed.length ? (
        <div className="border-y border-line bg-surface">
          <EmptyState title={scope === "near" ? "Nothing new within 3 km" : "Nothing new lately"} body="New reports and fixes show up here as they happen." />
        </div>
      ) : (
        <ul className="border-y border-line bg-surface divide-y divide-line" aria-live="polite">
          <AnimatePresence initial={false}>
            {data.feed.slice(0, 30).map((item) => (
              <motion.li
                key={keyOf(item)}
                layout={!reduced}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <PulseFeedRow item={item} fresh={fresh.has(keyOf(item))} onClick={() => open(item.incident_id)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <SectionHeader title="Problem areas getting worse" />
      {q.isLoading && !data ? (
        <SkeletonRows rows={3} />
      ) : !data?.rising_hotspots.length ? (
        <div className="border-y border-line bg-surface">
          <EmptyState title="No problem areas getting worse" body="A problem area is a place where many problems are reported close together." />
        </div>
      ) : (
        <div className="border-y border-line bg-surface divide-y divide-line">
          {data.rising_hotspots.slice(0, 6).map((h) => (
            <ListRow
              key={h.id}
              leading={<CategoryBadge domain={h.domain} size={36} />}
              title={h.name}
              subtitle={
                <>
                  {h.active_incidents} problem{h.active_incidents === 1 ? "" : "s"} not fixed yet
                </>
              }
              trailing={
                <div>
                  <div className="text-[0.9375rem] font-medium text-ink">Urgency: {urgencyWord(h.risk_score)}</div>
                  {h.trend_pct > 0 && (
                    <div className="flex items-center justify-end gap-1 text-[0.875rem] text-ink-2">
                      <TrendingUp size={15} className="text-p2" aria-hidden />
                      More reports lately
                    </div>
                  )}
                </div>
              }
              label={`${h.name}, urgency ${urgencyWord(h.risk_score)}${h.trend_pct > 0 ? ", more reports lately" : ""}`}
              onClick={() => {
                focusMap({ hotspotId: h.id });
                navigate("/map");
              }}
            />
          ))}
        </div>
      )}
      {!!data?.rising_hotspots.length && (
        <Disclosure className="px-4 pt-2">
          <p>
            Urgency is a score out of 100 worked out by our problem-area model (hotspot-1). “More reports lately” compares the last 14 days with the 14 days before.
          </p>
          <ul className="num space-y-0.5">
            {data.rising_hotspots.slice(0, 6).map((h) => (
              <li key={h.id}>
                {h.name}: urgency {Math.round(h.risk_score)} · reports {formatTrend(h.trend_pct)}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

function Stats({ loading, stats }: { loading: boolean; stats?: { new_incidents_24h: number; resolved_24h: number; active_hotspots: number } }) {
  const cells = [
    { label: "New today", value: stats?.new_incidents_24h },
    { label: "Fixed today", value: stats?.resolved_24h },
    { label: "Problem areas", value: stats?.active_hotspots },
  ];
  return (
    <dl className="grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface">
      {cells.map((c) => (
        <div key={c.label} className="px-3.5 py-3">
          <dt className="text-[0.8438rem] text-ink-3">{c.label}</dt>
          <dd className="num mt-1 text-[1.5625rem] font-medium leading-7 text-ink">{loading ? <Skeleton className="h-6 w-10" /> : (c.value ?? "–")}</dd>
        </div>
      ))}
    </dl>
  );
}

function ConnectionState() {
  const s = useRealtimeStatus();
  const map = {
    live: { label: "Live — updates appear by themselves", cls: "bg-ok", pulse: true },
    connecting: { label: "Connecting…", cls: "bg-p3", pulse: false },
    reconnecting: { label: "Reconnecting…", cls: "bg-p3", pulse: false },
    offline: { label: "Offline — showing the last update", cls: "bg-ink-3", pulse: false },
  }[s];
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span className={cx("inline-block h-2 w-2 rounded-full", map.cls, map.pulse && "live-dot")} aria-hidden />
      {map.label}
    </span>
  );
}
