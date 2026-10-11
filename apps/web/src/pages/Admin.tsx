import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, Play, RefreshCw, Search } from "lucide-react";
import { formatDate, formatPct, type Permission, type ProviderStatus, type Role, type User } from "@ecopulse/core";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDebounced, ago } from "@/lib/hooks";
import { errorMessage } from "@/lib/query";
import { cn } from "@/lib/cn";
import { TopBar } from "@/components/layout/AppShell";
import { Button, EmptyState, ErrorState, Input, ProvenanceBadge, Select, SkeletonRows, Tabs, toast } from "@/components/ui";

type Tab = "users" | "audit" | "sources" | "jobs";
const TABS: { key: Tab; label: string; perm?: Permission }[] = [
  { key: "users", label: "Users", perm: "users.manage" },
  { key: "audit", label: "Audit log", perm: "audit.view" },
  { key: "sources", label: "Data sources" },
  { key: "jobs", label: "Jobs", perm: "jobs.run" },
];
const ROLES: Role[] = ["citizen", "moderator", "analyst", "officer", "admin"];

export default function Admin() {
  const perms = useAuth((s) => s.user?.permissions ?? []);
  const tabs = TABS.filter((t) => !t.perm || perms.includes(t.perm));
  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? "sources");
  return (
    <>
      <TopBar title="Administration" />
      <main id="main" className="flex min-h-0 flex-1 flex-col bg-bg">
        <div className="border-b border-line bg-surface px-6">
          <Tabs label="Administration sections" value={tab} onChange={setTab} items={tabs.map((t) => ({ key: t.key, label: t.label }))} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1180px] px-6 py-5">
            {tab === "users" && <Users />}
            {tab === "audit" && <Audit />}
            {tab === "sources" && <Sources />}
            {tab === "jobs" && <Jobs />}
          </div>
        </div>
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ users */

function Users() {
  const me = useAuth((s) => s.user);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const dq = useDebounced(q, 250);
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["admin-users", dq, role], queryFn: () => api.admin.users({ q: dq || undefined, role: role || undefined, limit: 200 }) });
  const teams = useQuery({ queryKey: ["assignable"], queryFn: api.admin.assignable, staleTime: 300_000 });
  const m = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { role?: string; team?: string } }) => api.admin.updateUser(id, body),
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["assignable"] });
      toast({ tone: "success", title: `Updated ${u.display_name}`, body: `${u.role}${u.team ? ` · ${u.team}` : ""}` });
    },
    onError: (e) => toast({ tone: "error", title: "Update failed", body: errorMessage(e) }),
  });
  const rank: Record<string, number> = { admin: 0, officer: 1, analyst: 2, moderator: 3, citizen: 4 };
  const items = (users.data?.items ?? []).filter((u) => !u.is_guest).sort((a, b) => rank[a.role] - rank[b.role] || a.display_name.localeCompare(b.display_name));
  return (
    <section aria-labelledby="users-h">
      <div className="mb-3 flex items-center gap-3">
        <h1 id="users-h" className="text-[15px] font-semibold">
          Users
        </h1>
        <div className="relative ml-auto w-[260px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input aria-label="Search users" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
        </div>
        <div className="w-[150px] shrink-0">
        <Select aria-label="Filter by role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r[0].toUpperCase() + r.slice(1)}
            </option>
          ))}
        </Select>
        </div>
      </div>
      {users.isPending && <SkeletonRows rows={8} />}
      {users.isError && <ErrorState error={users.error} onRetry={() => users.refetch()} />}
      {users.isSuccess && items.length === 0 && <EmptyState title="No users found" />}
      {items.length > 0 && (
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-wider text-ink-3">
              <th className="py-2 pr-3 font-medium">User</th>
              <th className="py-2 pr-3 font-medium w-[150px]">Role</th>
              <th className="py-2 pr-3 font-medium w-[260px]">Team</th>
              <th className="py-2 pr-3 font-medium text-right">Eco points</th>
              <th className="py-2 font-medium text-right">Joined</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <UserRow key={u.id} u={u} self={u.id === me?.id} teams={teams.data?.teams ?? []} onSave={(body) => m.mutate({ id: u.id, body })} busy={m.isPending && m.variables?.id === u.id} />
            ))}
          </tbody>
        </table>
      )}
      <datalist id="team-options">
        {teams.data?.teams.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </section>
  );
}

