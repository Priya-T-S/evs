import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Users } from "lucide-react";
import { formatDate, type CleanupDrive } from "@ecopulse/core";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ErrorState, Section, Skeleton } from "@/components/ui";
import { plural } from "@/lib/glossary";

export const DRIVES_HELP =
  "Residents can organise a clean-up drive at a reported problem from the citizen app. Neighbours join, and the organiser records how many bags were collected. Volunteers earn EcoPoints. A clean-up does not close the problem: staff still confirm and resolve it.";

const STATUS_WORD: Record<CleanupDrive["status"], string> = { scheduled: "Upcoming", completed: "Done", cancelled: "Cancelled" };

/** Community clean-up drives at an incident or hotspot (read-only for staff). */
export function DrivesSection({ incidentId, hotspotId }: { incidentId?: string; hotspotId?: string }) {
  const q = useQuery({
    queryKey: ["drives", { incidentId, hotspotId }],
    queryFn: () => api.drives.list({ when: "all", incident_id: incidentId, hotspot_id: hotspotId, limit: 10 }),
  });
  const items = q.data?.items ?? [];
  if (q.isSuccess && items.length === 0) return null;
  return (
    <Section title="Community clean-ups" help={DRIVES_HELP} aside={q.isSuccess ? <span className="num text-[12px] text-ink-3">{items.length}</span> : undefined}>
      {q.isPending && <Skeleton className="h-12" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} compact />}
      <ul className="divide-y divide-line">
        {items.map((d) => (
          <li key={d.id} className="py-2 first:pt-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[14px] text-ink">{d.title}</span>
              <span
                className={cn(
                  "shrink-0 text-[12px]",
                  d.status === "completed" ? "text-ok" : d.status === "cancelled" ? "text-ink-3 line-through" : "text-brand",
                )}
              >
                {STATUS_WORD[d.status]}
              </span>
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-ink-3">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3" aria-hidden />
                <span className="tabular-nums">{formatDate(d.starts_at)}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <Users className="size-3" aria-hidden />
                {plural(d.attended ?? d.volunteers, "volunteer")}
                {d.max_volunteers && d.status === "scheduled" && <> of {d.max_volunteers}</>}
              </span>
              {d.organizer && <span>by {d.organizer}</span>}
            </p>
            {d.status === "completed" && (
              <p className="mt-0.5 text-[13px] text-ink-2">
                <span className="num">{d.bags_collected ?? 0}</span> bags collected{d.outcome_note && <> · “{d.outcome_note}”</>}
              </p>
            )}
            {!d.incident && d.status !== "completed" && d.description && <p className="mt-0.5 text-[13px] text-ink-2">{d.description}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
