import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { BASEMAP } from "@ecopulse/core";
import { useTheme } from "@/lib/theme";

const COLOR: Record<string, string> = {
  waste_collection_point: "#b07a12",
  green_corridor: "#3f8f3c",
  flood_preparedness: "#3a5fae",
  silence_zone: "#8a63b3",
};
const GLYPH: Record<string, string> = { waste_collection_point: "★", silence_zone: "◎" };

/**
 * Small static map showing one recommendation's proposed geometry (collection point star,
 * green-corridor line, flood-preparedness area). Same visual language as the planning layer.
 */
export function GeometryPreview({ geometry, kind, className }: { geometry: GeoJSON.Geometry; kind: string; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const theme = useTheme((s) => s.theme);

  useEffect(() => {
    if (!el.current) return;
    const color = COLOR[kind] ?? (theme === "dark" ? "#d9a63c" : "#b07a12");
    const halo = theme === "dark" ? "#0e1412" : "#ffffff";
    const map = new maplibregl.Map({
      container: el.current,
      style: BASEMAP[theme],
      center: [77.5946, 12.9716],
      zoom: 12,
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => {
      map.addSource("g", { type: "geojson", data: { type: "Feature", geometry, properties: {} } });
      if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
        map.addLayer({ id: "fill", type: "fill", source: "g", paint: { "fill-color": color, "fill-opacity": 0.18 } });
        map.addLayer({ id: "line", type: "line", source: "g", paint: { "line-color": color, "line-width": 2, "line-dasharray": [3, 2] } });
      } else if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
        map.addLayer({ id: "line", type: "line", source: "g", layout: { "line-cap": "round" }, paint: { "line-color": color, "line-width": 5, "line-dasharray": [1.5, 1] } });
      } else {
        map.addLayer({ id: "pt", type: "circle", source: "g", paint: { "circle-radius": 14, "circle-color": color, "circle-opacity": 0.18, "circle-stroke-width": 1.5, "circle-stroke-color": color } });
        map.addLayer({ id: "glyph", type: "symbol", source: "g", layout: { "text-field": GLYPH[kind] ?? "◆", "text-font": ["Noto Sans Bold"], "text-size": 20, "text-allow-overlap": true }, paint: { "text-color": color, "text-halo-color": halo, "text-halo-width": 2 } });
      }
      const b = new maplibregl.LngLatBounds();
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") b.extend(c as [number, number]);
        else if (Array.isArray(c)) c.forEach(walk);
      };
      walk((geometry as { coordinates?: unknown }).coordinates);
      if (!b.isEmpty()) map.fitBounds(b, { padding: 40, maxZoom: 15.5, duration: 0 });
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
    };
  }, [geometry, kind, theme]);

  return <div ref={el} className={className} role="img" aria-label="Map preview of the proposed location" />;
}
