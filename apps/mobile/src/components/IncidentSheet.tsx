import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { Check, HelpCircle, Lock, MapPin, Sparkles, Users, X } from "lucide-react";
import { LIFECYCLE, OPEN_STATUSES, RISK_DRIVER_LABEL, STATUS, formatDate, haversine, type Domain, type IncidentDetail, type IncidentStatus, type Priority } from "@ecopulse/core";
import { formatDistance, timeAgo } from "../lib/format";
import { useIncident, useIncidentDrives } from "../lib/queries";
import { usePosition } from "../lib/location";
import { api, errorMessage, mediaUrl } from "../lib/api";
import { useUi } from "../lib/ui";
import { haptic } from "../lib/haptics";
import { toast } from "../lib/toast";
import { DRIVER_WORD, EVENT_WORD, STATUS_HINT, STATUS_WORD, confidenceWord, problemTitle, urgencyReason, urgencyWord } from "../lib/words";
import { CategoryBadge } from "./CategoryIcon";
import { DriveCard } from "./Drives";
import { Button, DemoTag, Disclosure, ErrorState, ListRow, PriorityChip, ProvenanceLabel, Sheet, Skeleton, StatusPill, cx, type Snap } from "./ui";

/** Minimal fields we may already know (from a map feature or a list row) before the detail loads. */
export interface IncidentPreview {
  id: string;
  ref?: string;
  title?: string;
  category?: string;
  domain?: Domain;
  priority?: Priority;
  status?: IncidentStatus;
  reporter_count?: number;
  lat?: number;
  lon?: number;
  thumb_url?: string | null;
  is_demo?: boolean;
  location_name?: string | null;
}

export function IncidentSheet({
  preview,
  open,
  snap,
  onSnapChange,
  onClose,
  onOpenRelated,
}: {
  preview: IncidentPreview | null;
  open: boolean;
  snap: Snap;
  onSnapChange: (s: Snap) => void;
  onClose: () => void;
  onOpenRelated?: (p: IncidentPreview) => void;
}) {
  const q = useIncident(open && preview ? preview.id : null);
  const d = q.data && q.data.id === preview?.id ? q.data : null;
  const title = problemTitle(d?.title ?? preview?.title, d?.category ?? preview?.category);
  return (
    <Sheet
      open={open && !!preview}
      onClose={onClose}
      title={title}
      mode="snap"
      snap={snap}
      onSnapChange={onSnapChange}
      peekHeight={200}
      header={preview && <IncidentHeader preview={preview} detail={d} />}
    >
      {preview && (
        <div className="pb-[calc(24px+env(safe-area-inset-bottom))]">
          {q.isError && !d ? (
            <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
          ) : !d ? (
            <DetailSkeleton />
          ) : (
            <IncidentDetailBody d={d} onOpenRelated={onOpenRelated} />
          )}
        </div>
      )}
    </Sheet>
  );
}

