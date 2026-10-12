import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, MapPin, Users } from "lucide-react";
import type { CleanupDrive } from "@ecopulse/core";
import { api, errorMessage } from "../lib/api";
import { formatDistance } from "../lib/format";
import { haptic } from "../lib/haptics";
import { toast } from "../lib/toast";
import { useUi } from "../lib/ui";
import { Field } from "./AuthForm";
import { Button, Sheet, SheetTitle, cx } from "./ui";

/** "Sat 18 Oct, 9:00 am – 11:00 am" in the phone's time zone. */
export function driveWhen(d: Pick<CleanupDrive, "starts_at" | "ends_at">): string {
  const s = new Date(d.starts_at);
  const e = new Date(d.ends_at);
  const day = s.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const t = (x: Date) => x.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  return `${day}, ${t(s)} – ${t(e)}`;
}

const started = (d: CleanupDrive) => Date.parse(d.starts_at) <= Date.now();
const ended = (d: CleanupDrive) => Date.parse(d.ends_at) < Date.now();

/** Re-fetch every drive list and the incident timelines after a change. */
function useRefreshDrives() {
  const qc = useQueryClient();
  return (d?: CleanupDrive) => {
    qc.invalidateQueries({ queryKey: ["drives"] });
    if (d?.incident) qc.invalidateQueries({ queryKey: ["incident", d.incident.id] });
  };
}

export function DriveCard({ d, showPlace = true }: { d: CleanupDrive; showPlace?: boolean }) {
  const refresh = useRefreshDrives();
  const openIncident = useUi((s) => s.openIncident);
  const [completing, setCompleting] = useState(false);
  const join = useMutation({
    mutationFn: () => (d.joined ? api.drives.leave(d.id) : api.drives.join(d.id)),
    onSuccess: (res) => {
      haptic.success();
      toast({ title: res.joined ? "You're in! See you there." : "You've left this drive", tone: res.joined ? "ok" : undefined });
      refresh(res);
    },
    onError: (e) => {
      haptic.error();
      toast({ title: "Couldn't update", body: errorMessage(e), tone: "danger" });
    },
  });
  const cancel = useMutation({
    mutationFn: () => api.drives.cancel(d.id),
    onSuccess: (res) => {
      toast({ title: "Drive cancelled. Volunteers have been told." });
      refresh(res);
    },
    onError: (e) => toast({ title: "Couldn't cancel", body: errorMessage(e), tone: "danger" }),
  });

  const full = d.spots_left === 0 && !d.joined;
  const open = d.status === "scheduled" && !ended(d);
  return (
    <article className="rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-[1.0625rem] font-semibold leading-6 text-ink">{d.title}</h3>
        {d.status !== "scheduled" ? (
          <span className={cx("shrink-0 text-[0.875rem] font-medium", d.status === "completed" ? "text-ok" : "text-ink-3")}>{d.status === "completed" ? "Done" : "Cancelled"}</span>
        ) : d.joined ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[0.875rem] font-medium text-brand">
            <Check size={15} aria-hidden /> {d.is_organizer ? "Hosting" : "Going"}
          </span>
        ) : null}
      </div>
      <ul className="mt-1.5 space-y-1 text-[0.9375rem] text-ink-2">
        <li className="flex items-center gap-2">
          <CalendarDays size={16} className="shrink-0" aria-hidden />
          {driveWhen(d)}
        </li>
        {showPlace && (
          <li className="flex items-center gap-2">
            <MapPin size={16} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              {d.location_name ?? "Meeting point on the map"}
              {d.distance_m != null && ` · ${formatDistance(d.distance_m)} away`}
            </span>
          </li>
        )}
        <li className="flex items-center gap-2">
          <Users size={16} className="shrink-0" aria-hidden />
          {d.status === "completed"
            ? `${d.attended ?? d.volunteers} people took part · ${d.bags_collected ?? 0} bags collected`
            : `${d.volunteers} going${d.max_volunteers ? ` · ${d.spots_left} of ${d.max_volunteers} spots left` : ""}`}
        </li>
      </ul>
      {d.description && d.status === "scheduled" && <p className="mt-2 text-[0.9375rem] leading-[1.375rem] text-ink">{d.description}</p>}
      {d.status === "completed" && d.outcome_note && <p className="mt-2 text-[0.9375rem] leading-[1.375rem] text-ink">“{d.outcome_note}”</p>}
      {d.organizer && <p className="mt-1.5 text-[0.875rem] text-ink-3">Organised by {d.is_organizer ? "you" : d.organizer}</p>}
      {showPlace && d.incident && (
        <button type="button" onClick={() => openIncident(d.incident!.id)} className="pressable -ml-1 mt-1 min-h-10 px-1 text-left text-[0.9375rem] font-medium text-brand">
          See the problem: {d.incident.title}
        </button>
      )}

      {open && !d.is_organizer && (
        <Button block size="sm" variant={d.joined ? "secondary" : "primary"} className="mt-3" loading={join.isPending} disabled={full} onClick={() => join.mutate()}>
          {d.joined ? "I can't make it" : full ? "This drive is full" : "Join this clean-up"}
        </Button>
      )}
      {d.can_manage && d.status === "scheduled" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" variant={started(d) ? "primary" : "secondary"} disabled={!started(d)} onClick={() => setCompleting(true)}>
            {started(d) ? "Record result" : "Record after start"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={cancel.isPending}
            onClick={() => {
              if (window.confirm("Cancel this clean-up drive? Everyone who joined will get a message.")) cancel.mutate();
            }}
          >
            Cancel drive
          </Button>
        </div>
      )}
      {d.can_manage && <CompleteDriveSheet d={d} open={completing} onClose={() => setCompleting(false)} />}
    </article>
  );
}

