import type { LayerId, MapLayerDef } from "@ecopulse/core";
import { useLayers } from "../lib/queries";
import { haptic } from "../lib/haptics";
import { Button, Disclosure, ErrorState, ProvenanceLabel, Sheet, SheetTitle, Skeleton, Switch } from "./ui";
import { LAYER_GROUP_WORD, LAYER_WORD, LEGEND_WORD } from "../lib/words";

const GROUPS: MapLayerDef["group"][] = ["Overview", "Domains", "Planning"];

export function LayerPicker({ open, onClose, active, onChange }: { open: boolean; onClose: () => void; active: LayerId[]; onChange: (l: LayerId[]) => void }) {
  const q = useLayers();
  const layers = q.data?.layers ?? [];
  const toggle = (id: LayerId, on: boolean) => {
    haptic.select();
    onChange(on ? [...active.filter((a) => a !== id), id] : active.filter((a) => a !== id));
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="What to show on the map"
      header={<SheetTitle sub="Turn on what you want to see. You can turn on more than one.">What to show on the map</SheetTitle>}
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => onChange(["incidents", "hotspots"])}>
            Back to normal
          </Button>
          <Button className="flex-1" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <div className="pb-2">
        {q.isLoading ? (
          <div className="space-y-4 px-4 py-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState message="We couldn't load the list." onRetry={() => q.refetch()} />
        ) : (
          GROUPS.map((g) => {
            const items = layers.filter((l) => l.group === g);
            if (!items.length) return null;
            return (
              <section key={g} aria-label={LAYER_GROUP_WORD[g] ?? g}>
                <h3 className="bg-surface-2 border-y border-line px-4 py-2 text-[0.9375rem] font-semibold text-ink-2">{LAYER_GROUP_WORD[g] ?? g}</h3>
                <ul className="divide-y divide-line">
                  {items.map((l) => {
                    const on = active.includes(l.id as LayerId);
                    return (
                      <li key={l.id} className="px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[1.0625rem] font-medium text-ink">{LAYER_WORD[l.id]?.label ?? l.label}</span>
                            </div>
                            <p className="mt-0.5 text-[0.9375rem] leading-[1.375rem] text-ink-2">{LAYER_WORD[l.id]?.description ?? l.description}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                              <Legend def={l} />
                              <ProvenanceLabel kind={l.provenance} />
                            </div>
                          </div>
                          <div className="pt-1">
                            <Switch checked={on} onChange={(v) => toggle(l.id as LayerId, v)} label={`Show ${LAYER_WORD[l.id]?.label ?? l.label}`} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })
        )}
        {layers.length > 0 && (
          <Disclosure label="Technical details" className="px-4 pt-3">
            {layers.map((l) => (
              <p key={l.id}>
                <span className="font-medium text-ink">{l.label}</span> — {l.description}{" "}
                <ProvenanceLabel kind={l.provenance} />
              </p>
            ))}
          </Disclosure>
        )}
      </div>
    </Sheet>
  );
}

const isColor = (v: string) => /^(#|rgb|hsl)/.test(v);

function Legend({ def }: { def: MapLayerDef }) {
  const lg = def.legend;
  if (lg.type === "gradient") {
    const stops = lg.stops;
    const min = stops[0][0];
    const max = stops[stops.length - 1][0];
    const css = `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${max === min ? 0 : ((v - min) / (max - min)) * 100}%`).join(", ")})`;
    return (
      <span className="inline-flex items-center gap-1.5 text-[0.8125rem] text-ink-3">
        <span className="h-2 w-16 rounded-sm border border-line" style={{ background: css }} aria-hidden />
        {def.id === "neighbourhoods" ? "poor → good" : def.id === "air" ? "clean → polluted" : "less → more"}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.8125rem] text-ink-2">
      {lg.items.map(([label, v]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <Swatch v={v} />
          {LEGEND_WORD[label] ?? label}
        </span>
      ))}
    </span>
  );
}

function Swatch({ v }: { v: string }) {
  if (isColor(v)) return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: v }} aria-hidden />;
  const c = "var(--ink-2)";
  switch (v) {
    case "dashed":
      return <span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: c }} aria-hidden />;
    case "solid":
    case "line":
      return <span className="inline-block w-4 border-t-2" style={{ borderColor: c }} aria-hidden />;
    case "star":
      return <span aria-hidden style={{ color: "#b07a12" }}>★</span>;
    case "ring":
      return <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: "#8a63b3" }} aria-hidden />;
    case "area":
      return <span className="inline-block h-2.5 w-3 rounded-[2px] border border-dashed" style={{ borderColor: "#3a5fae", background: "rgba(58,95,174,0.15)" }} aria-hidden />;
    default:
      return <span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} aria-hidden />;
  }
}