function IncidentHeader({ preview, detail }: { preview: IncidentPreview; detail: IncidentDetail | null }) {
  const pos = usePosition();
  const p = { ...preview, ...(detail ?? {}) } as IncidentPreview & Partial<IncidentDetail>;
  const dist = p.lat != null && p.lon != null ? haversine(pos.lat, pos.lon, p.lat, p.lon) : null;
  const thumb = mediaUrl(detail?.evidence?.[0]?.thumb_url ?? p.thumb_url);
  const where = [p.location_name, dist != null && pos.source === "gps" ? `${formatDistance(dist)} away` : null].filter(Boolean).join(" · ");
  return (
    <div className="px-4 pb-3">
      <div className="flex items-start gap-3">
        <CategoryBadge category={p.category} domain={p.domain} size={44} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.1875rem] font-semibold leading-6 text-ink line-clamp-2">{p.title ? problemTitle(p.title, p.category) : "Loading…"}</h2>
          {where && <p className="mt-0.5 text-[0.9375rem] text-ink-2 truncate">{where}</p>}
        </div>
        {thumb && <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-md object-cover border border-line" />}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {p.priority && <PriorityChip priority={p.priority} />}
        {p.status && <StatusPill status={p.status} />}
        {(p.reporter_count ?? 0) > 1 && (
          <span className="inline-flex items-center gap-1 min-h-7 px-1 text-[0.875rem] text-ink-2">
            <Users size={15} aria-hidden />
            {p.reporter_count} people reported this
          </span>
        )}
        {p.is_demo && <DemoTag />}
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="px-4 space-y-4 pt-1" aria-busy="true" aria-label="Loading details">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("px-4 pt-6", className)}>
      <h3 className="mb-2 text-[1.0625rem] font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

export function IncidentDetailBody({ d, onOpenRelated }: { d: IncidentDetail; onOpenRelated?: (p: IncidentPreview) => void }) {
  const openIncident = useUi((s) => s.openIncident);
  const resolved = d.status === "resolved" || d.status === "citizen_verified";
  const before = d.evidence.filter((e) => e.purpose === "evidence");
  const after = d.evidence.filter((e) => e.purpose === "after");
  return (
    <div className="border-t border-line">
      <Verification d={d} />

      {resolved && after.length > 0 && before.length > 0 ? (
        <Section title="Before and after">
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Before", before[0]],
              ["After", after[0]],
            ].map(([label, e]) => (
              <figure key={label as string} className="relative">
                <img src={mediaUrl((e as (typeof before)[0]).url)!} alt={`${label} photo`} className="aspect-[4/3] w-full rounded-md object-cover border border-line" loading="lazy" />
                <figcaption className="absolute left-2 top-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-[0.8125rem] font-medium text-white">{label as string}</figcaption>
              </figure>
            ))}
          </div>
        </Section>
      ) : before.length > 0 ? (
        <Section title={before.length > 1 ? `Photos (${before.length})` : "Photo"}>
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 scroll-area snap-x">
            {before.map((e) => (
              <img key={e.id} src={mediaUrl(e.url)!} alt="Photo of the problem" className="h-44 w-auto max-w-[85%] shrink-0 snap-start rounded-md object-cover border border-line" loading="lazy" />
            ))}
          </div>
          <p className="mt-2 text-[0.875rem] text-ink-2">Hidden details in photos (like where and with which phone they were taken) are removed.</p>
        </Section>
      ) : null}

      <Section title="Progress">
        <Lifecycle status={d.status} />
        {d.assigned_team && (
          <p className="mt-2.5 text-[0.9375rem] text-ink-2">
            Handled by <span className="text-ink">{d.assigned_team}</span>
            {d.assignment?.due_at && <> · aiming to finish by {formatDate(d.assignment.due_at, false)}</>}
          </p>
        )}
      </Section>

      <CleanUp d={d} />

      <Section title="How urgent is it?">
        <p className="text-[1.0625rem] text-ink">
          Urgency: <span className="font-semibold">{urgencyWord(d.risk_score)}</span>
        </p>
        <p className="mt-0.5 text-[0.9375rem] leading-[1.375rem] text-ink-2">{urgencyReason(d)}</p>
        <Disclosure className="mt-0.5">
          <p>
            Urgency score <span className="num text-ink">{Math.round(d.risk_score)}</span> out of 100. It is worked out from how serious the problem is, how many people reported it,
            how many people live nearby, how long it has been open, and whether schools or hospitals are close.
          </p>
          {d.risk.top_drivers.length > 0 && <p>What matters most here: {d.risk.top_drivers.map((k) => DRIVER_WORD[k] ?? (RISK_DRIVER_LABEL[k] ?? k).toLowerCase()).join(", ")}.</p>}
          <p>
            About {d.population_exposed.toLocaleString("en-IN")} people live nearby{d.near_sensitive ? "; a school or hospital is close by" : ""}.
          </p>
          <p>
            <ProvenanceLabel kind="model" detail={`model ${d.risk.model}`} />
          </p>
        </Disclosure>
      </Section>

      <Section title="What it looks like">
        {d.ai.label ? (
          <>
            <p className="text-[1.0625rem] text-ink">
              Looks like: <span className="font-semibold">{d.ai.label}</span> <span className="text-ink-2">({confidenceWord(d.ai.confidence)})</span>
            </p>
            {d.ai.agreement != null && d.report_count > 1 && (
              <p className="mt-0.5 text-[0.9375rem] text-ink-2">{d.ai.agreement >= 0.5 ? "Most reports agree." : "Reports don't all agree on what it is."}</p>
            )}
            <Disclosure className="mt-0.5">
              <p>
                A computer checks the photo and description to guess the kind of problem. It is{" "}
                <span className="num text-ink">{d.ai.confidence != null ? Math.round(d.ai.confidence * 100) : "–"}%</span> sure.
              </p>
              {d.ai.rationale && <p>Why: {capitalise(d.ai.rationale)}</p>}
              {d.ai.agreement != null && d.report_count > 1 && (
                <p>
                  <span className="num">{Math.round(d.ai.agreement * 100)}%</span> of {d.report_count} reports share this label.
                </p>
              )}
              <p>
                <ProvenanceLabel kind="model" detail={d.ai.providers.length ? `checked by ${d.ai.providers.join(", ")}` : undefined} />
              </p>
            </Disclosure>
          </>
        ) : (
          <p className="text-[1rem] text-ink-2">Not checked yet.</p>
        )}
      </Section>

      {d.timeline.length > 0 && (
        <Section title="What has happened">
          <ol className="relative ml-1.5 border-l border-line-strong">
            {[...d.timeline].reverse().slice(0, 8).map((t, i) => (
              <li key={i} className="relative pl-4 pb-3 last:pb-0">
                <span className={cx("absolute -left-[5px] top-2 h-2 w-2 rounded-full", i === 0 ? "bg-brand" : "bg-line-strong")} aria-hidden />
                <p className="text-[1rem] text-ink leading-6">{EVENT_WORD[t.kind] ?? capitalise(t.kind.replace(/_/g, " "))}</p>
                <p className="text-[0.875rem] text-ink-2">
                  {formatDate(t.created_at)}
                  {t.actor && t.actor !== "System" ? ` · ${t.actor}` : ""}
                  {t.note ? ` · ${t.note}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {d.related.length > 0 && (
        <Section title="Other problems close by" className="pb-1">
          <div className="-mx-4 border-y border-line divide-y divide-line">
            {d.related.slice(0, 4).map((r) => (
              <ListRow
                key={r.id}
                leading={<CategoryBadge category={r.category} domain={r.domain} size={36} />}
                title={problemTitle(r.title, r.category)}
                subtitle={`Reported ${timeAgo(r.first_reported_at)}`}
                trailing={<PriorityChip priority={r.priority} compact />}
                onClick={() => (onOpenRelated ? onOpenRelated(r) : openIncident(r.id))}
              />
            ))}
          </div>
        </Section>
      )}

      <div className="px-4 pt-6">
        <p className="flex items-start gap-2 text-[0.9375rem] leading-[1.375rem] text-ink-2">
          <Lock size={16} className="mt-1 shrink-0" aria-hidden /> On the public map this is shown roughly (within {d.location_precision}) to protect privacy. We never show who reported it.
        </p>
        <p className="mt-2 text-[0.875rem] text-ink-3">
          Reference number <span className="num selectable">{d.ref}</span>
        </p>
      </div>
    </div>
  );
}

function Lifecycle({ status }: { status: IncidentStatus }) {
  if (status === "dismissed") return <p className="text-[1rem] text-ink-2">{STATUS_HINT.dismissed}</p>;
  const step = STATUS[status].step;
  const next = LIFECYCLE[step + 1];
  return (
    <div>
      <div className="flex gap-1" role="progressbar" aria-valuemin={1} aria-valuemax={LIFECYCLE.length} aria-valuenow={step + 1} aria-label={`Progress: ${STATUS_WORD[status]}`}>
        {LIFECYCLE.map((s, i) => (
          <span key={s} className={cx("h-2 flex-1 rounded-full", i <= step ? (step >= 6 ? "bg-ok" : "bg-brand") : "bg-surface-3")} />
        ))}
      </div>
      <p className="mt-2.5 text-[1.0625rem] text-ink">
        Now: <span className="font-semibold">{STATUS_WORD[status]}</span>
        <span className="text-[0.875rem] text-ink-2"> (step {step + 1} of {LIFECYCLE.length})</span>
      </p>
      <p className="text-[0.9375rem] text-ink-2">{STATUS_HINT[status]}</p>
      {next && <p className="mt-1 text-[0.9375rem] text-ink-2">Next step: {STATUS_WORD[next]}</p>}
    </div>
  );
}

/** Problems neighbours can safely help clear by hand. */
const CLEANUP_DOMAINS: Domain[] = ["waste", "water", "flood", "green"];

function CleanUp({ d }: { d: IncidentDetail }) {
  const navigate = useNavigate();
  const closeIncident = useUi((s) => s.closeIncident);
  const open = OPEN_STATUSES.includes(d.status) && CLEANUP_DOMAINS.includes(d.domain);
  const q = useIncidentDrives(open ? d.id : null);
  if (!open) return null;
  const drives = q.data?.items ?? [];
  return (
    <Section title="Clean it up together">
      {drives.length > 0 ? (
        <div className="space-y-2.5">
          {drives.map((x) => (
            <DriveCard key={x.id} d={x} showPlace={false} />
          ))}
        </div>
      ) : (
        <p className="text-[0.9375rem] leading-[1.375rem] text-ink-2">Want to help? Plan a clean-up with your neighbours. People living nearby get a message and can join.</p>
      )}
      <Button
        block
        size="sm"
        variant={drives.length ? "ghost" : "secondary"}
        icon={Sparkles}
        className="mt-2.5"
        onClick={() => {
          haptic.tap();
          closeIncident();
          navigate(`/drives/new?incident=${d.id}`);
        }}
      >
        {drives.length ? "Plan another clean-up" : "Organise a clean-up"}
      </Button>
    </Section>
  );
}

type Vote = "yes" | "no" | "unsure";

function Verification({ d }: { d: IncidentDetail }) {
  const pos = usePosition();
  const qc = useQueryClient();
  const reduced = useReducedMotion();
  const resolved = d.status === "resolved" || d.status === "citizen_verified";
  const phase = resolved ? "resolution" : "active";
  const mine = d.my_verification?.phase === phase ? d.my_verification.response : null;
  const [vote, setVote] = useState<Vote | null>(mine);
  const [counts, setCounts] = useState(d.verify);
  useEffect(() => {
    setVote(mine);
    setCounts(d.verify);
  }, [d.id, mine, d.verify]);

  const m = useMutation({
    mutationFn: (r: Vote) => api.incidents.verify(d.id, r, pos.source === "gps" ? { lat: pos.lat, lon: pos.lon } : undefined),
    onSuccess: (res, r) => {
      haptic.success();
      setVote(r);
      setCounts(res.counts);
      qc.invalidateQueries({ queryKey: ["incident", d.id] });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["points"] });
    },
    onError: (e) => {
      haptic.error();
      toast({ title: "We couldn't save your answer", body: errorMessage(e), tone: "danger" });
    },
  });

  if (d.status === "dismissed") return null;
  const options: { v: Vote; label: string; icon: typeof Check }[] = [
    { v: "yes", label: "Yes", icon: Check },
    { v: "no", label: "No", icon: X },
    { v: "unsure", label: "Not sure", icon: HelpCircle },
  ];
  return (
    <section className="px-4 pt-4">
      <div className="rounded-md border border-line-strong bg-surface-2 p-3.5">
        <p className="text-[1.125rem] font-semibold text-ink">{resolved ? "Is the problem still there?" : "Can you see this problem?"}</p>
        <p className="mt-0.5 text-[0.9375rem] leading-[1.375rem] text-ink-2">
          {resolved ? "The city says it's fixed. If you can see it's gone, answer “No”." : "If you're nearby, tell us. Confirmed problems get fixed sooner."}
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label={resolved ? "Is the problem still there?" : "Can you see this problem?"}>
          {options.map((o) => {
            const sel = vote === o.v;
            return (
              <button
                key={o.v}
                type="button"
                aria-pressed={sel}
                disabled={m.isPending}
                onClick={() => {
                  haptic.tap();
                  m.mutate(o.v);
                }}
                className={cx(
                  "pressable flex min-h-14 flex-col items-center justify-center rounded-md border px-1 text-[1rem] font-medium",
                  sel ? "border-brand bg-brand text-brand-ink" : "border-line-strong bg-surface text-ink",
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  <o.icon size={18} aria-hidden />
                  {o.label}
                </span>
                <span className={cx("text-[0.8125rem] font-normal", sel ? "opacity-90" : "text-ink-2")}>
                  {counts[o.v]} {counts[o.v] === 1 ? "person" : "people"}
                </span>
              </button>
            );
          })}
        </div>
        {vote && (
          <motion.p initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} className="mt-2.5 flex items-center gap-1.5 text-[0.9375rem] text-ink-2">
            <Check size={16} className="text-ok" aria-hidden />
            Thank you — we've saved your answer. You can change it any time.
          </motion.p>
        )}
        {pos.source !== "gps" && (
          <p className="mt-2 flex items-start gap-1.5 text-[0.875rem] text-ink-2">
            <MapPin size={15} className="mt-0.5 shrink-0" aria-hidden /> Answers from people nearby count more. Your location is off, so we can't tell if you're close.
          </p>
        )}
      </div>
    </section>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Global host used outside the map (Home, Activity, Messages, Profile). */
export function IncidentSheetHost() {
  const id = useUi((s) => s.incidentId);
  const close = useUi((s) => s.closeIncident);
  const open = useUi((s) => s.openIncident);
  const [snap, setSnap] = useState<Snap>("full");
  const [preview, setPreview] = useState<IncidentPreview | null>(null);
  useEffect(() => {
    if (id) {
      setPreview({ id });
      setSnap("full");
    }
  }, [id]);
  return <IncidentSheet preview={preview} open={!!id} snap={snap} onSnapChange={setSnap} onClose={close} onOpenRelated={(r) => open(r.id)} />;
}
