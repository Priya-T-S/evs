import { plainText } from "../lib/words";
import { useEffect, useRef } from "react";
import { useLocation as useRoute } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { haversine, type AlertEventData, type IncidentEventData, type RealtimeEvent } from "@ecopulse/core";
import { mapBridge, realtime } from "../lib/realtime";
import { useApp } from "../lib/store";
import { usePosition } from "../lib/location";
import { useUi } from "../lib/ui";
import { bboxAround } from "../lib/geo";
import { toast } from "../lib/toast";
import { haptic } from "../lib/haptics";

const ALERT_RADIUS_M = 3000;

/**
 * Owns the single realtime connection: (re)connects with the access token, keeps the
 * geographic subscription in sync with the map viewport (or the user's area), and routes
 * events to the map controller, the query cache, toasts and the alert banner.
 */
export function RealtimeBridge() {
  const access = useApp((s) => s.access);
  const qc = useQueryClient();
  const pos = usePosition();
  const posRef = useRef(pos);
  posRef.current = pos;
  const mapBbox = useUi((s) => s.mapBbox);
  const route = useRoute();
  const onMap = route.pathname === "/map";

  // Connect while the shell is mounted; reconnect with the new token after login / logout / refresh.
  useEffect(() => {
    realtime.connect();
    return () => realtime.close();
  }, []);
  const prevAccess = useRef(access);
  useEffect(() => {
    if (prevAccess.current === access) return;
    prevAccess.current = access;
    realtime.restart();
  }, [access]);

  // Subscription: map viewport while the map is visible, else ~5 km around the user.
  const bboxKey = onMap && mapBbox ? mapBbox.map((v) => v.toFixed(3)).join(",") : `${pos.lat.toFixed(2)},${pos.lon.toFixed(2)}`;
  useEffect(() => {
    const bbox = onMap && mapBbox ? mapBbox : bboxAround(pos.lat, pos.lon, 5000);
    realtime.subscribe({ topics: ["incidents", "hotspots", "scores", "alerts", "pulse"], bbox });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey]);

  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const invalidate = (key: string, delay = 700) => {
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => qc.invalidateQueries({ queryKey: [key] }), delay),
      );
    };

    const offs = [
      realtime.on<IncidentEventData>("incident.created", onIncident),
      realtime.on<IncidentEventData>("incident.updated", onIncident),
      realtime.on<IncidentEventData>("incident.resolved", onIncident),
      realtime.on("hotspot.created", onArea),
      realtime.on("hotspot.updated", onArea),
      realtime.on("hotspot.cooled", onArea),
      realtime.on("environmental_score.updated", (e) => {
        mapBridge.controller?.applyAreaEvent(e.type);
        invalidate("score", 400);
      }),
      realtime.on<AlertEventData>("alert.created", (e) => {
        invalidate("pulse");
        const p = posRef.current;
        const near = e.geo ? haversine(p.lat, p.lon, e.geo.lat, e.geo.lon) <= ALERT_RADIUS_M : false;
        if (near) {
          haptic.warning();
          useUi.getState().setAlert({ title: e.data.title, incidentId: e.data.incident_id, location: e.data.location_name });
        }
      }),
      realtime.on<{ id: number; title: string; body: string; data: Record<string, string> }>("notification.created", (e) => {
        invalidate("notifications", 100);
        invalidate("me", 300);
        invalidate("points", 300);
        const incidentId = e.data.data?.incident_id;
        // The report screen already says the same thing on its "Thank you" page; don't repeat it.
        if (window.location.pathname === "/report") return;
        toast({ title: plainText(e.data.title), body: plainText(e.data.body), tone: "info", onTap: incidentId ? () => useUi.getState().openIncident(incidentId) : undefined });
      }),
      realtime.on("resync", () => {
        ["nearby", "pulse", "score", "notifications"].forEach((k) => invalidate(k, 100));
        mapBridge.controller?.refresh();
      }),
    ];

    function onIncident(e: RealtimeEvent<IncidentEventData>) {
      mapBridge.controller?.applyIncidentEvent(e);
      invalidate("nearby");
      invalidate("pulse");
      if (e.data?.id) qc.invalidateQueries({ queryKey: ["incident", e.data.id] });
    }
    function onArea(e: RealtimeEvent) {
      mapBridge.controller?.applyAreaEvent(e.type);
      invalidate("pulse", 1000);
    }

    return () => {
      offs.forEach((off) => off());
      timers.forEach((t) => clearTimeout(t));
    };
  }, [qc]);

  return null;
}
