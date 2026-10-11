import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, PlayCircle, RotateCcw, UserPlus, XCircle } from "lucide-react";
import { OPEN_STATUSES, SEVERITY, type IncidentDetail } from "@ecopulse/core";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/query";
import { Button, Dialog, Field, Input, Select, Textarea, toast } from "@/components/ui";

type ActionKind = "verify" | "dismiss" | "reopen" | "assign" | "start" | "resolve";

/** Workflow actions, gated by the per-incident `can` flags returned by the API. */
export function IncidentActions({ d }: { d: IncidentDetail }) {
  const [open, setOpen] = useState<ActionKind | null>(null);
  const isOpen = OPEN_STATUSES.includes(d.status);
  const closed = !isOpen;
  const can = d.can;
  const buttons: { kind: ActionKind; label: string; icon: React.ReactNode; show: boolean; variant?: "primary" | "secondary" | "danger" }[] = [
    { kind: "verify", label: "Verify it’s real", icon: <ClipboardCheck className="size-3.5" />, show: can.moderate && ["reported", "ai_classified"].includes(d.status) },
    { kind: "assign", label: d.assigned_team ? "Change team" : "Assign to team", icon: <UserPlus className="size-3.5" />, show: can.assign && isOpen && d.status !== "action_started" },
    { kind: "start", label: "Start work", icon: <PlayCircle className="size-3.5" />, show: can.resolve && d.status === "assigned" },
    { kind: "resolve", label: "Mark as fixed", icon: <CheckCircle2 className="size-3.5" />, show: can.resolve && isOpen, variant: "primary" },
    { kind: "dismiss", label: "Dismiss", icon: <XCircle className="size-3.5" />, show: can.moderate && isOpen, variant: "danger" },
    { kind: "reopen", label: "Reopen", icon: <RotateCcw className="size-3.5" />, show: can.moderate && closed },
  ];
  const visible = buttons.filter((b) => b.show);
  if (!visible.length)
    return (
      <p className="text-[13px] text-ink-3">
        {closed ? "This problem is closed. Nothing more to do." : "You can view this problem, but your role can’t change it. Ask a moderator or officer if something needs doing."}
      </p>
    );

  // Primary first on the right; others on the left.
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {visible
          .filter((b) => b.variant !== "primary")
          .map((b) => (
            <Button key={b.kind} size="sm" variant={b.variant ?? "secondary"} icon={b.icon} onClick={() => setOpen(b.kind)}>
              {b.label}
            </Button>
          ))}
        {visible
          .filter((b) => b.variant === "primary")
          .map((b) => (
            <Button key={b.kind} size="sm" variant="primary" icon={b.icon} onClick={() => setOpen(b.kind)} className="ml-auto">
              {b.label}
            </Button>
          ))}
      </div>
      {open && <ActionDialog kind={open} d={d} onClose={() => setOpen(null)} />}
    </>
  );
}

const TITLES: Record<ActionKind, string> = {
  verify: "Verify this problem is real",
  dismiss: "Dismiss this problem",
  reopen: "Reopen this problem",
  assign: "Assign to a team",
  start: "Start work",
  resolve: "Mark as fixed",
};

/** One line on what happens next, shown at the top of each action dialog. */
const CONSEQUENCE: Record<ActionKind, string> = {
  verify: "Confirms it’s a genuine problem. It moves to “Verified” and residents who reported it see “Confirmed”.",
  assign: "The team is notified and the residents who reported it will see “Team assigned”.",
  start: "Records that the team has started work on site. Residents who reported it see “Being fixed”.",
  resolve: "Closes the problem as fixed. Residents who reported it see “Fixed” and are asked to confirm the fix.",
  dismiss: "Removes it from the queue and the map — use for duplicates or things that aren’t environmental problems. Reporters are not penalised, and it can be reopened later.",
  reopen: "Puts it back in the open queue so it can be prioritised and assigned again.",
};

const CONFIRM: Record<ActionKind, string> = {
  verify: "Verify",
  assign: "Assign team",
  start: "Start work",
  resolve: "Mark as fixed",
  dismiss: "Dismiss",
  reopen: "Reopen",
};

