/**
 * EcoMapController — the GIS engine shared by the citizen app and the command center.
 *
 * Framework-agnostic: give it a MapLibre map and the API client. It owns sources, layers,
 * zoom-dependent information density, viewport-bounded fetching, selection state and
 * realtime updates. The UI layer only toggles layers and reacts to selections.
 *
 * Information density by zoom (see ZOOM in ./map):
 *   < 11    risk surface, hotspot areas, aggregated incident cells (count bubbles)
 *   11–14   hotspot boundaries + labels, neighbourhood scores, clustered incidents
 *   ≥ 14    individual incidents (P1 ringed), collection points; ≥ 15 schools/hospitals
 */
import type { GeoJSONSource, Map as MlMap, MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl";
import type { Api, Bbox } from "./api";
import { domainColorExpr, floodFillExpr, greenFillExpr, heatmapColorExpr, priorityColorExpr, riskFillExpr, scoreFillExpr } from "./map";
import type { FeatureCollection, IncidentEventData, RealtimeEvent } from "./types";

export type LayerId =
  | "risk"
  | "incidents"
  | "hotspots"
  | "waste"
  | "air"
  | "water"
  | "noise"
  | "green"
  | "flood"
  | "interventions"
  | "infrastructure"
  | "neighbourhoods";

export type Selection =
  | { kind: "incident"; id: string; lon: number; lat: number; properties: Record<string, any> }
  | { kind: "hotspot"; id: string; lon: number; lat: number; properties: Record<string, any> }
  | { kind: "neighbourhood"; id: number; lon: number; lat: number; properties: Record<string, any> }
  | { kind: "recommendation"; id: string; lon: number; lat: number; properties: Record<string, any> }
  | { kind: "cell"; id: string; lon: number; lat: number; properties: Record<string, any>; layer: string }
  | { kind: "aqi"; id: number; lon: number; lat: number; properties: Record<string, any> };

export interface MapFilters {
  domain?: string[]; // incidents domain filter
  days?: number; // recency window for incidents/heatmaps
  status?: "open" | "resolved" | "all";
}

export interface ControllerOptions {
  theme: "light" | "dark";
  onSelect?: (s: Selection | null) => void;
  onLoading?: (loading: boolean) => void;
  onError?: (message: string) => void;
  /** Minimum zoom at which individual incidents replace aggregated cells. */
  pointsZoom?: number;
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const HEAT_LAYERS = ["waste", "air", "water", "noise"] as const;

type Fetcher = (bbox: Bbox, zoom: number, signal: AbortSignal) => Promise<FeatureCollection>;

export class EcoMapController {
  private active = new Set<LayerId>();
  private filters: MapFilters = { status: "open" };
  private aborts = new Map<string, AbortController>();
  private lastKey = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private incidents: FeatureCollection = EMPTY;
  private pulses: { lon: number; lat: number; t0: number; color: string }[] = [];
  private raf = 0;
  private selectedId: string | number | null = null;
  private pending = 0;
  private destroyed = false;
  private readonly pointsZoom: number;

  constructor(
    private map: MlMap,
    private api: Api,
    private opts: ControllerOptions,
  ) {
    this.pointsZoom = opts.pointsZoom ?? 11;
    if (map.isStyleLoaded()) this.install();
    else map.once("load", () => this.install());
  }

  // ------------------------------------------------------------------ public API

  setLayers(layers: Iterable<LayerId>) {
    this.active = new Set(layers);
    if (!this.map.getSource("incidents")) return;
    this.applyVisibility();
    this.scheduleFetch(0);
  }

  setFilters(f: MapFilters) {
    this.filters = { ...this.filters, ...f };
    this.lastKey.clear();
    this.scheduleFetch(0);
  }

  refresh() {
    this.lastKey.clear();
    this.scheduleFetch(0);
  }

  select(sel: { kind: Selection["kind"]; id: string | number } | null) {
    const prev = this.selectedId;
    this.selectedId = sel?.id ?? null;
    if (prev !== null) this.setFeatureStateAll(prev, false);
    if (sel) this.setFeatureStateAll(sel.id, true);
    const sid = sel?.kind === "incident" ? String(sel.id) : "";
    if (this.map.getLayer("incident-selected")) this.map.setFilter("incident-selected", ["==", ["get", "id"], sid]);
  }

  /** Apply a realtime incident event without refetching the viewport. */
  applyIncidentEvent(e: RealtimeEvent<IncidentEventData>) {
    const d = e.data;
    if (!d?.id || d.lon == null) return;
    const open = !["resolved", "citizen_verified", "dismissed"].includes(d.status);
    const wantOpen = (this.filters.status ?? "open") === "open";
    const features = this.incidents.features.filter((f) => f.properties?.id !== d.id);
    if (!wantOpen || open) {
      if (!this.filters.domain?.length || this.filters.domain.includes(d.domain)) {
        features.push({
          type: "Feature",
          id: d.id,
          geometry: { type: "Point", coordinates: [d.lon, d.lat] },
          properties: {
            id: d.id,
            ref: d.ref,
            title: d.title,
            category: d.category,
            domain: d.domain,
            severity: d.severity,
            priority: d.priority,
            risk: d.risk_score,
            status: d.status,
            reporters: d.reporter_count,
            last_reported_at: d.last_reported_at,
            is_demo: d.is_demo,
          },
        });
      }
    }
    this.incidents = { ...this.incidents, features };
    (this.map.getSource("incidents") as GeoJSONSource | undefined)?.setData(this.incidents as any);
    const color = !open ? "#2f7d57" : d.priority === "P1" ? "#b3261e" : d.priority === "P2" ? "#d4622a" : "#c99a1e";
    if (e.type !== "incident.updated" || d.priority_changed) this.pulse(d.lon, d.lat, color);
    if (this.map.getZoom() < this.pointsZoom) this.scheduleFetch(400, ["incidents"]);
    if (this.active.has("risk") || HEAT_LAYERS.some((l) => this.active.has(l))) this.scheduleFetch(1500, ["risk", ...HEAT_LAYERS]);
  }

  /** Hotspot / score events: refetch the affected layers (cheap, debounced). */
  applyAreaEvent(type: string) {
    if (type.startsWith("hotspot")) this.scheduleFetch(800, ["hotspots"]);
    if (type.startsWith("environmental_score")) this.scheduleFetch(800, ["neighbourhoods"]);
  }

  pulse(lon: number, lat: number, color = "#d4622a") {
    this.pulses.push({ lon, lat, t0: performance.now(), color });
    if (!this.raf) this.raf = requestAnimationFrame(this.animate);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.partialTimer) clearTimeout(this.partialTimer);
    this.aborts.forEach((a) => a.abort());
    cancelAnimationFrame(this.raf);
    this.map.off("moveend", this.onMove);
  }

  // ------------------------------------------------------------------ setup

  private install() {
    if (this.destroyed) return;
    const m = this.map;
    const dark = this.opts.theme === "dark";
    const halo = dark ? "#0e1412" : "#ffffff";
    const labelInk = dark ? "#e8ece6" : "#1d2420";
    const beforeLabels = this.firstSymbolLayer();
    const add = (layer: any, below = true) => m.addLayer(layer, below ? beforeLabels : undefined);

    for (const id of ["agg", "incidents", "hotspots", "risk-grid", "flood-pred", "flood-obs", "green-zones", "green-grid", "locations", "recs", "waste-points", "sites", "aqi", "pulse"]) {
      m.addSource(id, id === "incidents"
        ? {
            type: "geojson",
            data: EMPTY as any,
            cluster: true,
            clusterMaxZoom: 14,
            clusterRadius: 46,
            clusterProperties: {
              max_risk: ["max", ["get", "risk"]],
              p1: ["+", ["case", ["==", ["get", "priority"], "P1"], 1, 0]],
            },
            promoteId: "id",
          }
        : { type: "geojson", data: EMPTY as any, promoteId: id === "locations" ? "id" : id === "hotspots" ? "id" : undefined });
    }
    for (const l of HEAT_LAYERS) m.addSource(`heat-${l}`, { type: "geojson", data: EMPTY as any });

    // Neighbourhood scores (bottom-most data layer)
    add({ id: "locations-fill", type: "fill", source: "locations", paint: { "fill-color": scoreFillExpr as any, "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.85] } });
    add({ id: "locations-line", type: "line", source: "locations", paint: { "line-color": dark ? "#7d8a82" : "#6b716c", "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 0.8], "line-opacity": 0.7 } });

    // Green cover
    // The H3 green-share grid is a city-scale overview; real green areas take over when zoomed in.
    add({ id: "green-grid", type: "fill", source: "green-grid", maxzoom: 13, paint: { "fill-color": greenFillExpr as any, "fill-antialias": false, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 1, 12.5, 0] } });
    add({ id: "green-zones", type: "fill", source: "green-zones", paint: { "fill-color": "#4c8c4a", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 13, dark ? 0.55 : 0.45] } });

    // Risk surface (fades out at street level where individual incidents take over)
    add({
      id: "risk-grid",
      type: "fill",
      source: "risk-grid",
      paint: { "fill-color": riskFillExpr as any, "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 1, 14, 0.75, 16, 0.25] },
    });

    // Flood: predicted (fill) vs observed (hatched outline) are visually distinct
    add({ id: "flood-pred", type: "fill", source: "flood-pred", paint: { "fill-color": floodFillExpr as any } });
    add({ id: "flood-obs", type: "line", source: "flood-obs", paint: { "line-color": "#123b75", "line-width": 2.2, "line-dasharray": [1, 1] } });

    // Heatmaps per domain
    for (const l of HEAT_LAYERS) {
      add({
        id: `heat-${l}`,
        type: "heatmap",
        source: `heat-${l}`,
        maxzoom: 17,
        paint: {
          // Typical weights (severity × √reporters) are 1–8; aggregated cells reach 20+.
          "heatmap-weight": ["interpolate", ["linear"], ["get", "w"], 0, 0, 2, 0.45, 8, 0.85, 20, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 12, 1.8, 15, 2.6],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 12, 30, 16, 52],
          "heatmap-color": heatmapColorExpr(l) as any,
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.85, 16, 0.55],
        },
      });
    }

    // Hotspots: observed solid, predicted dashed
    add({
      id: "hotspot-fill",
      type: "fill",
      source: "hotspots",
      filter: ["==", ["get", "kind"], "observed"],
      paint: {
        "fill-color": domainColorExpr as any,
        // MapLibre requires ["zoom"] at the top level, so selection is nested inside each stop.
        "fill-opacity": [
          "interpolate", ["linear"], ["zoom"],
          10, ["case", ["boolean", ["feature-state", "selected"], false], 0.36, 0.28],
          15, ["case", ["boolean", ["feature-state", "selected"], false], 0.3, 0.12],
        ],
      },
    });
    add({
      id: "hotspot-line",
      type: "line",
      source: "hotspots",
      filter: ["==", ["get", "kind"], "observed"],
      paint: { "line-color": domainColorExpr as any, "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.6] },
    });
    add({
      id: "hotspot-pred",
      type: "line",
      source: "hotspots",
      filter: ["==", ["get", "kind"], "predicted"],
      paint: { "line-color": domainColorExpr as any, "line-width": 2, "line-dasharray": [2, 2] },
    });

    // Interventions
    add({ id: "recs-area", type: "fill", source: "recs", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#3a5fae", "fill-opacity": 0.12 } });
    add({ id: "recs-area-line", type: "line", source: "recs", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#3a5fae", "line-width": 1.5, "line-dasharray": [3, 2] } });
    add({ id: "recs-line", type: "line", source: "recs", filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round" }, paint: { "line-color": "#3f8f3c", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 15, 7], "line-opacity": 0.85, "line-dasharray": [1.5, 1] } });

    // Existing infrastructure + sensitive sites
    add({ id: "waste-points", type: "circle", source: "waste-points", minzoom: 12, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 16, 5], "circle-color": dark ? "#c9b48a" : "#7a5a24", "circle-stroke-width": 1, "circle-stroke-color": halo } }, false);
    // Schools / hospitals are context for exposure, so they stay quiet: small, muted, street zoom only.
    add({ id: "sites", type: "symbol", source: "sites", minzoom: 15.5, filter: ["in", ["get", "kind"], ["literal", ["school", "kindergarten", "hospital"]]], layout: { "text-field": ["match", ["get", "kind"], "hospital", "H", "S"], "text-font": FONT_BOLD, "text-size": 9, "text-padding": 6, "text-allow-overlap": false }, paint: { "text-color": dark ? "#7f97ad" : "#5d7690", "text-opacity": 0.75, "text-halo-color": halo, "text-halo-width": 1.2 } }, false);

    // Aggregated incident cells (city level)
    add({
      id: "agg-circle",
      type: "circle",
      source: "agg",
      maxzoom: this.pointsZoom,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 7, 10, 13, 40, 22, 120, 32],
        "circle-color": ["interpolate", ["linear"], ["get", "max_risk"], 30, "#c99a1e", 60, "#d4622a", 80, "#b3261e"],
        "circle-opacity": 0.85,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": halo,
      },
    }, false);
    add({ id: "agg-label", type: "symbol", source: "agg", maxzoom: this.pointsZoom, layout: { "text-field": ["to-string", ["get", "count"]], "text-font": FONT_BOLD, "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } }, false);

    // Clustered incidents (neighbourhood level)
    add({
      id: "cluster",
      type: "circle",
      source: "incidents",
      minzoom: this.pointsZoom,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["get", "point_count"], 2, 13, 20, 19, 100, 27],
        "circle-color": ["interpolate", ["linear"], ["get", "max_risk"], 30, "#c99a1e", 60, "#d4622a", 80, "#b3261e"],
        "circle-stroke-width": ["case", [">", ["get", "p1"], 0], 3, 1.5],
        "circle-stroke-color": ["case", [">", ["get", "p1"], 0], "#b3261e", halo],
        "circle-opacity": 0.9,
      },
    }, false);
    add({ id: "cluster-label", type: "symbol", source: "incidents", minzoom: this.pointsZoom, filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": FONT_BOLD, "text-size": 12 }, paint: { "text-color": "#ffffff" } }, false);

    // Individual incidents (street level). P1 gets an outer ring: a non-colour cue.
    add({
      id: "incident-ring",
      type: "circle",
      source: "incidents",
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "priority"], "P1"]],
      minzoom: this.pointsZoom,
      paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2, "circle-stroke-color": "#b3261e" },
    }, false);
    add({
      id: "incident",
      type: "circle",
      source: "incidents",
      filter: ["!", ["has", "point_count"]],
      minzoom: this.pointsZoom,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, ["match", ["get", "priority"], "P1", 6, "P2", 5, 4], 16, ["match", ["get", "priority"], "P1", 10, "P2", 8.5, 7]],
        "circle-color": ["case", ["in", ["get", "status"], ["literal", ["resolved", "citizen_verified"]]], "#2f7d57", priorityColorExpr as any],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": halo,
      },
    }, false);
    add({ id: "incident-selected", type: "circle", source: "incidents", filter: ["==", ["get", "id"], ""], paint: { "circle-radius": 16, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": dark ? "#ffffff" : "#16201b" } }, false);
    add({ id: "incident-label", type: "symbol", source: "incidents", minzoom: 16, filter: ["!", ["has", "point_count"]], layout: { "text-field": ["get", "ref"], "text-font": FONT, "text-size": 10, "text-offset": [0, 1.5], "text-anchor": "top" }, paint: { "text-color": labelInk, "text-halo-color": halo, "text-halo-width": 1.4 } }, false);

    // Waste-point recommendations (stars) sit above incidents
    add({ id: "recs-point", type: "symbol", source: "recs", filter: ["==", ["geometry-type"], "Point"], layout: { "text-field": ["match", ["get", "kind"], "waste_collection_point", "★", "silence_zone", "◎", "◆"], "text-font": FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 11, 16, 16, 26], "text-allow-overlap": true }, paint: { "text-color": ["match", ["get", "kind"], "waste_collection_point", "#b07a12", "silence_zone", "#8a63b3", "#3a5fae"], "text-halo-color": halo, "text-halo-width": 2 } }, false);

    // AQI readings (external data) — labelled circles
    add({ id: "aqi-circle", type: "circle", source: "aqi", paint: { "circle-radius": 15, "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "us_aqi"], 0], 50, "#2f7d57", 100, "#a59a1f", 150, "#d4622a", 200, "#b3261e"], "circle-stroke-width": 2, "circle-stroke-color": halo, "circle-opacity": 0.92 } }, false);
    add({ id: "aqi-label", type: "symbol", source: "aqi", layout: { "text-field": ["to-string", ["coalesce", ["get", "us_aqi"], "–"]], "text-font": FONT_BOLD, "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": "#ffffff" } }, false);

    // Labels for areas
    add({ id: "hotspot-label", type: "symbol", source: "hotspots", minzoom: 11.5, layout: { "text-field": ["get", "name"], "text-font": FONT_BOLD, "text-size": 11, "symbol-placement": "point", "text-max-width": 9 }, paint: { "text-color": labelInk, "text-halo-color": halo, "text-halo-width": 1.6 } }, false);
    add({ id: "locations-label", type: "symbol", source: "locations", maxzoom: 13.5, layout: { "text-field": ["case", ["==", ["get", "overall"], null], ["get", "name"], ["concat", ["get", "name"], "\n", ["to-string", ["round", ["get", "overall"]]]]], "text-font": FONT, "text-size": 11 }, paint: { "text-color": labelInk, "text-halo-color": halo, "text-halo-width": 1.5 } }, false);

    // Realtime pulse
    add({ id: "pulse", type: "circle", source: "pulse", paint: { "circle-radius": ["get", "r"], "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2.5, "circle-stroke-color": ["get", "color"], "circle-stroke-opacity": ["get", "o"] } }, false);

    this.bindInteractions();
    this.applyVisibility();
    m.on("moveend", this.onMove);
    this.scheduleFetch(0);
  }

  /** Insert data above every basemap fill/line (roads, buildings) but below the place labels. */
  private firstSymbolLayer(): string | undefined {
    const layers = this.map.getStyle().layers ?? [];
    let lastGeometry = -1;
    layers.forEach((l, i) => {
      if (l.type !== "symbol") lastGeometry = i;
    });
    return layers.slice(lastGeometry + 1).find((l) => l.type === "symbol")?.id;
  }

  private layerGroups(): Record<LayerId, string[]> {
    return {
      risk: ["risk-grid"],
      incidents: ["agg-circle", "agg-label", "cluster", "cluster-label", "incident-ring", "incident", "incident-selected", "incident-label"],
      hotspots: ["hotspot-fill", "hotspot-line", "hotspot-pred", "hotspot-label"],
      waste: ["heat-waste"],
      air: ["heat-air", "aqi-circle", "aqi-label"],
      water: ["heat-water"],
      noise: ["heat-noise"],
      green: ["green-zones", "green-grid"],
      flood: ["flood-pred", "flood-obs"],
      interventions: ["recs-area", "recs-area-line", "recs-line", "recs-point"],
      infrastructure: ["waste-points", "sites"],
      neighbourhoods: ["locations-fill", "locations-line", "locations-label"],
    };
  }

  private applyVisibility() {
    const groups = this.layerGroups();
    for (const [id, layers] of Object.entries(groups) as [LayerId, string[]][]) {
      const vis = this.active.has(id) ? "visible" : "none";
      for (const l of layers) if (this.map.getLayer(l)) this.map.setLayoutProperty(l, "visibility", vis);
    }
  }

  // ------------------------------------------------------------------ data

  private onMove = () => this.scheduleFetch(250);

  private partialTimer: ReturnType<typeof setTimeout> | null = null;
  private partialLayers = new Set<string>();

  private scheduleFetch(delay: number, only?: string[]) {
    if (only) {
      // Targeted refreshes (realtime) are coalesced separately so they never cancel a
      // pending full viewport fetch after a pan.
      only.forEach((l) => this.partialLayers.add(l));
      if (this.partialTimer) clearTimeout(this.partialTimer);
      this.partialTimer = setTimeout(() => {
        const layers = [...this.partialLayers];
        this.partialLayers.clear();
        this.fetchVisible(layers);
      }, delay);
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fetchVisible(), delay);
  }

  private viewport(): { bbox: Bbox; zoom: number } {
    const b = this.map.getBounds();
    const z = this.map.getZoom();
    // Pad the viewport by 20 % so small pans don't refetch, and round to a stable grid.
    const padX = (b.getEast() - b.getWest()) * 0.2;
    const padY = (b.getNorth() - b.getSouth()) * 0.2;
    const step = z < 11 ? 0.05 : z < 14 ? 0.01 : 0.002;
    const r = (v: number, f: (x: number) => number) => f(v / step) * step;
    const bbox: Bbox = [
      Math.max(-180, r(b.getWest() - padX, Math.floor)),
      Math.max(-90, r(b.getSouth() - padY, Math.floor)),
      Math.min(180, r(b.getEast() + padX, Math.ceil)),
      Math.min(90, r(b.getNorth() + padY, Math.ceil)),
    ];
    return { bbox, zoom: z };
  }

  private fetchers(): Record<string, { layer: LayerId; source: string; zoomBucket: (z: number) => number; fetch: Fetcher; post?: (fc: FeatureCollection) => void }> {
    const api = this.api;
    const f = this.filters;
    const q = { domain: f.domain?.join(","), days: f.days, status: f.status };
    return {
      incidents: {
        layer: "incidents",
        source: "incidents",
        zoomBucket: (z) => (z < 9 ? 8 : z < this.pointsZoom ? 10 : 14),
        fetch: (b, z, s) => api.map.incidents(b, z, q, s),
        post: (fc) => {
          const agg = fc.meta?.mode === "aggregate";
          (this.map.getSource("agg") as GeoJSONSource).setData((agg ? fc : EMPTY) as any);
          this.incidents = agg ? EMPTY : fc;
          (this.map.getSource("incidents") as GeoJSONSource).setData(this.incidents as any);
        },
      },
      risk: { layer: "risk", source: "risk-grid", zoomBucket: () => 0, fetch: (b, _z, s) => api.map.grid("risk", b, s) },
      hotspots: { layer: "hotspots", source: "hotspots", zoomBucket: () => 0, fetch: (_b, _z, s) => api.hotspots.geojson({ status: "active", kind: "all" }, s) },
      neighbourhoods: { layer: "neighbourhoods", source: "locations", zoomBucket: (z) => (z < 12 ? 10 : 13), fetch: (_b, z, s) => api.map.locations(undefined, z, s) },
      green: { layer: "green", source: "green-zones", zoomBucket: (z) => Math.floor(z), fetch: (b, z, s) => api.map.greenZones(b, z, s) },
      "green-grid": { layer: "green", source: "green-grid", zoomBucket: () => 0, fetch: (b, _z, s) => api.map.grid("green", b, s) },
      flood: { layer: "flood", source: "flood-pred", zoomBucket: () => 0, fetch: (b, _z, s) => api.map.grid("flood_predicted", b, s) },
      "flood-obs": { layer: "flood", source: "flood-obs", zoomBucket: () => 0, fetch: (b, _z, s) => api.map.grid("flood_observed", b, s) },
      interventions: { layer: "interventions", source: "recs", zoomBucket: () => 0, fetch: (b, _z, s) => api.map.recommendations(b, s) },
      infrastructure: { layer: "infrastructure", source: "waste-points", zoomBucket: () => 0, fetch: (b, _z, s) => api.map.wastePoints(b, s) },
      sites: { layer: "infrastructure", source: "sites", zoomBucket: () => 0, fetch: (b, _z, s) => api.map.sensitiveSites(b, s) },
      aqi: { layer: "air", source: "aqi", zoomBucket: () => 0, fetch: (_b, _z, s) => api.map.aqi(s) },
      ...Object.fromEntries(
        HEAT_LAYERS.map((l) => [
          l,
          { layer: l as LayerId, source: `heat-${l}`, zoomBucket: (z: number) => (z < 12 ? 11 : z < 13 ? 12 : 14), fetch: ((b, z, s) => api.map.heatmap(l, b, z, { days: f.days ?? 60 }, s)) as Fetcher },
        ]),
      ),
    };
  }

  private async fetchVisible(only?: string[]) {
    if (this.destroyed || !this.map.getSource("incidents")) return;
    const { bbox, zoom } = this.viewport();
    const all = this.fetchers();
    const jobs = Object.entries(all).filter(([name, spec]) => this.active.has(spec.layer) && (!only || only.includes(name) || only.includes(spec.layer)));
    // Viewport-independent sources are keyed without bbox so they load once.
    const global = new Set(["hotspots", "neighbourhoods", "aqi"]);
    await Promise.all(
      jobs.map(async ([name, spec]) => {
        const key = `${global.has(name) ? "" : bbox.join(",")}|${spec.zoomBucket(zoom)}|${JSON.stringify(this.filters)}`;
        if (!only && this.lastKey.get(name) === key) return;
        this.aborts.get(name)?.abort();
        const ctrl = new AbortController();
        this.aborts.set(name, ctrl);
        this.setLoading(+1);
        try {
          const fc = await spec.fetch(bbox, zoom, ctrl.signal);
          if (ctrl.signal.aborted || this.destroyed) return;
          this.lastKey.set(name, key);
          if (spec.post) spec.post(fc);
          else (this.map.getSource(spec.source) as GeoJSONSource | undefined)?.setData(fc as any);
          if (this.selectedId !== null) this.setFeatureStateAll(this.selectedId, true);
        } catch (e) {
          if ((e as Error).name !== "AbortError") this.opts.onError?.((e as Error).message);
        } finally {
          this.setLoading(-1);
        }
      }),
    );
  }

  private setLoading(delta: number) {
    const before = this.pending > 0;
    this.pending = Math.max(0, this.pending + delta);
    const after = this.pending > 0;
    if (before !== after) this.opts.onLoading?.(after);
  }

  // ------------------------------------------------------------------ interaction

  private bindInteractions() {
    const m = this.map;
    const clickable = ["cluster", "agg-circle", "incident", "recs-point", "recs-line", "recs-area", "aqi-circle", "hotspot-fill", "hotspot-pred", "flood-pred", "risk-grid", "locations-fill"];
    for (const id of clickable) {
      m.on("mouseenter", id, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", id, () => (m.getCanvas().style.cursor = ""));
    }
    m.on("click", (e: MapMouseEvent) => {
      const layers = clickable.filter((l) => m.getLayer(l) && m.getLayoutProperty(l, "visibility") !== "none");
      // Generous hit box for touch screens.
      const pad = 8;
      const feats = m.queryRenderedFeatures(
        [
          [e.point.x - pad, e.point.y - pad],
          [e.point.x + pad, e.point.y + pad],
        ],
        { layers },
      );
      const order = clickable;
      feats.sort((a, b) => order.indexOf(a.layer.id) - order.indexOf(b.layer.id));
      const f = feats[0];
      if (!f) {
        this.select(null);
        this.opts.onSelect?.(null);
        return;
      }
      this.handleFeatureClick(f, e);
    });
  }

  private handleFeatureClick(f: MapGeoJSONFeature, e: MapMouseEvent) {
    const m = this.map;
    const p = f.properties as Record<string, any>;
    const [lon, lat] = f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
    switch (f.layer.id) {
      case "cluster": {
        const src = m.getSource("incidents") as GeoJSONSource;
        src.getClusterExpansionZoom(p.cluster_id).then((z) => m.easeTo({ center: [lon, lat], zoom: Math.min(z + 0.3, 17) }));
        return;
      }
      case "agg-circle":
        m.easeTo({ center: [lon, lat], zoom: Math.max(m.getZoom() + 2, this.pointsZoom + 0.2) });
        return;
      case "incident":
        this.emit({ kind: "incident", id: p.id, lon, lat, properties: p });
        return;
      case "recs-point":
      case "recs-line":
      case "recs-area":
        this.emit({ kind: "recommendation", id: p.id, lon, lat, properties: p });
        return;
      case "aqi-circle":
        this.emit({ kind: "aqi", id: p.location_id, lon, lat, properties: p });
        return;
      case "hotspot-fill":
      case "hotspot-pred":
        this.emit({ kind: "hotspot", id: p.id, lon: p.lon ?? lon, lat: p.lat ?? lat, properties: p });
        return;
      case "flood-pred":
      case "risk-grid":
        this.emit({ kind: "cell", id: p.h3, lon, lat, properties: p, layer: f.layer.id });
        return;
      case "locations-fill":
        this.emit({ kind: "neighbourhood", id: p.id, lon, lat, properties: p });
        return;
    }
  }

  private emit(sel: Selection) {
    this.select({ kind: sel.kind, id: sel.id });
    this.opts.onSelect?.(sel);
  }

  private setFeatureStateAll(id: string | number, selected: boolean) {
    for (const source of ["hotspots", "locations"]) {
      try {
        this.map.setFeatureState({ source, id }, { selected });
      } catch {
        /* feature not in this source */
      }
    }
  }

  private reducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  private animate = (now: number) => {
    const DURATION = 2400;
    this.pulses = this.pulses.filter((p) => now - p.t0 < DURATION * 2);
    const features = this.pulses.flatMap((p) =>
      (this.reducedMotion ? [0] : [0, DURATION / 2]).map((offset) => {
        // Reduced motion: a static ring that simply disappears, no expansion.
        const t = this.reducedMotion ? 0.4 : ((now - p.t0 + offset) % DURATION) / DURATION;
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
          properties: { r: 6 + t * 34, o: (1 - t) * 0.9, color: p.color },
        };
      }),
    );
    (this.map.getSource("pulse") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features } as any);
    this.raf = this.pulses.length ? requestAnimationFrame(this.animate) : 0;
    if (!this.pulses.length) (this.map.getSource("pulse") as GeoJSONSource | undefined)?.setData(EMPTY as any);
  };
}
