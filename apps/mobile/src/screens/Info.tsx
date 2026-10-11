import type { ReactNode } from "react";
import { Camera, EyeOff, Lock, MapPin, Mic, UserX } from "lucide-react";
import { formatPct, type ProviderStatus } from "@ecopulse/core";
import { timeAgo } from "../lib/format";
import { useMeta, useSources } from "../lib/queries";
import { useNetwork } from "../lib/network";
import { NOISE_CALIBRATION_DB } from "../lib/noise";
import { ScreenHeader } from "../components/ScreenHeader";
import { DemoTag, ErrorState, ProvenanceLabel, SectionHeader, SkeletonRows, cx } from "../components/ui";

function Item({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 px-4 py-3.5">
      <Icon size={19} className="mt-0.5 shrink-0 text-brand" aria-hidden />
      <div>
        <p className="text-[1.0625rem] font-medium text-ink">{title}</p>
        <div className="mt-0.5 text-[0.9375rem] leading-[1.3125rem] text-ink-2">{children}</div>
      </div>
    </li>
  );
}

export function PrivacyScreen() {
  const precision = useMeta().data?.public_location_precision_m ?? 120;
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Your privacy" />
      <div className="scroll-area flex-1 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <SectionHeader title="What other people can see" />
        <ul className="border-y border-line bg-surface divide-y divide-line">
          <Item icon={MapPin} title={`Only roughly where it is (about ${precision} m)`}>
            Problems are shown on the map near, but not exactly at, the spot you reported. Only city staff who fix it can see the exact spot.
          </Item>
          <Item icon={Camera} title="Photos without hidden details">
            Photos can hide details such as where and when they were taken and which phone took them. We remove these on your phone before sending, and again on our side. (Technically: EXIF data is stripped.)
          </Item>
          <Item icon={UserX} title="No names">
            We never show who reported a problem — only how many people did.
          </Item>
        </ul>
        <SectionHeader title="What stays private" />
        <ul className="border-y border-line bg-surface divide-y divide-line">
          <Item icon={Mic} title="Noise is measured on your phone">
            The microphone is only used for 5 seconds after you press “Measure noise”. Nothing is recorded or sent — only the loudness number. Phone microphones are not exact, so the
            number is a rough guide. (Technically: uncalibrated microphone, A-weighting approximation, +{NOISE_CALIBRATION_DB} dB offset.)
          </Item>
          <Item icon={EyeOff} title="Hiding your name">
            If you turn on “Hide my name”, your name is not shown with the report anywhere. The report is still linked to your account so you can follow it and get points.
          </Item>
          <Item icon={Lock} title="Location only while the app is open">
            We only check your location while the app is open, to show problems near you and place your reports. Your home area (if you save one) is only used to send you messages.
          </Item>
        </ul>
      </div>
    </div>
  );
}

const KIND_WORD: Record<string, string> = { aqi: "Air quality", weather: "Weather", elevation: "Land height", geospatial: "Map data (parks, waste points)" };

const STATUS_STYLE: Record<ProviderStatus["status"], { label: string; cls: string }> = {
  live: { label: "Working", cls: "bg-ok-soft text-ok" },
  demo: { label: "Sample data", cls: "bg-warn-soft text-ink-2" },
  not_configured: { label: "Not set up", cls: "bg-surface-3 text-ink-2" },
};

export function SourcesScreen() {
  const q = useSources();
  const meta = useMeta();
  const online = useNetwork((s) => s.online);
  const s = q.data?.synthetic;
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Where our information comes from" />
      <div className="scroll-area flex-1 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <p className="px-4 pt-4 text-[0.9688rem] leading-5 text-ink-2">
          EcoPulse has no sensors of its own. Everything comes from reports by people like you, free public data (like weather and air readings), and our own calculations. Wherever it matters, the app tells you which:
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-4 pt-3">
          <ProvenanceLabel kind="observed" />
          <ProvenanceLabel kind="external" />
          <ProvenanceLabel kind="model" />
          <ProvenanceLabel kind="recommendation" />
        </div>

        <SectionHeader title="Public data we use" />
        {q.isLoading && !q.data ? (
          <SkeletonRows rows={3} />
        ) : q.isError && !q.data ? (
          <ErrorState offline={!online} onRetry={() => q.refetch()} />
        ) : (
          <ul className="border-y border-line bg-surface divide-y divide-line">
            {q.data!.providers.map((p) => (
              <li key={p.name} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[1.0625rem] font-medium text-ink">{p.source}</span>
                  <span className={cx("inline-flex h-6 items-center rounded-sm px-2 text-[0.8438rem] font-medium", STATUS_STYLE[p.status].cls)}>{STATUS_STYLE[p.status].label}</span>
                </div>
                <p className="mt-0.5 text-[0.875rem] text-ink-3">
                  {KIND_WORD[p.kind] ?? p.kind}
                  {p.last_success ? ` · updated ${timeAgo(p.last_success)}` : " · not loaded yet"}
                  {p.requires_key && !p.configured ? " · not switched on" : ""}
                </p>
                {p.last_error && <p className="mt-0.5 text-[0.875rem] text-p1">Last problem: {p.last_error}</p>}
              </li>
            ))}
          </ul>
        )}

        {s && (
          <>
            <SectionHeader title="Sample data" />
            <div className="border-y border-line bg-surface px-4 py-3.5 text-[0.9375rem] leading-[1.3125rem] text-ink-2 space-y-2">
              <p className="flex items-start gap-2">
                <DemoTag className="mt-px shrink-0" />
                <span>
                  <span className="num text-ink">{formatPct(s.incident_share)}</span> of the problems in this version of the app are sample data for demonstration. They are marked “Sample data” wherever they appear.
                </span>
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {s.neighbourhood_boundaries && <li>Neighbourhood borders are sample data (approximate).</li>}
                {s.green_zones && <li>Parks and green areas are sample data.</li>}
                {s.sensitive_sites && <li>Schools and hospitals are sample data.</li>}
                <li>How many people live in each area: {s.population}.</li>
              </ul>
            </div>
          </>
        )}

        <SectionHeader title="How we calculate things" />
        <ul className="border-y border-line bg-surface divide-y divide-line text-[0.9375rem]">
          {[
            ["What kind of problem it is", meta.data?.ai.classifier ?? "heuristic-v1", "A computer guesses from the photo and words, and says how sure it is."],
            ["Area score", "pulse-1", "Six marks for each neighbourhood. Tap “How do we know this?” on Home to see the formulas."],
            ["Problem areas", "hotspot-1", "Groups reports that are close together (within 350 m). Method: weighted DBSCAN."],
            ["Urgency", "risk-1 · grid-1", "From how serious a problem is, how many people reported it, how many live nearby and how long it has been open."],
            ["Flooding risk", "flood-1", "From the rain forecast, how low the land is, past floods and drain complaints. A guess, not something seen."],
          ].map(([name, ver, desc]) => (
            <li key={name} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[1.0625rem] text-ink">{name}</span>
                <span className="num text-[0.875rem] text-ink-3">{ver}</span>
              </div>
              <p className="mt-0.5 text-ink-3">{desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