function UserRow({ u, self, onSave, busy }: { u: User; self: boolean; teams: string[]; onSave: (b: { role?: string; team?: string }) => void; busy: boolean }) {
  const [team, setTeam] = useState(u.team ?? "");
  const dirty = team !== (u.team ?? "");
  return (
    <tr className="border-b border-line">
      <td className="py-2 pr-3">
        <p className="text-[14px] font-medium">
          {u.display_name}
          {self && <span className="ml-1.5 text-[12px] font-normal text-ink-3">(you)</span>}
        </p>
        <p className="text-[12.5px] text-ink-3">{u.email}</p>
      </td>
      <td className="py-2 pr-3">
        <Select aria-label={`Role for ${u.display_name}`} value={u.role} disabled={self || busy} onChange={(e) => onSave({ role: e.target.value })} className="[&_select]:h-7 [&_select]:text-[13px]">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r[0].toUpperCase() + r.slice(1)}
            </option>
          ))}
        </Select>
      </td>
      <td className="py-2 pr-3">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && team.trim().length >= 2) onSave({ team: team.trim() });
          }}
        >
          <Input aria-label={`Team for ${u.display_name}`} list="team-options" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="No team" className="h-7 text-[13px]" />
          {dirty && (
            <Button size="sm" type="submit" variant="primary" loading={busy}>
              Save
            </Button>
          )}
        </form>
      </td>
      <td className="py-2 pr-3 text-right text-[13px] tabular-nums text-ink-2">{u.eco_points.toLocaleString("en-IN")}</td>
      <td className="py-2 text-right text-[13px] tabular-nums text-ink-3">{formatDate(u.created_at, false)}</td>
    </tr>
  );
}

/* ------------------------------------------------------------------ audit */

