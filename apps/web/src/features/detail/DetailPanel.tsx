import type { Selection } from "@ecopulse/core";
import { IncidentDetail } from "./IncidentDetail";
import { HotspotDetail } from "./HotspotDetail";
import { AqiDetail, CellDetail, NeighbourhoodDetail } from "./AreaDetails";
import { RecommendationDetail } from "./RecommendationDetail";

/** Renders the right detail view for whatever is selected on the map or in a list. */
export function DetailPanel({ sel, onClose, onSelect }: { sel: Selection; onClose: () => void; onSelect: (s: Selection) => void }) {
  switch (sel.kind) {
    case "incident":
      return <IncidentDetail key={sel.id} id={sel.id} onClose={onClose} onSelect={onSelect} />;
    case "hotspot":
      return <HotspotDetail key={sel.id} id={sel.id} onClose={onClose} onSelect={onSelect} />;
    case "neighbourhood":
      return <NeighbourhoodDetail key={sel.id} id={sel.id} onClose={onClose} />;
    case "recommendation":
      return <RecommendationDetail key={sel.id} id={sel.id} onClose={onClose} />;
    case "cell":
      return <CellDetail key={sel.id} sel={sel} onClose={onClose} />;
    case "aqi":
      return <AqiDetail key={String(sel.id)} sel={sel} onClose={onClose} />;
  }
}
