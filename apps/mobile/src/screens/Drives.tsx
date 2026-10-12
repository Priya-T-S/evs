import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useDrivesNear, useIncident, useMe, useMyDrives } from "../lib/queries";
import { usePosition } from "../lib/location";
import { useNetwork } from "../lib/network";
import { haptic } from "../lib/haptics";
import { toast } from "../lib/toast";
import { problemTitle } from "../lib/words";
import { ScreenHeader } from "../components/ScreenHeader";
import { DriveCard } from "../components/Drives";
import { Field } from "../components/AuthForm";
import { Banner, Button, EmptyState, ErrorState, SectionHeader, Segmented, SkeletonRows } from "../components/ui";

const DRIVE_RADIUS_M = 10_000;

export function DrivesScreen() {
  const [tab, setTab] = useState<"near" | "mine">("near");
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Clean-up drives" />
      <div className="scroll-area flex-1 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <p className="px-4 pt-4 text-[1rem] leading-6 text-ink-2">
          Neighbours get together to clean up a reported problem. Join one near you, or open a problem and tap “Organise a clean-up”. Everyone who takes part earns EcoPoints.
        </p>
        <div className="px-4 pt-4">
          <Segmented
            label="Which drives"
            value={tab}
            onChange={setTab}
            options={[
              { value: "near", label: "Near you" },
              { value: "mine", label: "Yours" },
            ]}
          />
        </div>
        {tab === "near" ? <NearList /> : <MineList />}
      </div>
    </div>
  );
}

function List({ q, empty }: { q: ReturnType<typeof useDrivesNear>; empty: React.ReactNode }) {
  const online = useNetwork((s) => s.online);
  if (q.isLoading && !q.data) return <SkeletonRows rows={3} />;
  if (q.isError && !q.data) return <ErrorState offline={!online} message="We couldn't load clean-up drives." onRetry={() => q.refetch()} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <>{empty}</>;
  return (
    <div className="space-y-3 px-4">
      {items.map((d) => (
        <DriveCard key={d.id} d={d} />
      ))}
    </div>
  );
}

function NearList() {
  const pos = usePosition();
  const q = useDrivesNear(pos, DRIVE_RADIUS_M);
  return (
    <section aria-label="Upcoming drives near you">
      <SectionHeader title="Coming up" aside={<span>within 10 km</span>} />
      <List q={q} empty={<EmptyState icon={Sparkles} title="No clean-ups planned near you" body="Be the first: open a problem on the map or on Home and tap “Organise a clean-up”." />} />
    </section>
  );
}

