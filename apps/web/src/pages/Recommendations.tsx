import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { RECOMMENDATION_KIND, formatDate, formatPct, humanize, type Recommendation } from "@ecopulse/core";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { errorMessage } from "@/lib/query";
import { cn } from "@/lib/cn";
import { TopBar } from "@/components/layout/AppShell";
import { GeometryPreview } from "@/components/map/GeometryPreview";
import { Button, EmptyState, ErrorState, ProvenanceBadge, Select, Skeleton, SkeletonRows, Tabs, toast } from "@/components/ui";
import { RecDecision, RecEyebrow, RecStatus, RecommendationBody, useRecommendation } from "@/features/detail/RecommendationDetail";

type Tab = "recs" | "interventions";
type Status = "open" | "accepted" | "dismissed" | "all";

export default function Recommendations() {
  const [tab, setTab] = useState<Tab>("recs");
  return (
    <>
      <TopBar title="Recommendations" />
      <main id="main" className="flex min-h-0 flex-1 flex-col bg-bg">
        <div className="border-b border-line bg-surface px-6">
          <Tabs
            label="Recommendations views"
            value={tab}
            onChange={setTab}
            items={[
              { key: "recs", label: "Recommendations" },
              { key: "interventions", label: "Interventions" },
            ]}
          />
        </div>
        {tab === "recs" ? <RecsView /> : <InterventionsView />}
      </main>
    </>
  );
}

function RecsView() {
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState<Status>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["recommendations", kind, status], queryFn: () => api.recommendations.list({ kind: kind || undefined, status, limit: 100 }) });
  const items = q.data?.items ?? [];
  useEffect(() => {
    if (items.length && (!selected || !items.some((i) => i.id === selected))) setSelected(items[0].id);
  }, [items, selected]);
  const counts = q.data?.open_by_kind ?? {};
  const kinds = useMemo(() => Object.keys(RECOMMENDATION_KIND), []);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[460px] shrink-0 flex-col border-r border-line bg-surface">
        <div className="grid grid-cols-[1fr_140px] gap-2 border-b border-line px-4 py-3">
          <Select aria-label="Filter by kind" value={kind} onChange={(e) => setKind(e.target.value)} className="[&_select]:h-7 [&_select]:text-[13px]">
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {RECOMMENDATION_KIND[k]}
                {counts[k] ? ` · ${counts[k]} open` : ""}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value as Status)} className="[&_select]:h-7 [&_select]:text-[13px]">
            <option value="open">Open</option>
            <option value="accepted">Accepted</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All statuses</option>
          </Select>
        </div>
        <div className="grid grid-cols-[1fr_52px_58px_44px] gap-2 border-b border-line px-4 py-1.5 text-[11.5px] uppercase tracking-wider text-ink-3">
          <span>Recommendation</span>
          <span className="text-right" title="Priority score: higher means more worth doing first">Score</span>
          <span className="text-right" title="How much difference this action is expected to make">Impact</span>
          <span className="text-right" title="Confidence: how sure EcoPulse is that this suggestion fits the data">Conf.</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {q.isPending && <SkeletonRows rows={10} />}
          {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
          {q.isSuccess && items.length === 0 && <EmptyState title="No recommendations" hint="Nothing matches these filters. Recommendations regenerate as new data arrives." />}
          <ul>
            {items.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setSelected(r.id)}
                  aria-current={r.id === selected ? "true" : undefined}
                  className={cn("relative grid w-full grid-cols-[1fr_52px_58px_44px] items-center gap-2 px-4 py-2.5 text-left", r.id === selected ? "bg-surface-3" : "hover:bg-surface-2")}
                >
                  {r.id === selected && <span className="absolute inset-y-0 left-0 w-[2px] bg-brand" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block truncate text-[14px] font-medium">{r.title}</span>
                    <span className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
                      <span>{RECOMMENDATION_KIND[r.kind] ?? humanize(r.kind)}</span>
                      {r.location_name && (
                        <>
                          <span aria-hidden>·</span>
                          <span className="truncate">{r.location_name}</span>
                        </>
                      )}
                      {status === "all" && <RecStatus status={r.status} />}
                    </span>
                  </span>
                  <span className="num text-right text-[14px]">{r.priority_score.toFixed(0)}</span>
                  <span className="text-right text-[13px] capitalize text-ink-2">{r.expected_impact}</span>
                  <span className="num text-right text-[13px] text-ink-2">{formatPct(r.confidence)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">{selected ? <RecDetailPane id={selected} /> : !q.isPending && <EmptyState title="Select a recommendation" />}</div>
    </div>
  );
}

function RecDetailPane({ id }: { id: string }) {
  const q = useRecommendation(id);
  if (q.isPending)
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-6 w-96" />
        <Skeleton className="h-44" />
        <Skeleton className="h-40" />
      </div>
    );
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const r: Recommendation = q.data;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px]">
          <header className="px-5 pt-5 pb-3">
            <RecEyebrow r={r} />
            <h1 className="mt-1 text-[18px] font-semibold leading-snug">{r.title}</h1>
          </header>
          {r.geometry && (
            <div className="px-5 pb-4">
              <div className="overflow-hidden rounded-md border border-line">
                <GeometryPreview geometry={r.geometry} kind={r.kind} className="h-[200px] w-full" />
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-3">
                <MapPin className="size-3" aria-hidden /> Proposed location — a suggestion, not existing infrastructure.
              </p>
            </div>
          )}
          <RecommendationBody r={r} />
        </div>
      </div>
      <div className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[860px] px-5 py-3">
          <RecDecision r={r} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ interventions */

