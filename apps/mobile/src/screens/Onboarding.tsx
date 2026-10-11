import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, LocateFixed, MapPin, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useApp } from "../lib/store";
import { useLocation } from "../lib/location";
import { useMeta } from "../lib/queries";
import { haptic } from "../lib/haptics";
import { DEFAULT_CITY } from "../lib/config";
import { AuthForm } from "../components/AuthForm";
import { HowItWorks } from "../components/HowItWorks";
import { Banner, Button, IconButton } from "../components/ui";

type Step = "intro" | "signin" | "location";

export function Onboarding() {
  const access = useApp((s) => s.access);
  const [step, setStep] = useState<Step>(access ? "location" : "intro");
  const reduced = useReducedMotion();
  return (
    <div className="h-full overflow-hidden bg-bg">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          className="h-full"
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
          transition={{ duration: reduced ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {step === "intro" && <Intro onGuest={() => setStep("location")} onSignIn={() => setStep("signin")} />}
          {step === "signin" && <SignIn onBack={() => setStep("intro")} onDone={() => setStep("location")} />}
          {step === "location" && <LocationStep />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Mark() {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="32" height="32" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" fill="var(--brand)" />
        <path d="M10 34h11l5-12 8 22 6-14 3 4h11" fill="none" stroke="var(--brand-ink)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[1.1563rem] font-semibold tracking-[-0.01em] text-ink">EcoPulse</span>
    </div>
  );
}

function Intro({ onGuest, onSignIn }: { onGuest: () => void; onSignIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUser = useApp((s) => s.setUser);
  const meta = useMeta();
  const city = meta.data?.city.name ?? DEFAULT_CITY;
  const precision = meta.data?.public_location_precision_m ?? 120;

  async function guest() {
    setBusy(true);
    setError(null);
    haptic.medium();
    try {
      const r = await api.auth.guest();
      setUser(r.user);
      onGuest();
    } catch (e) {
      haptic.error();
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="scroll-area min-h-0 flex-1 px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-4">
        <Mark />
        <h1 className="mt-8 text-[1.8125rem] font-semibold leading-9 tracking-[-0.015em] text-ink">
          See a problem? Report it.
          <br />
          We'll help get it fixed.
        </h1>
        <p className="mt-3 text-[1.0625rem] leading-[1.625rem] text-ink-2">
          Tell the city about garbage, sewage, smoke, noise or flooding near you in {city} — and see what's being done about it.
        </p>
        <h2 className="mt-7 mb-3 text-[1.0625rem] font-semibold text-ink">How it works</h2>
        <HowItWorks />
        <p className="mt-6 flex items-start gap-2.5 rounded-md border border-line bg-surface px-3.5 py-3 text-[0.9375rem] leading-[1.375rem] text-ink-2">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand" aria-hidden />
          Your exact location is never shown to the public — only roughly (within about {precision} m). It's free to use.
        </p>
      </div>
      <div className="shrink-0 space-y-2.5 border-t border-line bg-bg px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        {error && <Banner tone="danger">{error}</Banner>}
        <Button block size="lg" loading={busy} onClick={guest} className="h-16 text-[1.1875rem]">
          Continue as guest
        </Button>
        <Button block size="lg" variant="secondary" onClick={onSignIn} disabled={busy}>
          I have an account
        </Button>
        <p className="text-center text-[0.875rem] text-ink-2">No sign-up needed. You can make an account later to keep your points.</p>
      </div>
    </div>
  );
}

function SignIn({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  return (
    <div className="flex h-full flex-col pt-[env(safe-area-inset-top)]">
      <div className="flex h-14 items-center px-2">
        <IconButton label="Back" icon={ArrowLeft} onClick={onBack} />
      </div>
      <div className="scroll-area flex-1 px-6 pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <h1 className="text-[1.5625rem] font-semibold tracking-[-0.01em] text-ink">Sign in</h1>
        <p className="mt-1 mb-6 text-[1rem] text-ink-2">Sign in to see your reports, EcoPoints and messages on this device.</p>
        <AuthForm onDone={onDone} />
      </div>
    </div>
  );
}

function LocationStep() {
  const locate = useLocation((s) => s.locate);
  const status = useLocation((s) => s.status);
  const setExplained = useApp((s) => s.setLocationExplained);
  const setOnboarded = useApp((s) => s.setOnboarded);
  const meta = useMeta();
  const city = meta.data?.city.name ?? DEFAULT_CITY;
  const [failed, setFailed] = useState(false);

  async function allow() {
    haptic.tap();
    setExplained(true);
    const p = await locate({ highAccuracy: true });
    if (p) {
      haptic.success();
      setOnboarded(true);
    } else setFailed(true);
  }

  return (
    <div className="flex h-full flex-col px-6 pt-[calc(env(safe-area-inset-top)+20px)] pb-[calc(env(safe-area-inset-bottom)+20px)]">
      <Mark />
      <div className="mt-auto mb-auto">
        <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <MapPin size={26} aria-hidden />
        </span>
        <h1 className="mt-6 text-[1.6875rem] font-semibold leading-8 tracking-[-0.015em] text-ink">Can we use your location?</h1>
        <p className="mt-3 text-[1.0625rem] leading-[1.5938rem] text-ink-2">
          This lets us show problems near you, tell you how your area is doing, and put your reports in the right place on the map.
        </p>
        <ul className="mt-5 space-y-2 text-[0.9688rem] text-ink-2">
          <li className="flex gap-2.5">
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand" aria-hidden />
            Other people only see roughly where a report is (within about {meta.data?.public_location_precision_m ?? 120} m), never your exact spot.
          </li>
          <li className="flex gap-2.5">
            <ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand" aria-hidden />
            We only check your location while the app is open.
          </li>
        </ul>
        {failed && (
          <Banner tone="warn" className="mt-6" title={status === "denied" ? "Location is turned off" : "We couldn't find your location"}>
            We'll show the {city} city centre for now. You can turn location on later in your phone's settings.
          </Banner>
        )}
      </div>
      <div className="space-y-2.5">
        {failed ? (
          <Button block size="lg" onClick={() => setOnboarded(true)}>
            Continue with the city centre
          </Button>
        ) : (
          <>
            <Button block size="lg" icon={LocateFixed} loading={status === "locating"} onClick={allow}>
              Yes, use my location
            </Button>
            <Button
              block
              size="lg"
              variant="secondary"
              onClick={() => setOnboarded(true)}
            >
              Not now
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
