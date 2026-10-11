import { useEffect, useRef } from "react";
import maplibregl, { type Map as MlMap, type Marker } from "maplibre-gl";
import { BASEMAP } from "@ecopulse/core";
import { useTheme } from "../lib/theme";

const PIN_SVG = `<svg viewBox="0 0 36 46" width="36" height="46" aria-hidden="true"><path d="M18 1C9 1 2 8 2 17c0 11.5 13.2 25.3 15 27.2a1.4 1.4 0 0 0 2 0C20.8 42.3 34 28.5 34 17 34 8 27 1 18 1z" fill="var(--brand)" stroke="#fff" stroke-width="2"/><circle cx="18" cy="17" r="6" fill="#fff"/></svg>`;

/** Small map with a draggable pin. Tap the map to move the pin there as well. */
export function LocationPicker({
  lat,
  lon,
  accuracy,
  onChange,
  recenterKey,
}: {
  lat: number;
  lon: number;
  accuracy: number | null;
  onChange: (p: { lat: number; lon: number }) => void;
  recenterKey: number;
}) {
  const theme = useTheme();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: theme === "dark" ? BASEMAP.dark : BASEMAP.light,
      center: [lon, lat],
      zoom: 16.5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    const pin = document.createElement("div");
    pin.className = "report-pin";
    pin.innerHTML = PIN_SVG;
    pin.setAttribute("role", "img");
    pin.setAttribute("aria-label", "Report location pin — drag to adjust");
    const mk = new maplibregl.Marker({ element: pin, draggable: true, anchor: "bottom" }).setLngLat([lon, lat]).addTo(m);
    mk.on("dragend", () => {
      const p = mk.getLngLat();
      cb.current({ lat: p.lat, lon: p.lng });
    });
    m.on("click", (e) => {
      mk.setLngLat(e.lngLat);
      cb.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    const drawAccuracy = () => {
      if (!m.getSource("acc")) {
        m.addSource("acc", { type: "geojson", data: circle(lon, lat, accuracy ?? 0) });
        m.addLayer({ id: "acc-fill", type: "fill", source: "acc", paint: { "fill-color": "#2f6fd6", "fill-opacity": 0.12 } });
        m.addLayer({ id: "acc-line", type: "line", source: "acc", paint: { "line-color": "#2f6fd6", "line-width": 1, "line-opacity": 0.5 } });
      }
    };
    m.once("load", () => {
      drawAccuracy();
      m.getContainer().querySelectorAll(".maplibregl-compact-show").forEach((n) => n.classList.remove("maplibregl-compact-show"));
    });
    map.current = m;
    marker.current = mk;
    return () => {
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Re-centre when a new GPS fix arrives (recenterKey changes), not on every drag.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    marker.current?.setLngLat([lon, lat]);
    m.easeTo({ center: [lon, lat], duration: 500 });
    const src = m.getSource("acc") as maplibregl.GeoJSONSource | undefined;
    src?.setData(circle(lon, lat, accuracy ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterKey]);

  return <div ref={el} className="h-full w-full" />;
}

function circle(lon: number, lat: number, r: number): GeoJSON.FeatureCollection {
  if (!r || r > 2000) return { type: "FeatureCollection", features: [] };
  const pts: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    const dx = (r * Math.cos(a)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    const dy = (r * Math.sin(a)) / 111_320;
    pts.push([lon + dx, lat + dy]);
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } }] };
}
