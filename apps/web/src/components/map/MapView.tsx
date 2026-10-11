import { useEffect, useRef, useState, type ReactNode } from "react";
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import { BASEMAP, EcoMapController, type IncidentEventData, type LayerId, type MapFilters, type RealtimeEvent, type Selection } from "@ecopulse/core";
import { Crosshair, Minus, Plus, LocateFixed } from "lucide-react";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { useLatest } from "@/lib/hooks";
import { realtime } from "@/lib/realtime";
import { toast } from "@/components/ui";
import { cn } from "@/lib/cn";

export const CITY_CENTER: [number, number] = [77.5946, 12.9716];
export const CITY_ZOOM = 11;

export interface MapHandle {
  map: MlMap;
  controller: EcoMapController;
}

interface Props {
  layers: LayerId[];
  filters?: MapFilters;
  onSelect?: (s: Selection | null) => void;
  onReady?: (h: MapHandle | null) => void;
  /** Apply realtime incident/hotspot/score events to the map and follow the viewport for geo subscriptions. */
  live?: boolean;
  center?: [number, number];
  zoom?: number;
  className?: string;
  children?: ReactNode;
  controls?: boolean;
  label?: string;
  /** Width (px) of a panel overlaying the right edge of the map; chrome and centring avoid it. */
  insetRight?: number;
}

/**
 * MapLibre map + the shared EcoMapController. The controller owns all data layers; this
 * component only creates/destroys it (recreated on theme change, since the basemap style
 * and halo colours differ) and renders the map chrome.
 */
export function MapView({ layers, filters, onSelect, onReady, live, center = CITY_CENTER, zoom = CITY_ZOOM, className, children, controls = true, label = "Environmental map of the city", insetRight = 0 }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const theme = useTheme((s) => s.theme);
  const [handle, setHandle] = useState<MapHandle | null>(null);
  const [loading, setLoading] = useState(false);
  const view = useRef<{ center: [number, number]; zoom: number }>({ center, zoom });
  const onSelectRef = useLatest(onSelect);
  const onReadyRef = useLatest(onReady);
  const layersRef = useLatest(layers);
  const filtersRef = useLatest(filters);

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: BASEMAP[theme],
      center: view.current.center,
      zoom: view.current.zoom,
      minZoom: 8.5,
      maxZoom: 18,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      fadeDuration: 0,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: BASEMAP.attribution }), "bottom-right");
    let lastErr = 0;
    const controller = new EcoMapController(map, api, {
      theme,
      onSelect: (s) => onSelectRef.current?.(s),
      onLoading: setLoading,
      onError: (m) => {
        if (Date.now() - lastErr > 15_000) toast({ tone: "error", title: "Some map data didn’t load", body: m });
        lastErr = Date.now();
      },
    });
    controller.setLayers(layersRef.current);
    if (import.meta.env.DEV) (window as unknown as { __epMap?: MlMap; __epCtl?: EcoMapController }).__epMap = map;
    if (import.meta.env.DEV) (window as unknown as { __epCtl?: EcoMapController }).__epCtl = controller;
    if (filtersRef.current) controller.setFilters(filtersRef.current);
    map.on("moveend", () => {
      const c = map.getCenter();
      view.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
    });
    const h = { map, controller };
    setHandle(h);
    onReadyRef.current?.(h);
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      onReadyRef.current?.(null);
      setHandle(null);
      controller.destroy();
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  useEffect(() => {
    handle?.controller.setLayers(layers);
  }, [handle, layers]);

  useEffect(() => {
    if (handle && filters) handle.controller.setFilters(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, JSON.stringify(filters)]);

  useEffect(() => {
    if (!handle) return;
    const { map } = handle;
    // Skip when a flyTo already set this padding (an easeTo here would cancel that flight).
    if (map.getPadding().right === insetRight || map.isMoving()) return;
    map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: insetRight }, duration: 220 });
  }, [handle, insetRight]);

  // Realtime: incident events are applied in place; area events trigger cheap refetches.
  useEffect(() => {
    if (!live || !handle) return;
    const { map, controller } = handle;
    const applyIncident = (e: RealtimeEvent<IncidentEventData>) => controller.applyIncidentEvent(e);
    const offs = [
      realtime.on<IncidentEventData>("incident.created", applyIncident),
      realtime.on<IncidentEventData>("incident.updated", applyIncident),
      realtime.on<IncidentEventData>("incident.resolved", applyIncident),
      realtime.on("hotspot.created", (e) => controller.applyAreaEvent(e.type)),
      realtime.on("hotspot.updated", (e) => controller.applyAreaEvent(e.type)),
      realtime.on("hotspot.cooled", (e) => controller.applyAreaEvent(e.type)),
      realtime.on("environmental_score.updated", (e) => controller.applyAreaEvent(e.type)),
      realtime.on("resync", () => controller.refresh()),
    ];
    const sendBbox = () => {
      const b = map.getBounds();
      realtime.subscribe({ bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] });
    };
    map.on("moveend", sendBbox);
    sendBbox();
    return () => {
      offs.forEach((off) => off());
      map.off("moveend", sendBbox);
    };
  }, [live, handle]);

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-surface-2", className)} style={{ ["--map-inset-right" as string]: `${insetRight}px` }}>
      <div ref={el} className="h-full w-full" role="region" aria-label={label} />
      <div className="pointer-events-none absolute inset-y-0 left-0 transition-[right] duration-200 [&>*]:pointer-events-auto" style={{ right: insetRight }}>
        {controls && handle && <MapControls map={handle.map} home={{ center, zoom }} />}
        {children}
      </div>
      {loading && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 flex items-center gap-2 rounded-sm border border-line bg-surface/90 px-2.5 h-7 text-[12.5px] text-ink-2 shadow-1 backdrop-blur-[2px]" role="status">
          <span className="size-1.5 rounded-full bg-brand live-dot" aria-hidden />
          Loading map data
        </div>
      )}
    </div>
  );
}

