import { useQuery } from "@tanstack/react-query";
import { Layers, Lock, X } from "lucide-react";
import type { LayerId, MapLayerDef } from "@ecopulse/core";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { ErrorState, IconButton, InfoTip, Legend, ProvenanceBadge, Skeleton } from "@/components/ui";
import { HOTSPOT_HELP, LAYER_PLAIN } from "@/lib/glossary";

const GROUP_LABEL: Record<string, string> = { Overview: "Main layers", Domains: "By type of problem", Planning: "Planning" };

const GROUPS: MapLayerDef["group"][] = ["Overview", "Domains", "Planning"];

export function useLayerDefs() {
  return useQuery({ queryKey: ["map-layers"], queryFn: api.map.layers, staleTime: Infinity, select: (d) => d.layers });
}

/** Floating layer control. Legends render from each layer's own spec, only for active layers. */
export function LayerPanel({ active, onChange, open, onOpenChange }: { active: LayerId[]; onChange: (l: LayerId[]) => void; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useLayerDefs();
  const exact = useCan("incident.view_exact");

  const toggle = (id: LayerId) => onChange(active.includes(id) ? active.filter((x) => x !== id) : [...active, id]);

  if (!open) {
    const defs = q.data?.filter((d) => active.includes(d.id as LayerId)) ?? [];
    return (
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <button
          onClick={() => onOpenChange(true)}
          className="flex h-8 items-center gap-2 rounded-sm border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink shadow-1 hover:bg-surface-2"
          aria-expanded={false}
          aria-controls="layer-panel"
          data-tour="layers"
        >
          <Layers className="size-3.5 text-ink-2" />
          Layers
          <span className="text-[12px] text-ink-3">
            <span className="num">{active.length}</span> on
          </span>
        </button>
        {/* Compact legend so the map always explains itself, even with the panel closed */}
        {defs.length > 0 && (
          <div className="w-[216px] rounded-sm border border-line bg-surface/92 px-2.5 py-2 shadow-1 backdrop-blur-[2px] space-y-2">
            {defs.map((d) => (
              <div key={d.id}>
                <p className="mb-1 flex items-center justify-between gap-2 text-[12.5px] font-medium text-ink-2">
                  {d.label}
                  <InfoTip label={d.label} side="left">
                    {d.id === "hotspots" ? HOTSPOT_HELP : (LAYER_PLAIN[d.id] ?? d.description)}
                  </InfoTip>
                </p>
                <Legend legend={d.legend} compact />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div id="layer-panel" className="absolute right-3 top-3 bottom-24 flex w-[340px] flex-col rounded-md border border-line-strong bg-surface shadow-2" role="dialog" aria-label="Map layers">
      <div className="flex items-center justify-between border-b border-line px-4 pt-3 pb-2.5">
        <div>
          <h2 className="text-[15px] font-semibold">Map layers</h2>
          <p className="text-[13px] text-ink-3">Tick a layer to show it on the map.</p>
        </div>
        <IconButton label="Close layer panel" size="sm" onClick={() => onOpenChange(false)}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="flex-1 overflow-y-auto pb-2">
        {q.isPending && (
          <div className="space-y-3 px-4 py-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        )}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} compact />}
        {q.data &&
          GROUPS.map((g) => {
            const items = q.data.filter((l) => l.group === g);
            if (!items.length) return null;
            return (
              <fieldset key={g} className="border-t border-line px-4 pt-2.5 pb-1 first-of-type:border-t-0">
                <legend className="eyebrow float-left w-full mb-1">{GROUP_LABEL[g] ?? g}</legend>
                <div className="clear-both" />
                {items.map((l) => {
                  const on = active.includes(l.id as LayerId);
                  const id = `layer-${l.id}`;
                  return (
                    <div key={l.id} className="py-1.5">
                      <div className="flex items-start gap-2.5">
                        <input id={id} type="checkbox" checked={on} onChange={() => toggle(l.id as LayerId)} className="mt-[3px] size-3.5 accent-[var(--brand)] cursor-pointer" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5">
                              <label htmlFor={id} className={cn("text-[14px] cursor-pointer", on ? "text-ink font-medium" : "text-ink-2")}>
                                {l.label}
                              </label>
                              <InfoTip label={l.label} side="top">
                                <span className="font-medium">How it’s made:</span> {l.description}
                              </InfoTip>
                            </span>
                            <ProvenanceBadge kind={l.provenance} />
                          </div>
                          <p className="mt-0.5 text-[13px] leading-snug text-ink-2">{LAYER_PLAIN[l.id] ?? l.description}</p>
                          {on && (
                            <div className="mt-1.5">
                              <Legend legend={l.legend} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </fieldset>
            );
          })}
      </div>
      <p className="flex gap-1.5 border-t border-line px-4 py-2.5 text-[12px] leading-snug text-ink-3">
        <Lock className="mt-px size-3 shrink-0" aria-hidden />
        {exact
          ? "You see exact problem locations (staff access). The public sees locations rounded to about 120 m to protect reporters’ privacy."
          : "Problem locations are rounded to about 120 m to protect reporters’ privacy."}
      </p>
    </div>
  );
}
