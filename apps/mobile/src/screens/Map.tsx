import { useCallback, useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import { AnimatePresence, motion } from "framer-motion";
import { Info, Layers, LocateFixed, Loader2, Search, X } from "lucide-react";
import { BASEMAP, EcoMapController, boundsToBbox, type LayerId, type SearchResult, type Selection } from "@ecopulse/core";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";
import { useLocation, usePosition } from "../lib/location";
import { mapBridge } from "../lib/realtime";
import { useUi } from "../lib/ui";
import { haptic } from "../lib/haptics";
import { IncidentSheet, type IncidentPreview } from "../components/IncidentSheet";
import { AreaSheet } from "../components/AreaSheet";
import { LayerPicker } from "../components/LayerPicker";
import { Button, IconButton, cx, type Snap } from "../components/ui";
import { useApp } from "../lib/store";

const DEFAULT_LAYERS: LayerId[] = ["incidents", "hotspots"];
const TIME_OPTIONS: { label: string; days: number | undefined }[] = [
  { label: "Today", days: 1 },
  { label: "Week", days: 7 },
  { label: "Month", days: 30 },
  { label: "All", days: undefined },
];
const PEEK = 188;

export default function MapScreen({ active }: { active: boolean }) {
  const theme = useTheme();
  const pos = usePosition();
  const gps = useLocation((s) => s.gps);
  const locate = useLocation((s) => s.locate);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const ctrlRef = useRef<EcoMapController | null>(null);
  const userMarker = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerId[]>(DEFAULT_LAYERS);
  const [days, setDays] = useState<number | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sel, setSel] = useState<Selection | null>(null);
  const [incident, setIncident] = useState<IncidentPreview | null>(null);
  const [snap, setSnap] = useState<Snap>("peek");
  const setMapBbox = useUi((s) => s.setMapBbox);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const daysRef = useRef(days);
  daysRef.current = days;

  const openSelection = useCallback((s: Selection | null, initialSnap: Snap = "peek") => {
    if (!s) {
      setSel(null);
      setIncident(null);
      return;
    }
    haptic.select();
    setSnap(initialSnap);
    if (s.kind === "incident") {
      const p = s.properties;
      setSel(null);
      setIncident({
        id: String(s.id),
        ref: p.ref,
        title: p.title,
        category: p.category,
        domain: p.domain,
        priority: p.priority,
        status: p.status,
        reporter_count: p.reporters ?? p.reporter_count,
        lat: s.lat,
        lon: s.lon,
        is_demo: p.is_demo,
      });
    } else {
      setIncident(null);
      setSel(s);
    }
    const m = mapRef.current;
    if (m) m.easeTo({ center: [s.lon, s.lat], offset: [0, -PEEK / 2], duration: 450 });
  }, []);

  // Create the map + controller (recreated when the light/dark basemap changes).
  useEffect(() => {
    if (!container.current) return;
    const start = mapRef.current?.getCenter() ?? { lng: pos.lon, lat: pos.lat };
    const zoom = mapRef.current?.getZoom() ?? 14;
    const map = new maplibregl.Map({
      container: container.current,
      style: theme === "dark" ? BASEMAP.dark : BASEMAP.light,
      center: [start.lng, start.lat],
      zoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      fadeDuration: 150,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;
    const ctrl = new EcoMapController(map, api, {
      theme,
      onSelect: (s) => openSelection(s),
      onLoading: setLoading,
      onError: (m) => setError(m),
    });
    ctrlRef.current = ctrl;
    mapBridge.controller = ctrl;
    ctrl.setLayers(layersRef.current);
    ctrl.setFilters({ days: daysRef.current });
    const onMoveEnd = () => setMapBbox(boundsToBbox(map.getBounds()));
    map.on("moveend", onMoveEnd);
    map.once("load", () => {
      collapseAttribution(map);
      ctrl.setLayers(layersRef.current);
      setReady(true);
      onMoveEnd();
    });
    if (import.meta.env.DEV) (window as unknown as { __epMap?: MlMap }).__epMap = map;
    return () => {
      ctrl.destroy();
      if (mapBridge.controller === ctrl) mapBridge.controller = null;
      userMarker.current?.remove();
      userMarker.current = null;
      map.remove();
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    ctrlRef.current?.setLayers(layers);
  }, [layers]);
  useEffect(() => {
    ctrlRef.current?.setFilters({ days });
  }, [days]);

  // Became visible: MapLibre needs a resize after being hidden.
  useEffect(() => {
    if (!active) {
      setPickerOpen(false);
      return;
    }
    const m = mapRef.current;
    if (m) requestAnimationFrame(() => m.resize());
  }, [active]);

  // User location dot.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !gps) return;
    if (!userMarker.current) {
      const el = document.createElement("div");
      el.className = "user-dot";
      el.setAttribute("aria-label", "Your location");
      userMarker.current = new maplibregl.Marker({ element: el }).setLngLat([gps.lon, gps.lat]).addTo(m);
    } else userMarker.current.setLngLat([gps.lon, gps.lat]);
  }, [gps, ready]);

  // Requests from other screens: focus an incident (notification), a hotspot (Pulse), or a point.
  const focus = useUi((s) => s.mapFocus);
  const focusMap = useUi((s) => s.focusMap);
  const pendingIncident = useUi((s) => s.incidentId);
  const closeIncident = useUi((s) => s.closeIncident);
  useEffect(() => {
    if (!active || !ready) return;
    const m = mapRef.current!;
    if (pendingIncident) {
      const id = pendingIncident;
      closeIncident();
      setSel(null);
      setSnap("full");
      setIncident({ id });
      ctrlRef.current?.select({ kind: "incident", id });
      api.incidents.get(id).then((d) => m.easeTo({ center: [d.lon, d.lat], zoom: Math.max(m.getZoom(), 15) })).catch(() => undefined);
    }
    if (focus) {
      focusMap(null);
      if (focus.hotspotId) {
        api.hotspots
          .get(focus.hotspotId)
          .then((h) => {
            m.easeTo({ center: [h.lon, h.lat], zoom: 14, offset: [0, -PEEK / 2] });
            setIncident(null);
            setSnap("peek");
            setSel({ kind: "hotspot", id: h.id, lon: h.lon, lat: h.lat, properties: h as unknown as Record<string, unknown> });
            ctrlRef.current?.select({ kind: "hotspot", id: h.id });
          })
          .catch(() => undefined);
      } else if (focus.lon != null && focus.lat != null) m.easeTo({ center: [focus.lon, focus.lat], zoom: focus.zoom ?? 15 });
    }
  }, [active, ready, focus, pendingIncident, focusMap, closeIncident]);

  async function locateMe() {
    haptic.tap();
    const p = await locate({ highAccuracy: true });
    const m = mapRef.current;
    if (!m) return;
    if (p) m.flyTo({ center: [p.lon, p.lat], zoom: Math.max(m.getZoom(), 15), duration: 900 });
    else setError("We couldn't find where you are. Showing the city instead.");
  }

  function closeSheets() {
    setSel(null);
    setIncident(null);
    ctrlRef.current?.select(null);
  }

  function onSearchPick(r: SearchResult) {
    const m = mapRef.current;
    if (!m) return;
    haptic.select();
    m.flyTo({ center: [r.lon, r.lat], zoom: r.zoom, duration: 900, offset: r.type === "incident" ? [0, -PEEK / 2] : [0, 0] });
    if (r.type === "incident") {
      setSel(null);
      setSnap("peek");
      setIncident({ id: String(r.id), lat: r.lat, lon: r.lon, title: r.label.split(" · ").slice(1).join(" · ") || r.label, ref: r.label.split(" · ")[0] });
      ctrlRef.current?.select({ kind: "incident", id: String(r.id) });
    } else if (r.type === "hotspot") {
      focusMap({ hotspotId: String(r.id) });
    }
  }

  return (
    <div
      className="absolute inset-x-0 top-0 isolate z-0"
      style={{ bottom: "var(--tabbar-h)", visibility: active ? "visible" : "hidden", pointerEvents: active ? "auto" : "none" }}
      aria-hidden={!active}
    >
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" role="region" aria-label="Map of problems" />
      </div>

      {/* Loading hairline */}
      <AnimatePresence>
        {(loading || !ready) && active && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-brand-soft">
            <div className="h-full w-1/3 bg-brand" style={{ animation: "maploading 1.1s ease-in-out infinite" }} />
          </motion.div>
        )}
      </AnimatePresence>
      <style>{`@keyframes maploading{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>

      {active && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[calc(env(safe-area-inset-top)+10px)]">
            <div className="flex items-start gap-2">
              <SearchPill onPick={onSearchPick} />
              <IconButton label="What to show on the map" icon={Layers} variant="float" className="pointer-events-auto" onClick={() => setPickerOpen(true)} size={48} />
            </div>
            <div className="pointer-events-auto mt-2 inline-flex rounded-md border border-line bg-surface/92 p-0.5 backdrop-blur-sm shadow-[var(--shadow-1)]" role="radiogroup" aria-label="Show problems from">
              {TIME_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={days === o.days}
                  onClick={() => {
                    haptic.select();
                    setDays(o.days);
                  }}
                  className={cx(
                    "relative h-10 min-w-[3.25rem] rounded-[7px] px-2.5 text-[0.9375rem] font-medium",
                    "after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
                    days === o.days ? "bg-ink text-bg" : "text-ink-2",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {error && (
              <div className="pointer-events-auto mt-2 flex w-fit items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[0.9063rem] text-ink-2 shadow-[var(--shadow-1)]" role="status">
                {error}
                <button
                  type="button"
                  className="min-h-11 px-1 font-medium text-brand"
                  onClick={() => {
                    setError(null);
                    ctrlRef.current?.refresh();
                  }}
                >
                  Try again
                </button>
              </div>
            )}
          </div>

          <div className="absolute right-3 z-10" style={{ bottom: incident || sel ? PEEK + 12 : 16 }}>
            <IconButton label="Show where I am" icon={LocateFixed} variant="float" size={48} onClick={locateMe} />
          </div>
          {!incident && !sel && <MapLegend />}
          {ready && !incident && !sel && <CoachMark />}

          <IncidentSheet
            preview={incident}
            open={!!incident}
            snap={snap}
            onSnapChange={setSnap}
            onClose={closeSheets}
            onOpenRelated={(r) => {
              setSnap("peek");
              setIncident(r);
              ctrlRef.current?.select({ kind: "incident", id: r.id });
              if (r.lon != null && r.lat != null) mapRef.current?.easeTo({ center: [r.lon, r.lat], offset: [0, -PEEK / 2] });
            }}
          />
          <AreaSheet
            sel={sel}
            snap={snap}
            onSnapChange={setSnap}
            onClose={closeSheets}
            onOpenIncident={(p) => {
              setSel(null);
              setSnap("peek");
              setIncident(p);
              ctrlRef.current?.select({ kind: "incident", id: p.id });
              if (p.lon != null && p.lat != null) mapRef.current?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(mapRef.current.getZoom(), 15), offset: [0, -PEEK / 2] });
            }}
          />
          <LayerPicker open={pickerOpen} onClose={() => setPickerOpen(false)} active={layers} onChange={setLayers} />
        </>
      )}
    </div>
  );
}

/** Start the (compact) OSM attribution collapsed to its ⓘ button; it stays one tap away. */
export function collapseAttribution(map: MlMap) {
  map.getContainer().querySelectorAll(".maplibregl-compact-show").forEach((el) => el.classList.remove("maplibregl-compact-show"));
}

/**
 * Workaround for a bug in @ecopulse/core's EcoMapController: its "hotspot-fill" paint uses
 * ["zoom"] inside a "case" expression, which MapLibre rejects, so the layer is never added
 * (hotspots then render as outlines only and their interiors are not tappable). Re-add it
 * with an equivalent, valid expression (zoom interpolation at the top level).
 */
function SearchPill({ onPick }: { onPick: (r: SearchResult) => void }) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await api.map.search(term, ctrl.signal);
        setResults(r.results);
      } catch {
        if (!ctrl.signal.aborted) setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 280);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const showList = focused && results !== null;
  const TYPE: Record<SearchResult["type"], string> = { neighbourhood: "Area", incident: "Problem", hotspot: "Problem area", place: "Place" };

  return (
    <div className="pointer-events-auto relative min-w-0 flex-1">
      <div className="flex h-12 items-center gap-2 rounded-md border border-line bg-surface/92 pl-3 pr-1 shadow-[var(--shadow-1)] backdrop-blur-sm">
        {busy ? <Loader2 size={18} className="spin shrink-0 text-ink-3" aria-hidden /> : <Search size={18} className="shrink-0 text-ink-3" aria-hidden />}
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Search for a place or area"
          aria-label="Search the map"
          className="h-full min-w-0 flex-1 bg-transparent text-[1.0938rem] text-ink placeholder:text-ink-3 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          enterKeyHint="search"
        />
        {q && (
          <IconButton
            label="Clear search"
            icon={X}
            size={40}
            onClick={() => {
              setQ("");
              setResults(null);
              inputRef.current?.focus();
            }}
          />
        )}
      </div>
      {showList && (
        <div className="absolute inset-x-0 top-[3.5rem] max-h-[50vh] overflow-hidden rounded-md border border-line bg-surface shadow-[var(--shadow-2)]">
          {results!.length === 0 ? (
            <p className="px-4 py-4 text-[1rem] text-ink-2">Nothing found for “{q.trim()}”. Try another name.</p>
          ) : (
            <ul className="scroll-area max-h-[50vh] divide-y divide-line" role="listbox" aria-label="Search results">
              {results!.map((r) => (
                <li key={`${r.type}-${r.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onPick(r);
                      setFocused(false);
                      inputRef.current?.blur();
                    }}
                    className="flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.7813rem] font-medium uppercase tracking-wide text-ink-3">{TYPE[r.type]}</span>
                      <span className="block truncate text-[1rem] text-ink">{r.label}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const LEGEND: { label: string; mark: React.ReactNode }[] = [
  { label: "Urgent", mark: <span className="inline-block h-3.5 w-3.5 rounded-full border-2 p-[2px]" style={{ borderColor: "#b3261e" }}><span className="block h-full w-full rounded-full" style={{ background: "#b3261e" }} /></span> },
  { label: "High priority", mark: <span className="inline-block h-3 w-3 rounded-full" style={{ background: "#d4622a" }} /> },
  { label: "Medium or low", mark: <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#c99a1e" }} /> },
  { label: "Fixed", mark: <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#2f7d57" }} /> },
];

/** A small "What do the colours mean?" chip that opens a plain legend. */
function MapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute left-3 bottom-4 z-10 max-w-[calc(100%-5.5rem)]">
      {open && (
        <div className="mb-2 rounded-md border border-line bg-surface p-3 shadow-[var(--shadow-2)]" role="dialog" aria-label="What the colours mean">
          <ul className="space-y-1.5 text-[0.9375rem] text-ink">
            {LEGEND.map((l) => (
              <li key={l.label} className="flex items-center gap-2.5">
                <span className="flex w-4 justify-center" aria-hidden>
                  {l.mark}
                </span>
                {l.label}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[0.875rem] leading-5 text-ink-2">Bigger dots are more urgent. A circle with a number means several problems close together — tap it to zoom in. Shaded shapes are areas with many problems.</p>
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          haptic.tap();
          setOpen((o) => !o);
        }}
        className="pressable inline-flex min-h-12 items-center gap-2 rounded-md border border-line bg-surface/95 px-3 text-[0.9375rem] font-medium text-ink shadow-[var(--shadow-1)] backdrop-blur-sm"
      >
        <span className="flex items-center gap-1" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#b3261e" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#d4622a" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#c99a1e" }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#2f7d57" }} />
        </span>
        {open ? "Hide" : "What do the colours mean?"}
      </button>
    </div>
  );
}

/** One-time hint shown the first time the map opens. */
function CoachMark() {
  const seen = useApp((s) => s.mapCoachSeen);
  const setSeen = useApp((s) => s.setMapCoachSeen);
  if (seen) return null;
  return (
    <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+8.5rem)] z-20 flex justify-center">
      <div role="status" className="w-full max-w-[22rem] rounded-lg border border-line bg-surface p-4 shadow-[var(--shadow-2)]">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand" aria-hidden>
            <Info size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[1.0625rem] font-semibold text-ink">Tap a coloured dot to see what's there</p>
            <p className="mt-0.5 text-[0.9375rem] leading-[1.375rem] text-ink-2">Each dot is a problem people reported. Pinch or use + and − to zoom.</p>
          </div>
        </div>
        <Button
          block
          className="mt-3"
          onClick={() => {
            haptic.tap();
            setSeen(true);
          }}
        >
          Got it
        </Button>
      </div>
    </div>
  );
}
