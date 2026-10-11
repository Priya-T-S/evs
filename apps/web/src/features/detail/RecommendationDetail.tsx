import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { RECOMMENDATION_KIND, formatDate, formatDistance, formatPct, humanize, type Recommendation } from "@ecopulse/core";
import { api } from "@/lib/api";
import { useCan } from "@/lib/auth";
import { errorMessage } from "@/lib/query";
import { cn } from "@/lib/cn";
import { Button, Dialog, Drawer, ErrorState, Field, ProvenanceBadge, Textarea, toast } from "@/components/ui";
import { DrawerSkeleton } from "./IncidentDetail";

export function useRecommendation(id: string) {
  return useQuery({ queryKey: ["recommendation", id], queryFn: () => api.recommendations.get(id) });
}

export function RecommendationDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useRecommendation(id);
  if (q.isPending) return <DrawerSkeleton onClose={onClose} />;
  if (q.isError || !q.data)
    return (
      <Drawer title="Recommendation" onClose={onClose}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Drawer>
    );
  const r = q.data;
  return (
    <Drawer onClose={onClose} eyebrow={<RecEyebrow r={r} />} title={r.title} actions={<RecDecision r={r} />}>
      <RecommendationBody r={r} />
    </Drawer>
  );
}

export function RecEyebrow({ r }: { r: Recommendation }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
      <span>{RECOMMENDATION_KIND[r.kind] ?? humanize(r.kind)}</span>
      {r.location_name && (
        <>
          <span aria-hidden>·</span>
          <span>{r.location_name}</span>
        </>
      )}
      <span className="ml-auto">
        <RecStatus status={r.status} />
      </span>
    </div>
  );
}

export function RecStatus({ status }: { status: Recommendation["status"] }) {
  const meta = {
    open: { label: "Open", cls: "text-ink-2 border-line-strong" },
    accepted: { label: "Accepted", cls: "text-ok border-[color-mix(in_srgb,var(--ok)_50%,transparent)]" },
    dismissed: { label: "Dismissed", cls: "text-ink-3 border-line line-through" },
    superseded: { label: "Superseded", cls: "text-ink-3 border-line" },
  }[status];
  return <span className={cn("inline-flex h-[18px] items-center rounded-[4px] border px-1.5 text-[11.5px] font-medium", meta.cls)}>{meta.label}</span>;
}

