import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleHelp, CloudOff, Database, Home, LogOut, PlayCircle, RefreshCw, ShieldCheck, Trash2, Type } from "lucide-react";
import { type User } from "@ecopulse/core";
import { timeAgo } from "../lib/format";
import { STATUS_WORD, categoryWord, problemTitle } from "../lib/words";
import { useMe, useMyReports, usePoints } from "../lib/queries";
import { api, errorMessage } from "../lib/api";
import { useApp } from "../lib/store";
import { useLocation } from "../lib/location";
import { discard, syncOutbox, useOutbox } from "../lib/outbox";
import { useNetwork } from "../lib/network";
import { useUi } from "../lib/ui";
import { toast } from "../lib/toast";
import { haptic } from "../lib/haptics";
import { realtime } from "../lib/realtime";
import { CategoryBadge } from "../components/CategoryIcon";
import { Banner, Button, EmptyState, ListRow, SectionHeader, Segmented, Skeleton, SkeletonRows, StatusPill, Switch } from "../components/ui";
import type { TextSize } from "../lib/store";

const REASON: Record<string, string> = {
  report_submitted: "You reported a problem",
  report_corroborated: "You reported a problem others had seen too",
  report_verified: "Your report was confirmed",
  verification: "You confirmed a problem",
  resolution_confirmed: "You checked a fix",
  drive_completed: "You helped at a clean-up drive",
  drive_organized: "You organised a clean-up drive",
};