/**
 * Work-around for a style-spec bug in @ecopulse/core's EcoMapController (reported upstream):
 * `hotspot-fill` nests a ["zoom"] interpolate inside a "case", which MapLibre rejects. The
 * thrown error aborts the controller's layer install, so every later layer goes missing.
 * We rewrite that paint value into the equivalent valid form (zoom at the top level,
 * feature-state inside the stops) before it reaches the style.
 */
function MapControls({ map, home }: { map: MlMap; home: { center: [number, number]; zoom: number } }) {
  const btn = "flex size-8 items-center justify-center text-ink-2 hover:bg-surface-3 hover:text-ink transition-colors";
  const locate = () => {
    if (!navigator.geolocation) return toast({ tone: "info", title: "Location isn’t available in this browser" });
    navigator.geolocation.getCurrentPosition(
      (p) => map.flyTo({ center: [p.coords.longitude, p.coords.latitude], zoom: 15 }),
      () => toast({ tone: "info", title: "Couldn’t get your location", body: "Check the browser’s location permission." }),
      { timeout: 8000 },
    );
  };
  return (
    <div className="absolute bottom-8 right-3 flex flex-col gap-2">
      <div className="flex flex-col overflow-hidden rounded-sm border border-line-strong bg-surface shadow-1 divide-y divide-line">
        <button className={btn} aria-label="Zoom in" title="Zoom in" onClick={() => map.zoomIn()}>
          <Plus className="size-4" />
        </button>
        <button className={btn} aria-label="Zoom out" title="Zoom out" onClick={() => map.zoomOut()}>
          <Minus className="size-4" />
        </button>
      </div>
      <div className="flex flex-col overflow-hidden rounded-sm border border-line-strong bg-surface shadow-1 divide-y divide-line">
        <button className={btn} aria-label="Reset view to the whole city" title="Reset to city" onClick={() => map.flyTo({ center: home.center, zoom: home.zoom })}>
          <Crosshair className="size-4" />
        </button>
        <button className={btn} aria-label="Go to my location" title="My location" onClick={locate}>
          <LocateFixed className="size-4" />
        </button>
      </div>
    </div>
  );
}
