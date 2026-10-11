import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { ArrowUpRight, Camera, ChevronRight, MapPin, Wind } from "lucide-react";
import { CITIZEN_APP_URL } from "@/features/help/help";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/query";
import { Button, Field, Input } from "@/components/ui";

const DEMO = [
  { email: "admin@ecopulse.dev", role: "Admin", note: "All permissions" },
  { email: "officer@ecopulse.dev", role: "Officer", note: "Solid Waste Management" },
  { email: "officer.water@ecopulse.dev", role: "Officer", note: "Lakes & Water Quality" },
  { email: "analyst@ecopulse.dev", role: "Analyst", note: "Analytics, recommendations, jobs" },
  { email: "moderator@ecopulse.dev", role: "Moderator", note: "Verify / dismiss incidents" },
];
const DEMO_PASSWORD = "ecopulse-demo";

export default function Login() {
  const { login, status } = useAuth();
  const navigate = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      const from = (loc.state as { from?: string } | null)?.from;
      navigate(from && from !== "/login" ? from : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-full items-center justify-center bg-bg px-6 py-12">
      <div className="grid w-full max-w-[880px] grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-14">
      <div className="w-full max-w-[400px]">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-sm bg-brand text-brand-ink">
            <svg viewBox="0 0 32 32" className="size-5" aria-hidden>
              <path d="M5 17h5l3-7 5 13 3-6h6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-[17px] font-semibold leading-tight">EcoPulse Command Center</h1>
            <p className="text-[14px] text-ink-3">Environmental operations · Bengaluru</p>
          </div>
        </div>
        <p className="mb-7 text-[14px] leading-relaxed text-ink-2">
          For city staff: see the environmental problems residents report, decide what to fix first, and follow each one until it’s done.
        </p>
        <h2 className="mb-3 text-[15px] font-semibold">Staff sign in</h2>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Work email" hint="The email your administrator registered for you.">
            {(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className="h-9" />}
          </Field>
          <Field label="Password">
            {(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-9" />}
          </Field>
          {error && (
            <p role="alert" className="rounded-sm border border-[color-mix(in_srgb,var(--p1)_45%,transparent)] bg-danger-soft px-3 py-2 text-[14px] text-[color:var(--danger-ink)]">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy} disabled={!email || !password} className="h-9 w-full">
            Sign in
          </Button>
        </form>

        <details className="group mt-8 border-t border-line pt-4">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink-2">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            Development demo accounts
            <span className="ml-auto rounded-[4px] border border-dashed border-line-strong px-1.5 text-[11px]">dev only</span>
          </summary>
          <p className="mt-2 text-[12.5px] text-ink-3">
            Seeded local accounts. Password for all: <code className="num text-ink-2">{DEMO_PASSWORD}</code>
          </p>
          <ul className="mt-2 divide-y divide-line">
            {DEMO.map((d) => (
              <li key={d.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(DEMO_PASSWORD);
                  }}
                  className="flex w-full items-baseline justify-between gap-3 py-1.5 text-left hover:text-ink"
                >
                  <span className="num text-[13px] text-ink-2">{d.email}</span>
                  <span className="text-[12px] text-ink-3 whitespace-nowrap">
                    {d.role} · {d.note}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <aside aria-labelledby="resident-title" className="rounded-md border border-line bg-surface p-6 lg:mt-[68px]">
        <p className="eyebrow mb-1.5">For residents</p>
        <h2 id="resident-title" className="text-[17px] font-semibold leading-snug">
          Are you a resident?
        </h2>
        <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">Report problems and see your area’s environment in the EcoPulse citizen app. No staff account needed.</p>
        <ul className="mt-4 space-y-2.5 text-[14px] text-ink-2">
          <li className="flex gap-2.5">
            <Camera className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            Report garbage, dumping, smoke, sewage, noise or flooding with a photo.
          </li>
          <li className="flex gap-2.5">
            <MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            Follow your report as the city verifies it, assigns a team and fixes it.
          </li>
          <li className="flex gap-2.5">
            <Wind className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
            Check air quality and your neighbourhood’s environment score.
          </li>
        </ul>
        <a
          href={CITIZEN_APP_URL}
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-sm border border-line-strong bg-surface-2 px-3.5 text-[14px] font-medium text-ink hover:bg-surface-3"
        >
          Open the citizen app
          <ArrowUpRight className="size-4" aria-hidden />
        </a>
      </aside>

      </div>
    </main>
  );
}
