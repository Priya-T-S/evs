import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, TrendingDown, TrendingUp } from "lucide-react";
import maplibregl from "maplibre-gl";
import { DOMAIN, formatPct, formatTrend, type Domain, type Hotspot, type LayerId, type Selection } from "@ecopulse/core";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { TopBar } from "@/components/layout/AppShell";
import { MapView, type MapHandle } from "@/components/map/MapView";
import { Drawer, DomainTag, EmptyState, ErrorState, InfoTip, ProvenanceBadge, Select, SkeletonRows, Tabs } from "@/components/ui";
import { HOTSPOT_HELP } from "@/lib/glossary";
import { HotspotBody, useHotspot } from "@/features/detail/HotspotDetail";
import { DrawerSkeleton } from "@/features/detail/IncidentDetail";
import { DetailPanel } from "@/features/detail/DetailPanel";

type Kind = "observed" | "predicted";
type SortKey = "risk" | "trend" | "reports";
const LAYERS: LayerId[] = ["hotspots", "incidents"];
const DRAWER_W = 440;

export default function Hotspots() {
  const [kind, setKind] = useState<Kind>("observed");
  const [sort, setSort] = useState<SortKey>("risk");
  const [domain, setDomain] = useState<Domain | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [other, setOther] = useState<Selection | null>(null);
  const [mh, setMh] = useState<MapHandle | null>(null);

  const q = useQuery({ queryKey: ["hotspots", "list", "all"], queryFn: () => api.hotspots.list({ kind: "all", status: "active", limit: 200 }) });
  const all = q.data?.items ?? [];
  const counts = { observed: all.filter((h) => h.kind === "observed").length, predicted: all.filter((h) => h.kind === "predicted").length };
  const rows = useMemo(() => {
    const r = all.filter((h) => h.kind === kind && (!domain || h.domain === domain));
    const key: Record<SortKey, (h: Hotspot) => number> = { risk: (h) => h.risk_score, trend: (h) => h.trend_pct, reports: (h) => h.report_count };
    return [...r].sort((a, b) => key[sort](b) - key[sort](a));
  }, [all, kind, domain, sort]);

  // Auto-select the top hotspot so the map is never an empty frame.
  useEffect(() => {
    if (!selectedId && rows[0]) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  const detail = useHotspot(selectedId ?? "");
  const h = selectedId ? detail.data : undefined;

  // Focus the map on the selected hotspot boundary.
  useEffect(() => {
    const m = mh;
    if (!m || !h) return;
    const b = new maplibregl.LngLatBounds();
    for (const ring of h.geometry.coordinates) for (const [x, y] of ring) b.extend([x, y]);
    if (b.isEmpty()) b.extend([h.lon, h.lat]);
    m.map.fitBounds(b, { padding: { top: 80, bottom: 80, left: 80, right: 80 + DRAWER_W }, maxZoom: 15.5, duration: 600 });
    const sel = () => m.controller.select({ kind: "hotspot", id: h.id });
    if (m.map.getSource("hotspots")) sel();
    else m.map.once("load", sel);
  }, [h, mh]);

  const onMapSelect = useCallback((s: Selection | null) => {
    if (!s) return;
    if (s.kind === "hotspot") {
      setOther(null);
      setSelectedId(String(s.id));
    } else setOther(s);
  }, []);

  return (
    <>
      <TopBar title="Hotspots" />
      <main id="main" className="relative flex min-h-0 flex-1">
        <div className="flex w-[380px] shrink-0 flex-col border-r border-line bg-surface">
          <div className="px-4 pt-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <h1 className="text-[15px] font-semibold">Active hotspots</h1>
                <InfoTip label="Hotspot" side="right">{HOTSPOT_HELP}</InfoTip>
              </span>
              <ProvenanceBadge kind="model" detail="hotspot-1" />
            </div>
            <Tabs
              label="Hotspot type"
              size="sm"
              value={kind}
              onChange={(k) => {
                setKind(k);
                setSelectedId(null);
              }}
              items={[
                { key: "observed", label: "Happening now", count: counts.observed },
                { key: "predicted", label: "Forecast (next 14 days)", count: counts.predicted },
              ]}
            />
            <div className="grid grid-cols-2 gap-2 pb-2.5">
              <Select aria-label="Filter by domain" value={domain} onChange={(e) => setDomain(e.target.value as Domain | "")} className="[&_select]:h-7 [&_select]:text-[13px]">
                <option value="">All problem types</option>
                {(Object.keys(DOMAIN) as Domain[]).map((d) => (
                  <option key={d} value={d}>
                    {DOMAIN[d].label}
                  </option>
                ))}
              </Select>
              <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="[&_select]:h-7 [&_select]:text-[13px]">
                <option value="risk">Sort: risk</option>
                <option value="trend">Sort: growing fastest</option>
                <option value="reports">Sort: most reports</option>
              </Select>
            </div>
          </div>
          {kind === "predicted" && (
            <p className="border-y border-line bg-surface-2 px-4 py-2 text-[12.5px] leading-snug text-ink-2">
              <span className="font-medium" style={{ color: "var(--prov-model)" }}>
                Forecasts
              </span>{" "}
              are model predictions of where a hotspot is likely to emerge in the next 14 days. Nothing has been observed there yet.
            </p>
          )}
          <div className="grid grid-cols-[1fr_44px_60px_56px] gap-2 border-b border-line px-4 pb-1.5 pt-1 text-[11.5px] uppercase tracking-wider text-ink-3">
            <span>Hotspot</span>
            <SortHead active={sort === "risk"} label="Risk" />
            <SortHead active={sort === "trend"} label="Trend" />
            <SortHead active={sort === "reports"} label="Reports" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {q.isPending && <SkeletonRows rows={8} />}
            {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
            {q.isSuccess && rows.length === 0 && <EmptyState title="No hotspots match these filters" hint="Choose “All problem types”, or switch between “Happening now” and “Forecast”." />}
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => {
                      setOther(null);
                      setSelectedId(r.id);
                    }}
                    aria-current={r.id === selectedId ? "true" : undefined}
                    className={cn("relative grid w-full grid-cols-[1fr_44px_60px_56px] items-center gap-2 px-4 py-2 text-left", r.id === selectedId ? "bg-surface-3" : "hover:bg-surface-2")}
                  >
                    {r.id === selectedId && <span className="absolute inset-y-0 left-0 w-[2px] bg-brand" aria-hidden />}
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{r.name}</span>
                      <span className="flex items-center gap-2 text-[12.5px] text-ink-3">
                        <DomainTag domain={r.domain} />
                        <span className="truncate">{r.primary_category_label}</span>
                        {r.kind === "predicted" && <span className="num">{formatPct(r.confidence)} conf.</span>}
                      </span>
                    </span>
                    <span className="num text-right text-[14px]">{r.risk_score.toFixed(0)}</span>
                    <span className={cn("num flex items-center justify-end gap-0.5 text-[12.5px]", r.trend_pct > 0 ? "text-[color:var(--danger-ink)]" : "text-ok")}>
                      {r.trend_pct > 0 ? <TrendingUp className="size-3" aria-label="rising" /> : <TrendingDown className="size-3" aria-label="falling" />}
                      {formatTrend(r.trend_pct)}
                    </span>
                    <span className="num text-right text-[13px] text-ink-2">{r.report_count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="relative min-w-0 flex-1">
          <MapView layers={LAYERS} onReady={setMh} onSelect={onMapSelect} live insetRight={DRAWER_W} label="Map of the selected hotspot" />
        </div>
        <AnimatePresence initial={false}>
          {(selectedId || other) && (
            <motion.div key="drawer" className="absolute inset-y-0 right-0 z-20 shadow-2" style={{ width: DRAWER_W }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {other ? (
                <DetailPanel sel={other} onClose={() => setOther(null)} onSelect={onMapSelect} />
              ) : detail.isPending ? (
                <DrawerSkeleton onClose={() => setSelectedId(null)} />
              ) : detail.isError || !h ? (
                <Drawer title="Hotspot" onClose={() => setSelectedId(null)}>
                  <ErrorState error={detail.error} onRetry={() => detail.refetch()} />
                </Drawer>
              ) : (
                <Drawer
                  onClose={() => setSelectedId(null)}
                  eyebrow={
                    <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
                      <span>{h.kind === "predicted" ? "Forecast hotspot" : "Observed hotspot"}</span>
                      <span aria-hidden>·</span>
                      <DomainTag domain={h.domain} />
                    </div>
                  }
                  title={h.name}
                >
                  <HotspotBody h={h} onSelect={onMapSelect} />
                </Drawer>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </>
  );
}

function SortHead({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={cn("flex items-center justify-end gap-0.5", active && "text-ink-2")}>
      {label}
      {active && <ArrowDown className="size-2.5" aria-label="sorted descending" />}
    </span>
  );
}