function ActionDialog({ kind, d, onClose }: { kind: ActionKind; d: IncidentDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [team, setTeam] = useState<string>(d.assigned_team ?? "");
  const [assignee, setAssignee] = useState<string>("");
  const [due, setDue] = useState<string>("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const meta = useQuery({ queryKey: ["meta"], queryFn: api.meta, staleTime: Infinity, enabled: kind === "verify" || kind === "dismiss" || kind === "reopen" });
  const assignable = useQuery({ queryKey: ["assignable"], queryFn: api.admin.assignable, staleTime: 300_000, enabled: kind === "assign" });

  const m = useMutation({
    mutationFn: async () => {
      switch (kind) {
        case "verify":
        case "dismiss":
        case "reopen":
          return api.incidents.moderate(d.id, {
            action: kind,
            note: note || undefined,
            severity: severity ? Number(severity) : undefined,
            category: category || undefined,
          });
        case "assign":
          return api.incidents.assign(d.id, { team, assignee_id: assignee || undefined, note: note || undefined, due_at: due ? new Date(due).toISOString() : undefined });
        case "start":
          return api.incidents.start(d.id, note || undefined);
        case "resolve": {
          const f = new FormData();
          f.set("note", note);
          if (photo) f.set("photo", photo);
          return api.incidents.resolve(d.id, f);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incident", d.id] });
      qc.invalidateQueries({ queryKey: ["queue"] });
      qc.invalidateQueries({ queryKey: ["pulse"] });
      const done: Record<ActionKind, string> = {
        verify: "Verified as a real problem",
        assign: `Assigned to ${team}`,
        start: "Work started",
        resolve: "Marked as fixed — residents will be asked to confirm",
        dismiss: "Dismissed and removed from the queue",
        reopen: "Reopened and back in the queue",
      };
      toast({ tone: "success", title: done[kind], body: `${d.ref} · ${d.title}` });
      onClose();
    },
    onError: (e) => setErr(errorMessage(e)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (kind === "resolve" && note.trim().length < 3) return setErr("Please describe what was done, in a few words.");
    if (kind === "assign" && !team) return setErr("Choose which team should fix this.");
    m.mutate();
  };

  const moderate = kind === "verify" || kind === "dismiss" || kind === "reopen";
  const users = (assignable.data?.users ?? []).filter((u) => !team || u.team === team);

  return (
    <Dialog
      open
      onClose={onClose}
      title={TITLES[kind]}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={kind === "dismiss" ? "danger" : "primary"} loading={m.isPending} type="submit" form="action-form">
            {CONFIRM[kind]}
          </Button>
        </>
      }
    >
      <form id="action-form" onSubmit={submit} className="space-y-3">
        <p className="text-[14px] leading-snug text-ink">{CONSEQUENCE[kind]}</p>
        <p className="text-[13px] text-ink-3">
          <span className="num text-ink-2">{d.ref}</span> · {d.title}
        </p>
        {moderate && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fix the severity" hint="Leave as is if it’s right">
              {(id) => (
                <Select id={id} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                  <option value="">Keep · {SEVERITY[d.severity].label}</option>
                  {[1, 2, 3, 4].map((s) => (
                    <option key={s} value={s} disabled={s === d.severity}>
                      {SEVERITY[s].label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Fix the category" hint="Leave as is if it’s right">
              {(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Keep · {d.category_label}</option>
                  {meta.data?.categories
                    .filter((c) => c.slug !== d.category)
                    .map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.label}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        {kind === "assign" && (
          <>
            <Field label="Team" required>
              {(id) => (
                <Select id={id} value={team} onChange={(e) => setTeam(e.target.value)} disabled={assignable.isPending}>
                  <option value="">{assignable.isPending ? "Loading teams…" : "Choose a team"}</option>
                  {assignable.data?.teams.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Assignee (optional)">
                {(id) => (
                  <Select id={id} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                    <option value="">Whole team</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Due date (optional)">{(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} min={new Date().toISOString().slice(0, 10)} />}</Field>
            </div>
          </>
        )}
        <Field label={kind === "resolve" ? "What was done" : "Note (optional)"} required={kind === "resolve"} hint={kind === "resolve" ? "Residents who reported it will see this." : "Saved in the history and audit log."}>
          {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={kind === "resolve" ? 1000 : 500} />}
        </Field>
        {kind === "resolve" && (
          <Field label="After photo (optional)" hint="Shown next to the original evidence as a before/after comparison.">
            {(id) => <input id={id} type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="text-[13px] text-ink-2 file:mr-3 file:h-7 file:rounded-sm file:border file:border-line-strong file:bg-surface-2 file:px-2.5 file:text-[13px] file:text-ink" />}
          </Field>
        )}

        {err && (
          <p role="alert" className="text-[13px] text-[color:var(--danger-ink)]">
            {err}
          </p>
        )}
      </form>
    </Dialog>
  );
}