function MineList() {
  const q = useMyDrives();
  const { upcoming, past } = useMemo(() => {
    const items = q.data?.items ?? [];
    const isUpcoming = (d: (typeof items)[number]) => d.status === "scheduled" && Date.parse(d.ends_at) >= Date.now();
    return { upcoming: items.filter(isUpcoming).reverse(), past: items.filter((d) => !isUpcoming(d)) };
  }, [q.data]);
  const empty = <EmptyState icon={Sparkles} title="You haven't joined a clean-up yet" body="Drives you join or organise will show up here." />;
  if (!q.data || (!upcoming.length && !past.length)) return <List q={q} empty={empty} />;
  return (
    <>
      {upcoming.length > 0 && (
        <section aria-label="Your upcoming drives">
          <SectionHeader title="Coming up" />
          <div className="space-y-3 px-4">
            {upcoming.map((d) => (
              <DriveCard key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}
      {past.length > 0 && (
        <section aria-label="Your past drives">
          <SectionHeader title="Earlier" />
          <div className="space-y-3 px-4">
            {past.map((d) => (
              <DriveCard key={d.id} d={d} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Organise a drive, usually at a reported problem (/drives/new?incident=<id>). */
export function NewDriveScreen() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const incidentId = params.get("incident");
  const incident = useIncident(incidentId);
  const me = useMe();
  const pos = usePosition();
  const isGuest = me.data?.is_guest ?? true;

  const tomorrow = new Date(Date.now() + 86400_000);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(localDate(tomorrow));
  const [time, setTime] = useState("09:00");
  const [hours, setHours] = useState("2");
  const [max, setMax] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const place = incident.data ? problemTitle(incident.data.title, incident.data.category) : null;
  const defaultTitle = place ? `Clean-up: ${place}` : "Neighbourhood clean-up";

  // Look up the drive count to show social proof on the button (cheap, cached).
  const existing = useQuery({
    queryKey: ["drives", "incident", incidentId],
    queryFn: () => api.drives.list({ incident_id: incidentId! }),
    enabled: !!incidentId,
  });

  const m = useMutation({
    mutationFn: () => {
      const starts = new Date(`${date}T${time}`);
      return api.drives.create({
        title: (title.trim() || defaultTitle).slice(0, 120),
        description: description.trim() || undefined,
        starts_at: starts.toISOString(),
        duration_min: Math.round(Number(hours) * 60),
        max_volunteers: max ? Number(max) : undefined,
        ...(incidentId ? { incident_id: incidentId } : { lat: pos.lat, lon: pos.lon }),
      });
    },
    onSuccess: (d) => {
      haptic.success();
      qc.invalidateQueries({ queryKey: ["drives"] });
      if (d.incident) qc.invalidateQueries({ queryKey: ["incident", d.incident.id] });
      toast({ title: "Clean-up drive created", body: "People living nearby will get a message so they can join.", tone: "ok" });
      navigate("/drives", { replace: true });
    },
    onError: (e) => {
      haptic.error();
      setError(errorMessage(e));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const starts = new Date(`${date}T${time}`);
    if (Number.isNaN(starts.getTime()) || starts.getTime() < Date.now()) return setError("Pick a date and time in the future.");
    m.mutate();
  };

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Organise a clean-up" />
      <div className="scroll-area flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        {isGuest ? (
          <Banner tone="info" title="Create a free account first" action={{ label: "Create account", onClick: () => navigate("/account") }}>
            So volunteers know who is hosting. Your reports and EcoPoints move to your new account.
          </Banner>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-[1rem] leading-6 text-ink-2">
              {place ? (
                <>
                  Where: at <span className="font-medium text-ink">{place}</span>
                  {incident.data?.location_name && <> in {incident.data.location_name}</>}.{" "}
                </>
              ) : (
                "Where: your current location. "
              )}
              People living nearby get a message and can join.
              {existing.data && existing.data.items.length > 0 && ` ${existing.data.items.length} drive${existing.data.items.length === 1 ? " is" : "s are"} already planned here.`}
            </p>
            <Field label="Name of the drive" value={title} placeholder={defaultTitle} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" type="date" value={date} min={localDate(new Date())} onChange={(e) => setDate(e.target.value)} required />
              <Field label="Start time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[0.9063rem] font-medium text-ink-2">How long</span>
                <select
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="block h-12 w-full rounded-md border border-line-strong bg-surface px-3 text-[1.0938rem] text-ink focus:border-brand focus:outline-none"
                >
                  {["1", "1.5", "2", "3", "4"].map((h) => (
                    <option key={h} value={h}>
                      {h} hour{h === "1" ? "" : "s"}
                    </option>
                  ))}
                </select>
              </label>
              <Field label="Max. people" type="number" inputMode="numeric" min={2} max={500} placeholder="No limit" value={max} onChange={(e) => setMax(e.target.value)} />
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[0.9063rem] font-medium text-ink-2">What to bring, where to meet (optional)</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
                rows={3}
                placeholder="For example: meet at the bus stop. Bring gloves; we have bags."
                className="block w-full rounded-md border border-line-strong bg-surface px-3.5 py-3 text-[1.0938rem] leading-[1.5rem] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
              />
            </label>
            {error && <Banner tone="danger">{error}</Banner>}
            <Button type="submit" block size="lg" loading={m.isPending} disabled={!!incidentId && incident.isLoading}>
              Create clean-up drive
            </Button>
            <p className="text-[0.875rem] leading-5 text-ink-3">
              Stay safe: wear gloves, don't touch sharp, medical or chemical waste, and keep away from traffic. A clean-up doesn't close the problem — the city still checks it.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