const IV_STEPS = ["planned", "in_progress", "completed"] as const;
const IV_LABEL: Record<string, string> = { planned: "Planned", in_progress: "In progress", completed: "Completed" };

function InterventionsView() {
  const q = useQuery({ queryKey: ["interventions"], queryFn: api.interventions.list });
  const can = useCan("recommendation.manage");
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: ({ id, status }: { id: string; status: (typeof IV_STEPS)[number] }) => api.interventions.update(id, status),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["interventions"] });
      toast({ tone: "success", title: `Intervention marked ${IV_LABEL[v.status].toLowerCase()}` });
    },
    onError: (e) => toast({ tone: "error", title: "Couldn’t update the intervention", body: errorMessage(e) }),
  });
  const items = q.data?.items ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-6 py-5">
        <div className="mb-3 flex items-baseline justify-between">
          <div>
            <h1 className="text-[15px] font-semibold">Interventions</h1>
            <p className="text-[13px] text-ink-3">Accepted recommendations, tracked from plan to completion.</p>
          </div>
          <ProvenanceBadge kind="recommendation" />
        </div>
        {q.isPending && <SkeletonRows rows={5} />}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.isSuccess && items.length === 0 && (
          <EmptyState title="No interventions yet" hint="Accept a recommendation to plan an intervention. It will appear here with its progress." className="border border-dashed border-line rounded-md" />
        )}
        {items.length > 0 && (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wider text-ink-3">
                <th className="py-2 pr-3 font-medium">Intervention</th>
                <th className="py-2 pr-3 font-medium">Area</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 pr-3 font-medium w-[260px]">Progress</th>
                <th className="py-2 font-medium w-[120px]" />
              </tr>
            </thead>
            <tbody>
              {items.map((iv) => {
                const step = IV_STEPS.indexOf(iv.status as (typeof IV_STEPS)[number]);
                const next = IV_STEPS[step + 1];
                return (
                  <tr key={iv.id} className="border-b border-line align-top">
                    <td className="py-2.5 pr-3">
                      <p className="text-[14px] font-medium">{iv.title}</p>
                      <p className="text-[12.5px] text-ink-3">
                        {RECOMMENDATION_KIND[iv.kind] ?? humanize(iv.kind)}
                        {iv.recommendation && <> · from “{iv.recommendation}”</>}
                      </p>
                      {iv.notes && <p className="mt-0.5 text-[12.5px] text-ink-2">“{iv.notes}”</p>}
                    </td>
                    <td className="py-2.5 pr-3 text-[13px] text-ink-2">{iv.location_name ?? "–"}</td>
                    <td className="py-2.5 pr-3 text-[13px] tabular-nums text-ink-2">{formatDate(iv.created_at, false)}</td>
                    <td className="py-2.5 pr-3">
                      <ol className="grid grid-cols-3 gap-1" aria-label="Progress">
                        {IV_STEPS.map((s, i) => (
                          <li key={s} aria-current={i === step ? "step" : undefined}>
                            <span className={cn("block h-1 rounded-full", i < step ? "bg-brand" : i === step ? (s === "completed" ? "bg-ok" : "bg-ink") : "bg-surface-3")} />
                            <span className={cn("mt-1 block text-[11.5px]", i === step ? "font-semibold text-ink" : "text-ink-3")}>{IV_LABEL[s]}</span>
                          </li>
                        ))}
                      </ol>
                    </td>
                    <td className="py-2.5 text-right">
                      {can && next && (
                        <Button size="sm" variant={next === "completed" ? "primary" : "secondary"} loading={m.isPending && m.variables?.id === iv.id} onClick={() => m.mutate({ id: iv.id, status: next })}>
                          {next === "in_progress" ? "Start work" : "Mark complete"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