function Audit() {
  const [action, setAction] = useState("");
  const [limit, setLimit] = useState(100);
  const da = useDebounced(action, 300);
  const q = useQuery({ queryKey: ["audit", da, limit], queryFn: () => api.admin.audit({ action: da || undefined, limit }), placeholderData: (p) => p });
  const items = q.data?.items ?? [];
  return (
    <section aria-labelledby="audit-h">
      <div className="mb-3 flex items-center gap-3">
        <h1 id="audit-h" className="shrink-0 whitespace-nowrap text-[15px] font-semibold">
          Audit log
        </h1>
        <p className="text-[13px] text-ink-3">Every privileged action, with actor and source IP.</p>
        <div className="ml-auto w-[280px] shrink-0">
          <Input aria-label="Filter by action" placeholder="Filter action, e.g. incident.assign" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
      </div>
      {q.isPending && <SkeletonRows rows={10} />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isSuccess && items.length === 0 && <EmptyState title="No audit entries" hint={da ? "No entries match this action." : undefined} />}
      {items.length > 0 && (
        <table className={cn("w-full border-collapse text-left", q.isPlaceholderData && "opacity-60")}>
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-wider text-ink-3">
              <th className="py-2 pr-3 font-medium w-[150px]">When</th>
              <th className="py-2 pr-3 font-medium">Action</th>
              <th className="py-2 pr-3 font-medium">Actor</th>
              <th className="py-2 pr-3 font-medium">Target</th>
              <th className="py-2 pr-3 font-medium">Details</th>
              <th className="py-2 font-medium text-right">IP</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="border-b border-line align-top">
                <td className="py-1.5 pr-3 text-[13px] tabular-nums text-ink-2" title={formatDate(e.created_at)}>
                  {formatDate(e.created_at)}
                </td>
                <td className="py-1.5 pr-3 font-mono text-[13px]">{e.action}</td>
                <td className="py-1.5 pr-3 text-[13px]">{e.actor ?? "System"}</td>
                <td className="py-1.5 pr-3 text-[13px] text-ink-2">
                  {e.target_type ? (
                    <>
                      {e.target_type} <span className="font-mono text-[12px] text-ink-3">{e.target_id?.slice(0, 8)}</span>
                    </>
                  ) : (
                    "–"
                  )}
                </td>
                <td className="max-w-[320px] truncate py-1.5 pr-3 font-mono text-[12px] text-ink-3" title={JSON.stringify(e.data)}>
                  {Object.keys(e.data).length ? Object.entries(e.data).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" ") : ""}
                </td>
                <td className="py-1.5 text-right font-mono text-[12px] text-ink-3">{e.ip ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {items.length >= limit && limit < 500 && (
        <Button size="sm" variant="ghost" className="mt-3" loading={q.isFetching} onClick={() => setLimit((l) => Math.min(500, l + 100))}>
          Load older entries
        </Button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ data sources */

const SRC_STATUS: Record<ProviderStatus["status"], { label: string; color: string; shape: string }> = {
  live: { label: "Live", color: "var(--ok)", shape: "●" },
  demo: { label: "Demo data", color: "var(--p3)", shape: "◐" },
  not_configured: { label: "Not configured", color: "var(--ink-3)", shape: "○" },
};

function Sources() {
  const q = useQuery({ queryKey: ["external-status"], queryFn: api.external.status, refetchInterval: 60_000 });
  const syn = q.data?.synthetic;
  const rows = useMemo(() => q.data?.providers ?? [], [q.data]);
  return (
    <section aria-labelledby="src-h" className="space-y-6">
      <div>
        <div className="mb-3 flex items-center gap-3">
          <h1 id="src-h" className="text-[15px] font-semibold">
            External data sources
          </h1>
          <ProvenanceBadge kind="external" />
        </div>
        {q.isPending && <SkeletonRows rows={4} />}
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {rows.length > 0 && (
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line text-[11.5px] uppercase tracking-wider text-ink-3">
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium w-[150px]">Status</th>
                <th className="py-2 pr-3 font-medium">Last data</th>
                <th className="py-2 pr-3 font-medium">Last success</th>
                <th className="py-2 font-medium">Notes / errors</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const s = SRC_STATUS[p.status];
                return (
                  <tr key={p.name} className="border-b border-line align-top">
                    <td className="py-2 pr-3">
                      <p className="text-[14px] font-medium">{p.source}</p>
                      <p className="text-[12.5px] text-ink-3">
                        {p.kind}
                        {p.requires_key && " · requires API key"}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: s.color }}>
                        <span aria-hidden>{s.shape}</span>
                        {s.label}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-[13px] tabular-nums text-ink-2" title={p.last_data_at ? formatDate(p.last_data_at) : undefined}>
                      {p.last_data_at ? ago(p.last_data_at) : "–"}
                    </td>
                    <td className="py-2 pr-3 text-[13px] tabular-nums text-ink-2">{p.last_success ? ago(p.last_success) : "–"}</td>
                    <td className="py-2 text-[13px]">
                      {p.last_error ? <span className="text-[color:var(--danger-ink)]">{p.last_error}</span> : <span className="text-ink-3">{p.notes ?? "No errors"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {syn && (
        <div className="rounded-md border border-dashed border-line-strong px-4 py-3">
          <p className="mb-2 flex items-center gap-2 text-[14px] font-medium">
            <Info className="size-4 text-ink-3" aria-hidden /> Synthetic data disclosure
          </p>
          <ul className="grid grid-cols-2 gap-x-8 gap-y-1 text-[14px] text-ink-2">
            <li className="flex justify-between border-b border-line py-1">
              <span>Incidents that are seeded demo data</span>
              <span className="tabular-nums text-ink">{formatPct(syn.incident_share)}</span>
            </li>
            <li className="flex justify-between border-b border-line py-1">
              <span>Neighbourhood boundaries</span>
              <span className="text-ink">{syn.neighbourhood_boundaries ? "Synthetic (demo)" : "Official"}</span>
            </li>
            <li className="flex justify-between border-b border-line py-1">
              <span>Green zones</span>
              <span className="text-ink">{syn.green_zones ? "Synthetic (demo)" : "OpenStreetMap"}</span>
            </li>
            <li className="flex justify-between border-b border-line py-1">
              <span>Schools & hospitals</span>
              <span className="text-ink">{syn.sensitive_sites ? "Synthetic (demo)" : "OpenStreetMap"}</span>
            </li>
            <li className="flex justify-between py-1">
              <span>Population</span>
              <span className="text-ink">{syn.population}</span>
            </li>
          </ul>
          <p className="mt-2 text-[12.5px] text-ink-3">Demo items are tagged “Demo data” wherever they appear in the command center.</p>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ jobs */

function Jobs() {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (name: "regenerate" | "refresh_external") => api.admin.runJob(name),
    onSuccess: (r) => {
      toast({ tone: "success", title: `Job queued: ${r.queued}`, body: "Results stream in over realtime as they’re computed." });
      setTimeout(() => qc.invalidateQueries(), 4000);
    },
    onError: (e) => toast({ tone: "error", title: "Couldn’t queue the job", body: errorMessage(e) }),
  });
  const jobs = [
    { name: "regenerate" as const, title: "Regenerate intelligence", body: "Recompute risk scores, hotspots (observed + forecast), environmental scores, flood risk and recommendations from current data.", icon: <RefreshCw className="size-3.5" /> },
    { name: "refresh_external" as const, title: "Refresh external data", body: "Fetch the latest air quality, weather and elevation from external providers, then rescore affected areas.", icon: <Play className="size-3.5" /> },
  ];
  return (
    <section aria-labelledby="jobs-h">
      <h1 id="jobs-h" className="mb-3 text-[15px] font-semibold">
        Background jobs
      </h1>
      <ul className="divide-y divide-line border-y border-line">
        {jobs.map((j) => (
          <li key={j.name} className="flex items-center gap-6 py-3.5">
            <div className="flex-1">
              <p className="text-[14px] font-medium">{j.title}</p>
              <p className="text-[13px] text-ink-3 max-w-[640px]">{j.body}</p>
            </div>
            <Button icon={j.icon} loading={m.isPending && m.variables === j.name} onClick={() => m.mutate(j.name)}>
              Run now
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12.5px] text-ink-3">Jobs run asynchronously on the worker and are recorded in the audit log.</p>
    </section>
  );
}
