import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, ExternalLink, Flame, Hospital, School, Users } from "lucide-react";
import {
  OPEN_STATUSES,
  RECOMMENDATION_KIND,
  RISK_DRIVER_LABEL,
  formatDate,
  formatDistance,
  formatNumber,
  formatPct,
  formatTrend,
  type IncidentDetail as Detail,
  type Selection,
} from "@ecopulse/core";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/hooks";
import { DemoTag, DomainTag, Drawer, ErrorState, Fact, InfoTip, LifecycleStepper, PriorityChip, ProvenanceBadge, Section, Skeleton, StatusPill, Timeline } from "@/components/ui";
import { CONFIDENCE_HELP, HOTSPOT_HELP, PRIORITY_DEADLINE, PRIORITY_HELP, PROVENANCE_PLAIN, RISK_HELP, STATUS_STEPS_HELP, openFor } from "@/lib/glossary";
import { IncidentActions } from "./IncidentActions";

export function useIncident(id: string) {
  return useQuery({ queryKey: ["incident", id], queryFn: () => api.incidents.get(id) });
}

export function IncidentDetail({ id, onClose, onSelect }: { id: string; onClose: () => void; onSelect: (s: Selection) => void }) {
  const q = useIncident(id);
  const d = q.data;

  if (q.isPending) return <DrawerSkeleton onClose={onClose} />;
  if (q.isError || !d)
    return (
      <Drawer title="Incident" onClose={onClose}>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </Drawer>
    );

  return (
    <Drawer
      onClose={onClose}
      eyebrow={
        <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span className="num text-ink-2">{d.ref}</span>
          <span aria-hidden>·</span>
          <DomainTag domain={d.domain} />
          <span aria-hidden>·</span>
          <span>{d.category_label}</span>
          {d.is_demo && <DemoTag className="ml-auto" />}
        </div>
      }
      title={d.title}
      actions={<IncidentActions d={d} />}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-3">
        <span className="inline-flex items-center gap-1.5">
          <PriorityChip priority={d.priority} withLabel />
          <span className="text-[13px] text-ink-3">· {PRIORITY_DEADLINE[d.priority]}</span>
          <InfoTip label="Priority">{PRIORITY_HELP}</InfoTip>
        </span>
        <span className="text-line-strong" aria-hidden>
          |
        </span>
        <StatusPill status={d.status} />
        {d.summary && <p className="w-full pt-1.5 text-[14px] leading-snug text-ink-2">“{d.summary}”</p>}
      </div>

      <dl className="mx-5 mb-4 grid grid-cols-3 divide-x divide-line rounded-sm border border-line">
        <div className="px-3 py-2">
          <dt className="flex items-center gap-1.5 text-[12.5px] text-ink-3">
            Risk <InfoTip label="Risk">{RISK_HELP}</InfoTip>
          </dt>
          <dd className="mt-0.5 text-[13px] text-ink-3">
            <span className="num text-[20px] font-semibold leading-none text-ink">{d.risk_score.toFixed(0)}</span>/100
          </dd>
        </div>
        <div className="px-3 py-2">
          <dt className="text-[12.5px] text-ink-3">Reported by</dt>
          <dd className="mt-0.5 text-[13px] text-ink-3" title={`${d.report_count} reports in total`}>
            <span className="num text-[20px] font-semibold leading-none text-ink">{d.reporter_count}</span> {d.reporter_count === 1 ? "person" : "people"}
          </dd>
        </div>
        <div className="px-3 py-2">
          <dt className="text-[12.5px] text-ink-3">Open for</dt>
          <dd className="mt-0.5 text-[13px] text-ink-3" title={`First reported ${formatDate(d.first_reported_at)}`}>
            {(() => {
              const [n, ...unit] = openFor(d.first_reported_at).split(" ");
              return (
                <>
                  <span className="num text-[20px] font-semibold leading-none text-ink">{n}</span> {unit.join(" ")}
                </>
              );
            })()}
          </dd>
        </div>
      </dl>

      <Section title="Progress" help={STATUS_STEPS_HELP}>
        <LifecycleStepper status={d.status} />
        {d.assignment && (
          <p className="mt-3 text-[13px] text-ink-2">
            Assigned to <span className="text-ink">{d.assignment.team}</span>
            {d.assignment.assignee && <> · {d.assignment.assignee}</>}
            {d.assignment.due_at && (
              <>
                {" "}
                · due <span className="num">{formatDate(d.assignment.due_at, false)}</span>
              </>
            )}
          </p>
        )}
      </Section>

      <Section title="Key facts">
        <dl className="grid grid-cols-2 gap-x-6 divide-y divide-line [&>div]:border-line">
          <Fact label="Confidence" help={CONFIDENCE_HELP}>
            <span className="num">{formatPct(d.confidence)}</span>
          </Fact>
          <Fact label="Reports" help="Total reports received. One person can report more than once; duplicates are merged into this problem.">
            <span className="num">{d.report_count}</span>
          </Fact>
          <Fact label="Residents nearby" help="Estimated number of people living close enough to be affected. More people nearby raises the urgency score.">
            <span className="num">{formatNumber(d.population_exposed)}</span>
          </Fact>
          <Fact label="Area">
            <span>{d.location_name ?? "–"}</span>
          </Fact>
          <Fact label="Location" help="Staff see the exact spot. The public sees it rounded to about 120 m to protect the reporter’s privacy.">
            <span className="text-ink-2">{d.location_precision === "exact" ? "Exact" : `Rounded ${d.location_precision}`}</span>
          </Fact>
          <Fact label="Last report">
            <span className="tabular-nums" title={formatDate(d.last_reported_at)}>
              {ago(d.last_reported_at)}
            </span>
          </Fact>
        </dl>
        {d.sensitive_nearby.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[13px] text-ink-3">
              Schools and hospitals nearby <span className="num">({d.sensitive_nearby.length})</span> — raises urgency
            </p>
            <ul className="space-y-0.5">
              {d.sensitive_nearby.slice(0, 5).map((s, i) => {
                const Icon = s.kind === "hospital" || s.kind === "clinic" ? Hospital : School;
                return (
                  <li key={i} className="flex items-center gap-2 text-[13px]">
                    <Icon className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                    <span className="truncate text-ink-2">{s.name ?? s.kind}</span>
                    <span className="text-[12px] text-ink-3 capitalize">{s.kind}</span>
                    <span className="ml-auto tabular-nums text-[12.5px] text-ink-3">{formatDistance(s.distance_m)}</span>
                  </li>
                );
              })}
              {d.sensitive_nearby.length > 5 && <li className="text-[12.5px] text-ink-3">+{d.sensitive_nearby.length - 5} more within 400 m</li>}
            </ul>
          </div>
        )}
      </Section>

      <DataTrust d={d} onSelect={onSelect} />

      <Evidence d={d} />

      <Section title="History" aside={<span className="text-[12px] text-ink-3"><span className="num">{d.timeline.length}</span> updates, newest first</span>}>
        <Timeline events={d.timeline} />
      </Section>

      <Reports d={d} />

      {(d.related.length > 0 || d.hotspot) && (
        <Section title="Nearby" help={HOTSPOT_HELP}>
          {d.hotspot && (
            <button
              onClick={() => onSelect({ kind: "hotspot", id: d.hotspot!.id, lon: d.lon, lat: d.lat, properties: {} })}
              className="mb-2 flex w-full items-center gap-2.5 rounded-sm border border-line px-3 py-2 text-left hover:bg-surface-2"
            >
              <Flame className="size-3.5 text-p2" aria-hidden />
              <span className="flex-1 min-w-0">
                <span className="block truncate text-[14px] text-ink">Part of hotspot: {d.hotspot.name}</span>
                <span className="block text-[12.5px] text-ink-3">
                  Risk <span className="num">{d.hotspot.risk_score.toFixed(0)}</span>/100 · reports <span className="num">{formatTrend(d.hotspot.trend_pct)}</span> over the last 14 days
                </span>
              </span>
              <ProvenanceBadge kind="model" />
            </button>
          )}
          <ul className="divide-y divide-line">
            {d.related.slice(0, 6).map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onSelect({ kind: "incident", id: r.id, lon: r.lon, lat: r.lat, properties: {} })}
                  className="flex w-full items-center gap-2.5 py-1.5 text-left hover:bg-surface-2 -mx-2 px-2 rounded-sm"
                >
                  <PriorityChip priority={r.priority} size="sm" />
                  <span className="flex-1 truncate text-[13px] text-ink">{r.title}</span>
                  <span className="tabular-nums text-[12px] text-ink-3">{r.distance_m != null ? formatDistance(r.distance_m) : ""}</span>
                  <StatusPill status={r.status} />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Drawer>
  );
}

/* ------------------------------------------------------------------ data trust */

function TrustBlock({ kind, title, children }: { kind: "observed" | "external" | "model" | "recommendation"; title: string; children: React.ReactNode }) {
  return (
    <div className="relative pl-3">
      <span className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full" style={{ background: `var(--prov-${kind})` }} aria-hidden />
      <div className="mb-1.5 flex items-center gap-2">
        <ProvenanceBadge kind={kind} />
        <span className="text-[12.5px] text-ink-3">{title}</span>
      </div>
      {children}
    </div>
  );
}

function DataTrust({ d, onSelect }: { d: Detail; onSelect: (s: Selection) => void }) {
  const photos = d.evidence.filter((e) => e.purpose === "evidence").length;
  const contributions = Object.entries(d.risk.contributions)
    .map(([k, v]) => ({ key: k, label: RISK_DRIVER_LABEL[k] ?? k, value: v }))
    .sort((a, b) => b.value - a.value);
  const maxC = Math.max(1, ...contributions.map((c) => c.value));
  const v = d.verify;
  const vt = v.yes + v.no + v.unsure;

  return (
    <Section
      title="Where this comes from"
      help="Each block shows where a piece of information comes from, so you can tell what residents actually saw from what EcoPulse calculated or suggests."
      aside={<span className="text-[12px] text-ink-3">facts vs. estimates</span>}
    >
      <div className="space-y-4">
        <TrustBlock kind="observed" title={PROVENANCE_PLAIN.observed.help}>
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-[12px] text-ink-3">Reports</dt>
              <dd className="num text-[14px]">{d.report_count}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-3">Evidence photos</dt>
              <dd className="num text-[14px]">{photos}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-ink-3">Measured noise</dt>
              <dd className="num text-[14px]">{d.noise_db != null ? `${d.noise_db.toFixed(0)} dB` : "–"}</dd>
            </div>
          </dl>
          <div className="mt-2.5">
            <p className="mb-1 text-[12.5px] text-ink-3">Residents asked “is it still there?”</p>
            {vt === 0 ? (
              <p className="text-[13px] text-ink-3">No answers yet.</p>
            ) : (
              <div className="flex items-center gap-3 text-[13px]">
                <span>
                  Yes <span className="num text-ink">{v.yes}</span>
                </span>
                <span>
                  No <span className="num text-ink">{v.no}</span>
                </span>
                <span>
                  Unsure <span className="num text-ink">{v.unsure}</span>
                </span>
                <div className="flex h-1.5 flex-1 gap-[2px] overflow-hidden rounded-full" aria-hidden>
                  <span style={{ width: `${(v.yes / vt) * 100}%`, background: "var(--ink-2)" }} />
                  <span style={{ width: `${(v.no / vt) * 100}%`, background: "var(--ok)" }} />
                  <span style={{ width: `${(v.unsure / vt) * 100}%`, background: "var(--line-strong)" }} />
                </div>
              </div>
            )}
          </div>
        </TrustBlock>

        <TrustBlock kind="external" title="Outside data used in the urgency score">
          <p className="text-[13px] text-ink-2">{d.risk.inputs.external ?? "No outside data affected this problem’s urgency score."}</p>
        </TrustBlock>

        <TrustBlock kind="model" title={`How the urgency score was calculated (model ${d.risk.model})`}>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="num text-[20px] font-medium leading-none">{d.risk.score.toFixed(1)}</span>
            <span className="text-[13px] text-ink-3">out of 100 — the factors below add up to it</span>
          </div>
          <ul className="space-y-1" aria-label="Risk contributions">
            {contributions.map((c) => (
              <li key={c.key} className="grid grid-cols-[132px_1fr_36px] items-center gap-2">
                <span className={cn("truncate text-[12.5px]", d.risk.top_drivers.includes(c.key) ? "text-ink" : "text-ink-3")}>{c.label}</span>
                <span className="h-2 rounded-r-[2px] bg-surface-3">
                  <span className="block h-full rounded-r-[2px]" style={{ width: `${(c.value / maxC) * 100}%`, background: "var(--prov-model)", opacity: c.value ? 1 : 0 }} />
                </span>
                <span className="num text-right text-[12.5px] text-ink-2">{c.value.toFixed(1)}</span>
              </li>
            ))}
          </ul>
          {d.risk.note && <p className="mt-1.5 text-[12.5px] text-ink-3">{d.risk.note}</p>}
          <div className="mt-3 border-t border-line pt-2.5">
            <p className="mb-1 flex items-center gap-1.5 text-[12.5px] text-ink-3">
              Automatic category check (AI)
              <InfoTip label="AI classification">The photo and description were checked automatically to suggest a category. Confidence is how sure the check is; “reports agree” is the share of reports given the same category.</InfoTip>
            </p>
            {d.ai.label ? (
              <>
                <p className="text-[14px]">
                  <span className="text-ink">{d.ai.label}</span>
                  {d.ai.subtype && <span className="text-ink-3"> · {d.ai.subtype}</span>}
                  <span className="text-ink-3"> · confidence </span>
                  <span className="num">{formatPct(d.ai.confidence)}</span>
                  {d.ai.agreement != null && (
                    <>
                      <span className="text-ink-3"> · reports agree </span>
                      <span className="num">{formatPct(d.ai.agreement)}</span>
                    </>
                  )}
                </p>
                {d.ai.rationale && <p className="mt-0.5 text-[12.5px] text-ink-3">Rationale: {d.ai.rationale}</p>}
                <p className="mt-0.5 text-[12px] text-ink-3">
                  Provider: <span className="num">{d.ai.providers.join(", ") || "–"}</span>
                  {d.ai.label_distribution.length > 1 && <> · labels: {d.ai.label_distribution.map(([l, n]) => `${l} ${n}`).join(", ")}</>}
                </p>
              </>
            ) : (
              <p className="text-[13px] text-ink-3">Not classified yet.</p>
            )}
          </div>
        </TrustBlock>

        <TrustBlock kind="recommendation" title="Suggested next steps — not facts">
          {d.recommendations.length === 0 ? (
            <p className="text-[13px] text-ink-3">No suggestion for this problem yet. Suggestions appear when problems cluster into a hotspot.</p>
          ) : (
            <ul className="space-y-1">
              {d.recommendations.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => onSelect({ kind: "recommendation", id: r.id, lon: d.lon, lat: d.lat, properties: {} })}
                    className="group block w-full text-left"
                  >
                    <span className="block text-[13px] text-ink group-hover:underline">{r.title}</span>
                    <span className="block text-[12px] text-ink-3">
                      {RECOMMENDATION_KIND[r.kind] ?? r.kind} · {formatPct(r.confidence)} confidence
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TrustBlock>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ evidence */

function Evidence({ d }: { d: Detail }) {
  const before = d.evidence.filter((e) => e.purpose === "evidence");
  const after = d.evidence.filter((e) => e.purpose === "after");
  const [big, setBig] = useState<string | null>(null);
  const resolved = d.status === "resolved" || d.status === "citizen_verified";
  return (
    <Section title="Evidence" aside={<span className="num text-[12px] text-ink-3">{d.evidence.length} photos</span>}>
      {d.evidence.length === 0 ? (
        <p className="flex items-center gap-2 text-[13px] text-ink-3">
          <Camera className="size-3.5" aria-hidden /> No photos were attached to these reports. Residents can add one when they report from the citizen app.
        </p>
      ) : resolved && after.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          <figure>
            <img src={(before[0] ?? after[0]).thumb_url} alt="Before: reported condition" className="aspect-[4/3] w-full rounded-sm object-cover bg-surface-3" />
            <figcaption className="mt-1 text-[12px] text-ink-3">Before · reported</figcaption>
          </figure>
          <figure>
            <img src={after[0].thumb_url} alt="After: condition when resolved" className="aspect-[4/3] w-full rounded-sm object-cover bg-surface-3" />
            <figcaption className="mt-1 text-[12px] text-ink-3">After · {formatDate(after[0].created_at, false)}</figcaption>
          </figure>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {before.slice(0, 6).map((e) => (
            <button key={e.id} onClick={() => setBig(big === e.url ? null : e.url)} className="overflow-hidden rounded-sm" aria-label="Enlarge evidence photo">
              <img src={e.thumb_url} alt="Citizen evidence photo" loading="lazy" className="aspect-square w-full object-cover bg-surface-3 hover:opacity-90" />
            </button>
          ))}
        </div>
      )}
      {big && (
        <a href={big} target="_blank" rel="noreferrer" className="mt-2 block">
          <img src={big} alt="Evidence photo, full size" className="w-full rounded-sm" />
          <span className="mt-1 inline-flex items-center gap-1 text-[12px] text-ink-3">
            Open original <ExternalLink className="size-3" />
          </span>
        </a>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ reports */

function Reports({ d }: { d: Detail }) {
  const [all, setAll] = useState(false);
  const shown = all ? d.reports : d.reports.slice(0, 4);
  return (
    <Section title="Residents’ reports" aside={<span className="inline-flex items-center gap-1 text-[12px] text-ink-3"><Users className="size-3" aria-hidden /><span className="num">{d.reports.length}</span></span>}>
      <ul className="divide-y divide-line">
        {shown.map((r) => (
          <li key={r.id} className="py-2 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] text-ink-2">{r.reporter ?? "Anonymous resident"}</span>
              <time className="tabular-nums text-[12px] text-ink-3" dateTime={r.created_at}>
                {ago(r.created_at)}
              </time>
            </div>
            <p className={cn("text-[14px] leading-snug", r.description ? "text-ink" : "text-ink-3 italic")}>{r.description ?? "No description"}</p>
            <p className="mt-0.5 text-[12px] text-ink-3">
              AI: {r.ai_label ?? "–"}
              {r.ai_confidence != null && <span className="num"> ({formatPct(r.ai_confidence)})</span>}
              {r.duplicate_score != null && (
                <>
                  {" "}
                  · duplicate match <span className="num">{formatPct(r.duplicate_score)}</span>
                </>
              )}
              {r.noise_db != null && (
                <>
                  {" "}
                  · <span className="num">{r.noise_db.toFixed(0)} dB</span>
                </>
              )}
            </p>
          </li>
        ))}
      </ul>
      {d.reports.length > 4 && (
        <button onClick={() => setAll((a) => !a)} className="mt-1 text-[13px] text-brand hover:underline">
          {all ? "Show fewer" : `Show all ${d.reports.length} reports`}
        </button>
      )}
    </Section>
  );
}

export function DrawerSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <Drawer title={<Skeleton className="h-5 w-64" />} eyebrow={<Skeleton className="h-3 w-40" />} onClose={onClose}>
      <div className="space-y-5 px-5 py-3" aria-busy="true">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8" />
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-4" />
          ))}
        </div>
        <Skeleton className="h-32" />
        <Skeleton className="h-24" />
      </div>
    </Drawer>
  );
}

export const isOpenStatus = (s: Detail["status"]) => OPEN_STATUSES.includes(s);
