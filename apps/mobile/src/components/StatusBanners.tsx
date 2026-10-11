import { CloudOff, LocateFixed, Siren, WifiOff } from "lucide-react";
import { useNetwork } from "../lib/network";
import { syncOutbox, useOutbox } from "../lib/outbox";
import { useLocation, usePosition } from "../lib/location";
import { useApp } from "../lib/store";
import { useMeta } from "../lib/queries";
import { useUi } from "../lib/ui";
import { DEFAULT_CITY } from "../lib/config";
import { Banner } from "./ui";

/** Offline, queued reports, location fallback and nearby critical alerts. */
export function StatusBanners({ showLocation = true }: { showLocation?: boolean }) {
  const online = useNetwork((s) => s.online);
  const queued = useOutbox((s) => s.items);
  const pos = usePosition();
  const status = useLocation((s) => s.status);
  const locate = useLocation((s) => s.locate);
  const setExplained = useApp((s) => s.setLocationExplained);
  const city = useMeta().data?.city.name ?? DEFAULT_CITY;
  const alert = useUi((s) => s.alert);
  const setAlert = useUi((s) => s.setAlert);
  const openIncident = useUi((s) => s.openIncident);
  const pending = queued.filter((q) => q.status === "pending").length;

  const items = [];
  if (alert)
    items.push(
      <Banner
        key="alert"
        tone="danger"
        icon={Siren}
        title={`Urgent problem near you${alert.location ? ` · ${alert.location}` : ""}`}
        action={{
          label: "See it",
          onClick: () => {
            openIncident(alert.incidentId);
            setAlert(null);
          },
        }}
      >
        {alert.title}
      </Banner>,
    );
  if (!online)
    items.push(
      <Banner key="off" tone="warn" icon={WifiOff} title="You're offline">
        {pending > 0 ? `${pending} report${pending > 1 ? "s" : ""} saved — we'll send ${pending > 1 ? "them" : "it"} when you're back online.` : "You can still look around and report. We'll send your reports when you're back online."}
      </Banner>,
    );
  else if (pending > 0)
    items.push(
      <Banner key="q" tone="info" icon={CloudOff} title={`${pending} report${pending > 1 ? "s" : ""} waiting to send`} action={{ label: "Send now", onClick: () => syncOutbox(true) }}>
        Sending by itself in a moment.
      </Banner>,
    );
  if (showLocation && pos.source === "fallback")
    items.push(
      <Banner
        key="loc"
        tone="info"
        icon={LocateFixed}
        action={
          status === "denied"
            ? undefined
            : {
                label: status === "locating" ? "Finding you…" : "Use my location",
                onClick: () => {
                  setExplained(true);
                  locate({ highAccuracy: true });
                },
              }
        }
      >
        {pos.fallback === "home" ? "Showing your home area" : `Showing the ${city} city centre`}
        {status === "denied" ? " — location is turned off on this phone." : "."}
      </Banner>,
    );
  if (!items.length) return null;
  return <div className="space-y-2 px-4 pt-3">{items}</div>;
}