export function ProfileScreen() {
  const me = useMe();
  const u = me.data;
  const navigate = useNavigate();
  return (
    <div className="scroll-area h-full pb-10">
      <header className="px-4 pt-[calc(env(safe-area-inset-top)+14px)]">
        {u ? <Identity u={u} /> : <Skeleton className="h-20 w-full" />}
      </header>
      {u?.is_guest && (
        <div className="px-4 pt-4">
          <Banner tone="info" title="You're using the app as a guest" action={{ label: "Create account", onClick: () => navigate("/account") }}>
            Create an account so you don't lose your reports and points if you change phones.
          </Banner>
        </div>
      )}
      {u?.stats && (
        <dl className="mx-4 mt-4 grid grid-cols-3 divide-x divide-line rounded-lg border border-line bg-surface">
          {[
            ["Problems reported", u.stats.reports],
            ["Confirmed by neighbours", u.stats.verified_reports],
            ["Times you said yes or no", u.stats.verifications],
          ].map(([k, v]) => (
            <div key={k} className="px-3.5 py-3">
              <dt className="text-[0.8438rem] text-ink-3">{k}</dt>
              <dd className="num mt-1 text-[1.4375rem] font-medium leading-7 text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <QueueSection />
      <MyReports />
      <PointsHistory />
      {u && <Settings u={u} />}
    </div>
  );
}

function Identity({ u }: { u: User }) {
  const lvl = u.level;
  const prevAt = [0, 50, 150, 400, 1000].filter((t) => t <= u.eco_points).pop() ?? 0;
  const pct = lvl.next_at ? Math.min(100, ((u.eco_points - prevAt) / (lvl.next_at - prevAt)) * 100) : 100;
  const initials = u.display_name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div>
      <div className="flex items-center gap-3.5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-[1.2188rem] font-semibold text-brand" aria-hidden>
          {initials}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[1.4375rem] font-semibold leading-7 tracking-[-0.01em] text-ink">{u.display_name}</h1>
          <p className="truncate text-[0.9375rem] text-ink-3">{u.is_guest ? "Guest account" : u.email}</p>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-line bg-surface px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[1.0625rem] text-ink">Your level: <span className="font-semibold">{lvl.name}</span></span>
          <span className="text-[0.9063rem] text-ink-3">
            <span className="num text-[1.1563rem] font-medium text-ink">{u.eco_points}</span> EcoPoints
          </span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level">
          <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-[0.875rem] text-ink-3">
          {lvl.next && lvl.next_at ? (
            <>
              <span className="num">{lvl.next_at - u.eco_points}</span> more points to reach {lvl.next}. You get 5 for each report and 2 for each problem you confirm.
            </>
          ) : (
            "You've reached the highest level. Thank you!"
          )}
        </p>
      </div>
    </div>
  );
}

function QueueSection() {
  const items = useOutbox((s) => s.items);
  const syncing = useOutbox((s) => s.syncing);
  const online = useNetwork((s) => s.online);
  if (!items.length) return null;
  return (
    <section>
      <SectionHeader
        title="Waiting to send"
        aside={
          <span className="inline-flex items-center gap-1">
            <CloudOff size={13} aria-hidden /> {online ? "trying again" : "you're offline"}
          </span>
        }
      />
      <div className="border-y border-line bg-surface divide-y divide-line">
        {items.map((q) => (
          <ListRow
            key={q.client_id}
            leading={<CategoryBadge category={q.category} size={36} />}
            title={categoryWord(q.category, q.category_label)}
            subtitle={q.status === "failed" ? `Couldn't send: ${q.last_error ?? "it was not accepted"}` : `Saved ${timeAgo(new Date(q.queued_at))}${q.attempts ? ` · tried ${q.attempts} time${q.attempts > 1 ? "s" : ""}` : ""}`}
            trailing={
              q.status === "failed" ? (
                <Button size="sm" variant="ghost" icon={Trash2} onClick={() => discard(q.client_id)}>
                  Delete
                </Button>
              ) : null
            }
          />
        ))}
      </div>
      <div className="px-4 pt-2">
        <Button variant="secondary" block icon={RefreshCw} loading={syncing} disabled={!online} onClick={() => syncOutbox(true)}>
          {online ? "Send now" : "Will send when you're online"}
        </Button>
      </div>
    </section>
  );
}

function MyReports() {
  const q = useMyReports();
  const open = useUi((s) => s.openIncident);
  const navigate = useNavigate();
  const items = q.data?.items ?? [];
  return (
    <section>
      <SectionHeader title="Your reports" aside={q.data ? <span className="num">{items.length}</span> : null} />
      {q.isLoading && !q.data ? (
        <SkeletonRows rows={2} />
      ) : items.length === 0 ? (
        <div className="border-y border-line bg-surface">
          <EmptyState title="No reports yet" body="When you report a problem, you can follow its progress here." action={<Button size="sm" onClick={() => navigate("/report")}>Report a problem</Button>} />
        </div>
      ) : (
        <div className="border-y border-line bg-surface divide-y divide-line">
          {items.slice(0, 10).map((r) => (
            <ListRow
              key={r.id}
              leading={r.media[0] ? <img src={r.media[0].thumb_url} alt="" className="h-10 w-10 rounded-md object-cover" /> : <CategoryBadge category={r.category} />}
              title={r.incident ? problemTitle(r.incident.title, r.category) : categoryWord(r.category, r.category_label)}
              subtitle={`Sent ${timeAgo(r.created_at)}${r.is_anonymous ? " · name hidden" : ""}`}
              trailing={r.incident ? <StatusPill status={r.incident.status} /> : <span className="text-[0.8438rem] text-ink-3">{r.status === "received" ? "Received" : "Being checked"}</span>}
              onClick={r.incident ? () => open(r.incident!.id) : undefined}
              label={r.incident ? `${problemTitle(r.incident.title, r.category)}, ${STATUS_WORD[r.incident.status]}` : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PointsHistory() {
  const q = usePoints();
  const h = q.data?.history ?? [];
  if (!h.length) return null;
  return (
    <section>
      <SectionHeader title="How you earned EcoPoints" />
      <ul className="border-y border-line bg-surface divide-y divide-line">
        {h.slice(0, 6).map((p, i) => (
          <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-[1rem] text-ink">{REASON[p.reason] ?? p.reason}</p>
              <p className="text-[0.875rem] text-ink-3">{timeAgo(p.created_at)}</p>
            </div>
            <span className="num text-[1.0625rem] font-medium text-ok">+{p.delta}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Settings({ u }: { u: User }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const locate = useLocation((s) => s.locate);
  const setUser = useApp((s) => s.setUser);
  const signOut = useApp((s) => s.signOut);
  const setExplained = useApp((s) => s.setLocationExplained);

  const update = useMutation({
    mutationFn: api.auth.updateMe,
    onSuccess: (nu) => {
      setUser(nu);
      qc.setQueryData(["me"], (old: User | undefined) => ({ ...old, ...nu }));
    },
    onError: (e) => toast({ title: "We couldn't save that", body: errorMessage(e), tone: "danger" }),
  });

  async function setHome() {
    haptic.tap();
    setExplained(true);
    const p = await locate({ highAccuracy: true });
    if (!p) return toast({ title: "We couldn't find your location", body: "Turn on location to set your home area.", tone: "warn" });
    update.mutate({ home_lat: p.lat, home_lon: p.lon }, { onSuccess: () => toast({ title: "Home area saved", body: "We'll tell you if problems near your home get worse.", tone: "ok" }) });
  }

  const prefs = u.notification_prefs;
  const setPref = (k: keyof User["notification_prefs"], v: boolean) => {
    haptic.select();
    update.mutate({ notification_prefs: { ...prefs, [k]: v } });
  };

  async function logout() {
    haptic.medium();
    await api.auth.logout();
    signOut();
    qc.clear();
    realtime.restart();
    navigate("/", { replace: true });
  }

  return (
    <>
      <SectionHeader title="Your home area" />
      <div className="border-y border-line bg-surface">
        <div className="flex items-center gap-3 px-4 py-3">
          <Home size={20} className="shrink-0 text-ink-3" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[1.0625rem] font-medium text-ink">{u.home ? "Home area saved" : "No home area yet"}</p>
            <p className="text-[0.875rem] leading-[1.1563rem] text-ink-3">{u.home ? "We'll tell you if problems near your home get worse (at most 3 messages a day)." : "Save it to get a message when problems near your home get worse."}</p>
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-3">
          <Button size="sm" variant="secondary" className="flex-1" loading={update.isPending && update.variables?.home_lat != null} onClick={setHome}>
            {u.home ? "Change to where I am now" : "Use where I am now"}
          </Button>
          {u.home && (
            <Button size="sm" variant="ghost" onClick={() => update.mutate({ clear_home: true })}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <SectionHeader title="Messages we send you" />
      <div className="border-y border-line bg-surface divide-y divide-line">
        {(
          [
            ["my_reports", "Your reports", "When your report is confirmed, sent to a team or fixed"],
            ["area", "Near your home", "When problems near your home get worse"],
            ["rewards", "EcoPoints", "When you earn points or reach a new level"],
          ] as const
        ).map(([k, label, sub]) => (
          <div key={k} className="flex items-center gap-3 px-4 py-3 min-h-[3.75rem]">
            <div className="min-w-0 flex-1">
              <p className="text-[1.0625rem] text-ink">{label}</p>
              <p className="text-[0.875rem] text-ink-3">{sub}</p>
            </div>
            <Switch checked={prefs[k] !== false} onChange={(v) => setPref(k, v)} label={`Messages: ${label}`} />
          </div>
        ))}
      </div>

      <TextSizeSetting />

      <SectionHeader title="Help" />
      <div className="border-y border-line bg-surface divide-y divide-line">
        <ListRow leading={<CircleHelp size={22} className="text-ink-2" />} title="Help & questions" subtitle="Simple answers to common questions" chevron onClick={() => navigate("/profile/help")} />
        <ListRow leading={<PlayCircle size={22} className="text-ink-2" />} title="How EcoPulse works" subtitle="See the short introduction again" chevron onClick={() => navigate("/profile/how")} />
        <ListRow leading={<ShieldCheck size={22} className="text-ink-2" />} title="Your privacy" subtitle="What others can see, and what stays private" chevron onClick={() => navigate("/profile/privacy")} />
        <ListRow leading={<Database size={22} className="text-ink-2" />} title="Where our information comes from" subtitle="Sources, sample data and how we calculate things" chevron onClick={() => navigate("/profile/sources")} />
      </div>

      <div className="px-4 pt-6">
        <Button variant="danger" block icon={LogOut} onClick={logout}>
          Sign out
        </Button>
        {u.is_guest && <p className="mt-2 text-center text-[0.875rem] text-ink-2">If you sign out as a guest, you can't get back your reports and points.</p>}
      </div>
    </>
  );
}


const SIZES: { value: TextSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "xl", label: "Extra large" },
];

function TextSizeSetting() {
  const size = useApp((s) => s.textSize);
  const setSize = useApp((s) => s.setTextSize);
  return (
    <>
      <SectionHeader title="Text size" />
      <div className="border-y border-line bg-surface px-4 py-3.5">
        <div className="flex items-center gap-3">
          <Type size={22} className="shrink-0 text-ink-2" aria-hidden />
          <p className="text-[1rem] leading-6 text-ink">Make words bigger and easier to read. This changes the whole app.</p>
        </div>
        <Segmented
          label="Text size"
          value={size}
          onChange={(v) => {
            haptic.select();
            setSize(v);
          }}
          options={SIZES}
          className="mt-3"
        />
      </div>
    </>
  );
}
