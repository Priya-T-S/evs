import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Incident, LayerId, PulseItem, Selection } from "@ecopulse/core";
import { TopBar } from "@/components/layout/AppShell";
import { MapView, type MapHandle } from "@/components/map/MapView";
import { LayerPanel } from "@/components/map/LayerPanel";
import { Segmented } from "@/components/ui";
import { DetailPanel } from "@/features/detail/DetailPanel";
import { DRAWER_WIDTH, incidentSel, useSelection } from "@/lib/selection";
import { SearchBox, StatRow } from "./HeaderParts";
import { PriorityQueue, type QueueFilters } from "./PriorityQueue";
import { PulseTicker } from "./PulseTicker";
import { Tour } from "@/features/help/Tour";
import { tourSeen, useHelp } from "@/features/help/help";
import { useAuth } from "@/lib/auth";

const WINDOWS = [
  { key: 1, label: "24 h", title: "Show problems reported in the last 24 hours" },
  { key: 7, label: "7 d", title: "Show problems reported in the last 7 days" },
  { key: 30, label: "30 d", title: "Show problems reported in the last 30 days" },
  { key: 90, label: "90 d", title: "Show problems reported in the last 90 days" },
];

const DRAWER_W = DRAWER_WIDTH;
const DEFAULT_LAYERS: LayerId[] = ["risk", "hotspots", "incidents"];

function sinceFor(days: number) {
  // Rounded to the hour so the queue cache key is stable while the page is open.
  const t = Date.now() - days * 86400_000;
  return new Date(Math.floor(t / 3600_000) * 3600_000).toISOString();
}

export default function CommandCenter() {
  const { selection, select, setHandle, handle } = useSelection();
  const [layers, setLayers] = useState<LayerId[]>(DEFAULT_LAYERS);
  const [layerPanel, setLayerPanel] = useState(false);
  const [days, setDays] = useState(30);
  const [bbox, setBbox] = useState<string | undefined>();
  const [qf, setQf] = useState<QueueFilters>({ domain: "", status: "open", viewportOnly: false, overdueOnly: false });

  const filters = useMemo(() => ({ ...qf, since: sinceFor(days), bbox }), [qf, days, bbox]);
  const mapFilters = useMemo(() => ({ days, domain: qf.domain ? [qf.domain] : undefined, status: "open" as const }), [days, qf.domain]);

  const onReady = useCallback(
    (h: MapHandle | null) => {
      setHandle(h);
      if (!h) return;
      const cur = useSelection.getState().selection;
      if (cur) h.map.once("load", () => h.controller.select({ kind: cur.kind, id: cur.id }));
    },
    [setHandle],
  );

  // Track the viewport for the "only in view" queue filter.
  useEffect(() => {
    if (!handle || !qf.viewportOnly) return;
    const update = () => {
      const b = handle.map.getBounds();
      setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => v.toFixed(3)).join(","));
    };
    update();
    handle.map.on("moveend", update);
    return () => {
      handle.map.off("moveend", update);
    };
  }, [handle, qf.viewportOnly]);

  // Esc closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useSelection.getState().selection) {
        const t = e.target as HTMLElement;
        if (t.closest("[role=dialog]")) return;
        select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  useEffect(() => () => useSelection.getState().select(null), []);

  // First visit: start the welcome tour once the page has had a moment to draw.
  const userId = useAuth((s) => s.user?.id);
  useEffect(() => {
    if (!userId || tourSeen(userId)) return;
    const t = setTimeout(() => !useHelp.getState().tour && useHelp.getState().startTour(), 1200);
    return () => clearTimeout(t);
  }, [userId]);

  const onMapSelect = useCallback((s: Selection | null) => useSelection.getState().select(s), []);
  const pickIncident = useCallback((i: Incident) => select(incidentSel(i), { fly: true }), [select]);
  const hover = useCallback(
    (i: Incident | null) => {
      const h = useSelection.getState().handle;
      const cur = useSelection.getState().selection;
      // Ignore hovers until the map has installed its sources (avoids MapLibre errors on load).
      if (!h || !h.map.getSource("hotspots") || !h.map.getSource("locations")) return;
      if (i) h.controller.select({ kind: "incident", id: i.id });
      else h.controller.select(cur ? { kind: cur.kind, id: cur.id } : null);
    },
    [],
  );
  const pickPulse = useCallback((p: PulseItem) => select(incidentSel({ id: p.incident_id, lon: p.lon, lat: p.lat }), { fly: true }), [select]);
  const pickFromDrawer = useCallback((s: Selection) => select(s, { fly: s.lon !== 0 }), [select]);

  return (
    <>
      <TopBar
        right={
          <Segmented
            label="Show problems reported in the last…"
            items={WINDOWS}
            value={days}
            onChange={(d) => setDays(d)}
            className="mr-2"
          />
        }
      >
        <StatRow />
        <div className="ml-auto flex w-full min-w-[200px] max-w-[340px] justify-end" data-tour="search">
          <SearchBox />
        </div>
      </TopBar>
      <main id="main" className="relative flex min-h-0 flex-1">
        <div className="flex w-[400px] shrink-0 flex-col border-r border-line bg-surface min-[1400px]:w-[420px]" data-tour="queue">
          <PriorityQueue filters={filters} onFiltersChange={setQf} selectedId={selection?.kind === "incident" ? selection.id : null} onSelect={pickIncident} onHover={hover} />
          <PulseTicker onPick={pickPulse} />
        </div>
        <div className="relative min-w-0 flex-1" data-tour="map">
          <MapView layers={layers} filters={mapFilters} onSelect={onMapSelect} onReady={onReady} live insetRight={selection ? DRAWER_W : 0}>
            <LayerPanel active={layers} onChange={setLayers} open={layerPanel} onOpenChange={setLayerPanel} />
          </MapView>
        </div>
        <AnimatePresence initial={false}>
          {selection && (
            <motion.div
              key="drawer"
              className="absolute inset-y-0 right-0 z-20 shadow-2"
              style={{ width: DRAWER_W }}
              initial={{ x: 24, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 24, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="h-full">
                <DetailPanel sel={selection} onClose={() => select(null)} onSelect={pickFromDrawer} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
      <Tour />
    </>
  );
}