function CompleteDriveSheet({ d, open, onClose }: { d: CleanupDrive; open: boolean; onClose: () => void }) {
  const refresh = useRefreshDrives();
  const [bags, setBags] = useState("");
  const [attended, setAttended] = useState(String(d.volunteers));
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () =>
      api.drives.complete(d.id, { bags_collected: Number(bags), attended: Number(attended) || undefined, note: note.trim() || undefined }),
    onSuccess: (res) => {
      haptic.success();
      toast({ title: "Thank you for cleaning up!", body: "Volunteers got EcoPoints, and the city can see what you did.", tone: "ok" });
      refresh(res);
      onClose();
    },
    onError: (e) => toast({ title: "Couldn't save", body: errorMessage(e), tone: "danger" }),
  });
  const valid = bags !== "" && Number(bags) >= 0 && Number.isInteger(Number(bags));
  return (
    <Sheet open={open} onClose={onClose} title="How did the clean-up go?" header={<SheetTitle sub={d.title}>How did the clean-up go?</SheetTitle>}>
      <form
        className="space-y-4 px-4 pb-[calc(24px+env(safe-area-inset-bottom))]"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) m.mutate();
        }}
      >
        <Field label="Bags of waste collected" type="number" inputMode="numeric" min={0} max={10000} value={bags} onChange={(e) => setBags(e.target.value)} required />
        <Field label="People who came" type="number" inputMode="numeric" min={1} max={1000} value={attended} onChange={(e) => setAttended(e.target.value)} hint={`${d.volunteers} people said they would come`} />
        <label className="block">
          <span className="mb-1.5 block text-[0.9063rem] font-medium text-ink-2">Anything to add? (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder="For example: the whole stretch is clear, but the bin is still missing"
            className="block w-full rounded-md border border-line-strong bg-surface px-3.5 py-3 text-[1.0938rem] leading-[1.5rem] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
          />
        </label>
        <Button type="submit" block size="lg" loading={m.isPending} disabled={!valid}>
          Save result
        </Button>
      </form>
    </Sheet>
  );
}