function formatVal(k: string, v: unknown): string {
  if (v == null) return "–";
  if (typeof v === "number") {
    if (k.endsWith("_m")) return formatDistance(v);
    if (k.endsWith("_pct") || k.includes("trend")) return `${v > 0 ? "+" : ""}${Math.round(v)}%`;
    if (k.includes("share") || k === "confidence") return formatPct(v);
    return Number.isInteger(v) ? v.toLocaleString("en-IN") : v.toFixed(1);
  }
  if (typeof v === "object" && !Array.isArray(v))
    return Object.entries(v as Record<string, unknown>)
      .map(([a, b]) => `${a} ${b}`)
      .join(", ");
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

const LABELS: Record<string, string> = { trend_pct_14d: "14-day trend", sensitive_sites_400m: "Schools/hospitals within 400 m", nearest_collection_point_m: "Nearest collection point", noise_incidents_within_300m: "Noise incidents within 300 m", peak_measured_db: "Peak measured noise (dB)" };
const label = (k: string) => LABELS[k] ?? humanize(k.replace(/_m$/, "").replace(/_pct$/, ""));

function KV({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj);
  if (!entries.length) return <p className="text-[13px] text-ink-3">Nothing recorded.</p>;
  return (
    <dl className="divide-y divide-line">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
          <dt className="text-[13px] text-ink-3">{label(k)}</dt>
          <dd className="text-[14px] tabular-nums text-ink">{formatVal(k, v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ kind, title, sub, children }: { kind: "observed" | "model" | "recommendation"; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line px-5 py-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-3.5 w-[2px] rounded-full" style={{ background: `var(--prov-${kind})` }} aria-hidden />
        <h3 className="eyebrow !text-ink-2">{title}</h3>
        <ProvenanceBadge kind={kind} className="ml-auto" />
      </div>
      <p className="mb-2.5 text-[12.5px] text-ink-3">{sub}</p>
      {children}
    </section>
  );
}

/** OBSERVED / MODEL INFERENCE / RECOMMENDATION, kept visually separate so suggestions never read as facts. */
export function RecommendationBody({ r }: { r: Recommendation }) {
  return (
    <>
      <dl className="grid grid-cols-3 gap-3 px-5 pb-4">
        <div>
          <dt className="text-[12px] text-ink-3">Priority score</dt>
          <dd className="num text-[16px] font-medium">{r.priority_score.toFixed(0)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">Expected impact</dt>
          <dd className="text-[14px] font-medium capitalize mt-0.5">{r.expected_impact}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-3">Confidence</dt>
          <dd className="num text-[14px] mt-0.5">{formatPct(r.confidence)}</dd>
        </div>
      </dl>
      <Block kind="observed" title="Observed" sub="What citizens reported and what exists on the ground.">
        <KV obj={r.observed} />
      </Block>
      <Block kind="model" title="Model inference" sub={`What EcoPulse inferred from the observations (${r.model_version}).`}>
        <KV obj={r.inference} />
      </Block>
      <Block kind="recommendation" title="Recommendation" sub="Suggested actions, ranked. Each is triggered by an explicit rule — review before acting.">
        <ol className="space-y-3">
          {r.actions.map((a) => (
            <li key={a.rank} className="grid grid-cols-[20px_1fr] gap-2">
              <span className="num pt-px text-[13px] text-ink-3">{a.rank}.</span>
              <div>
                <p className="text-[14px] font-medium text-ink">{a.title}</p>
                <p className="text-[13px] leading-snug text-ink-2">{a.detail}</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Rule: <span className="num">{a.rule}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] text-ink-3">
          Generated {formatDate(r.created_at)} · updated {formatDate(r.updated_at)}
        </p>
      </Block>
    </>
  );
}

export function RecDecision({ r }: { r: Recommendation }) {
  const can = useCan("recommendation.manage");
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<"accept" | "dismiss" | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (decision: "accept" | "dismiss" | "reopen") => api.recommendations.decide(r.id, decision, note || undefined),
    onSuccess: (res, decision) => {
      qc.invalidateQueries({ queryKey: ["recommendation", r.id] });
      qc.invalidateQueries({ queryKey: ["recommendations"] });
      qc.invalidateQueries({ queryKey: ["interventions"] });
      qc.invalidateQueries({ queryKey: ["hotspots"] });
      toast({
        tone: "success",
        title: decision === "accept" ? "Accepted — intervention planned" : decision === "dismiss" ? "Recommendation dismissed" : "Recommendation reopened",
        body: res.intervention_id ? "Track it under Recommendations → Interventions." : r.title,
      });
      setDlg(null);
      setNote("");
    },
    onError: (e) => setErr(errorMessage(e)),
  });
  if (!can) return <p className="text-[13px] text-ink-3">Your role can view but not act on recommendations.</p>;
  if (r.status !== "open")
    return (
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-ink-3">{r.status === "accepted" ? "Accepted — an intervention was created." : "This recommendation is closed."}</span>
        <Button size="sm" variant="ghost" className="ml-auto" loading={m.isPending} onClick={() => m.mutate("reopen")}>
          Reopen
        </Button>
      </div>
    );
  return (
    <>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={() => setDlg("dismiss")}>
          Dismiss
        </Button>
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} className="ml-auto" onClick={() => setDlg("accept")}>
          Accept & plan intervention
        </Button>
      </div>
      <Dialog
        open={dlg !== null}
        onClose={() => setDlg(null)}
        title={dlg === "accept" ? "Accept recommendation" : "Dismiss recommendation"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button variant={dlg === "accept" ? "primary" : "danger"} loading={m.isPending} onClick={() => dlg && m.mutate(dlg)}>
              {dlg === "accept" ? "Accept" : "Dismiss"}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-[14px] text-ink-2">
          {dlg === "accept" ? (
            <>
              Creates a <span className="text-ink">planned</span> intervention: “{r.actions[0]?.title ?? r.title}”.
            </>
          ) : (
            "The recommendation is closed and hidden from the map. You can reopen it later."
          )}
        </p>
        <Field label="Note (optional)">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}</Field>
        {err && (
          <p role="alert" className="mt-2 text-[13px] text-[color:var(--danger-ink)]">
            {err}
          </p>
        )}
      </Dialog>
    </>
  );
}
