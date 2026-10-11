import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Camera, Check, CloudOff, ImagePlus, Loader2, LocateFixed, Lock, RotateCcw, ScanSearch, X } from "lucide-react";
import { ApiError, type CategoryMeta, type Classification, type ReportResult } from "@ecopulse/core";
import { api, errorMessage } from "../lib/api";
import { useMeta } from "../lib/queries";
import { useLocation, usePosition } from "../lib/location";
import { useApp } from "../lib/store";
import { useNetwork } from "../lib/network";
import { haptic } from "../lib/haptics";
import { isNative, nativePhoto, normalizePhoto } from "../lib/photo";
import { newClientId, submitReport, type SubmitOutcome } from "../lib/outbox";
import { useUi } from "../lib/ui";
import type { NoiseResult } from "../lib/noise";
import { CategoryBadge } from "../components/CategoryIcon";
import { LocationPicker } from "../components/LocationPicker";
import { NoiseMeasure } from "../components/NoiseMeasure";
import { Banner, Button, Disclosure, IconButton, PriorityChip, ProvenanceLabel, Sheet, SheetTitle, Switch, cx } from "../components/ui";
import { CATEGORY_WORD, categoryWord, confidenceWord } from "../lib/words";

type Step = "category" | "photo" | "location" | "details" | "result";
const STEPS: Step[] = ["category", "photo", "location", "details"];

/** Most commonly reported first (order of citizen report volume in Indian cities). */
const ORDER = [
  "garbage",
  "illegal_dumping",
  "sewage",
  "drainage",
  "waterlogging",
  "open_burning",
  "plastic_waste",
  "water_pollution",
  "construction_dust",
  "noise_pollution",
  "air_pollution",
  "flooding",
  "tree_loss",
  "illegal_tree_cutting",
  "dead_animals",
  "e_waste",
  "other",
];

const FALLBACK_CATEGORIES: CategoryMeta[] = ORDER.map((slug) => ({
  slug,
  label: slug.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()).replace("E waste", "E-Waste"),
  domain: "other",
  default_severity: 2,
  requires_photo: !["noise_pollution", "air_pollution", "flooding", "waterlogging", "other"].includes(slug),
}));

interface Loc {
  lat: number;
  lon: number;
  accuracy: number | null;
  source: "gps" | "fallback" | "adjusted";
}

export default function ReportFlow() {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const meta = useMeta();
  const precision = meta.data?.public_location_precision_m ?? 120;
  const categories = useMemo(() => {
    const list = meta.data?.categories ?? FALLBACK_CATEGORIES;
    return [...list].sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));
  }, [meta.data]);

  const [step, setStep] = useState<Step>("category");
  const [dir, setDir] = useState(1);
  const [category, setCategory] = useState<CategoryMeta | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<string | null>(null);
  const [ai, setAi] = useState<{ state: "idle" | "loading" | "done" | "error"; data?: Classification; dismissed?: boolean }>({ state: "idle" });
  const [loc, setLoc] = useState<Loc | null>(null);
  const [locKey, setLocKey] = useState(0);
  const [description, setDescription] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [noise, setNoise] = useState<NoiseResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const clientId = useRef(newClientId());

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  const go = (s: Step) => {
    setDir(STEPS.indexOf(s) >= STEPS.indexOf(step) ? 1 : -1);
    setStep(s);
  };
  const idx = STEPS.indexOf(step);
  const dirty = !!category && step !== "result";

  function close() {
    if (dirty && (photo || description)) return setConfirmClose(true);
    navigate(-1);
  }
  function back() {
    if (idx <= 0) return close();
    haptic.tap();
    go(STEPS[idx - 1]);
  }

  // ---- step 1
  function pickCategory(c: CategoryMeta) {
    haptic.select();
    setCategory(c);
    if (ai.data && ai.data.category !== c.slug) setAi((a) => ({ ...a, dismissed: false }));
    setTimeout(() => go("photo"), reduced ? 0 : 140);
  }

  // ---- step 2
  async function acceptPhoto(raw: Blob) {
    const blob = await normalizePhoto(raw);
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhoto(blob);
    setPhotoUrl(URL.createObjectURL(blob));
    setCapturedAt(new Date().toISOString());
    haptic.medium();
    classify(blob, category!.slug);
  }
  async function classify(blob: Blob, slug: string) {
    if (!navigator.onLine) return setAi({ state: "error" });
    setAi({ state: "loading" });
    try {
      const f = new FormData();
      f.set("category", slug);
      f.set("photo", blob, "photo.jpg");
      const data = await api.reports.classify(f);
      setAi({ state: "done", data });
    } catch {
      setAi({ state: "error" });
    }
  }

  // ---- step 3: refresh GPS when entering the location step
  const locate = useLocation((s) => s.locate);
  const pos = usePosition();
  const [locating, setLocating] = useState(false);
  async function refreshLocation() {
    setLocating(true);
    const p = await locate({ highAccuracy: true });
    setLocating(false);
    if (p) {
      setLoc({ lat: p.lat, lon: p.lon, accuracy: p.accuracy, source: "gps" });
      setLocKey((k) => k + 1);
    } else if (!loc) {
      setLoc({ lat: pos.lat, lon: pos.lon, accuracy: null, source: "fallback" });
    }
  }
  useEffect(() => {
    if (step === "location" && (!loc || loc.source === "fallback")) {
      if (!loc) setLoc({ lat: pos.lat, lon: pos.lon, accuracy: pos.accuracy, source: pos.source });
      if (useApp.getState().locationExplained || pos.source === "gps") refreshLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // ---- submit
  const qc = useQueryClient();
  async function submit() {
    if (!category || !loc) return;
    setSubmitting(true);
    setSubmitError(null);
    haptic.medium();
    try {
      const out = await submitReport({
        client_id: clientId.current,
        category: category.slug,
        category_label: category.label,
        lat: loc.lat,
        lon: loc.lon,
        accuracy_m: loc.source === "fallback" ? null : loc.accuracy,
        description,
        is_anonymous: anonymous,
        captured_at: capturedAt ?? new Date().toISOString(),
        noise_db: category.slug === "noise_pollution" && noise ? noise.avg : null,
        photo,
      });
      setOutcome(out);
      if (out.kind === "sent") {
        haptic.success();
        qc.invalidateQueries({ queryKey: ["myReports"] });
      } else haptic.warning();
      setDir(1);
      setStep("result");
    } catch (e) {
      haptic.error();
      setSubmitError(e instanceof ApiError && e.code === "photo_required" ? "Please add a photo for this kind of problem." : errorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  const canContinue =
    step === "photo" ? !!photo || !category?.requires_photo : step === "location" ? !!loc : step === "details" ? true : false;

  return (
    <div className="flex h-full flex-col bg-bg">
      {step !== "result" && (
        <header className="shrink-0 pt-safe">
          <div className="flex h-14 items-center gap-1 px-2">
            <IconButton label={idx === 0 ? "Close" : "Back"} icon={idx === 0 ? X : ArrowLeft} onClick={back} />
            <h1 className="flex-1 text-[1.0938rem] font-semibold text-ink">Report a problem</h1>
            <span className="pr-3 text-[0.9063rem] tabular-nums text-ink-3" aria-live="polite">
              Step {idx + 1} of {STEPS.length}
            </span>
          </div>
          <div className="flex gap-1 px-4 pb-2" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={idx + 1} aria-label="Report progress">
            {STEPS.map((s, i) => (
              <span key={s} className={cx("h-1 flex-1 rounded-full transition-colors duration-200", i <= idx ? "bg-brand" : "bg-surface-3")} />
            ))}
          </div>
        </header>
      )}

      <div className="relative min-h-0 flex-1">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={step}
            custom={dir}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: dir * 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: dir * -32 }}
            transition={{ duration: reduced ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute inset-0 flex flex-col"
          >
            {step === "category" && <CategoryStep categories={categories} selected={category?.slug} onPick={pickCategory} />}
            {step === "photo" && category && (
              <PhotoStep
                category={category}
                photoUrl={photoUrl}
                ai={ai}
                onPhoto={acceptPhoto}
                onRetake={() => {
                  setPhoto(null);
                  setPhotoUrl(null);
                  setAi({ state: "idle" });
                }}
                onSwitch={(slug) => {
                  const c = categories.find((x) => x.slug === slug);
                  if (c) {
                    haptic.select();
                    setCategory(c);
                    setAi((a) => ({ ...a, dismissed: true }));
                  }
                }}
                onDismiss={() => setAi((a) => ({ ...a, dismissed: true }))}
              />
            )}
            {step === "location" && (
              <LocationStep
                loc={loc}
                locKey={locKey}
                locating={locating}
                precision={precision}
                onAdjust={(p) => setLoc((l) => ({ lat: p.lat, lon: p.lon, accuracy: l?.accuracy ?? null, source: l?.source === "fallback" ? "fallback" : "adjusted" }))}
                onRelocate={refreshLocation}
              />
            )}
            {step === "details" && category && (
              <DetailsStep
                category={category}
                photoUrl={photoUrl}
                loc={loc}
                description={description}
                setDescription={setDescription}
                anonymous={anonymous}
                setAnonymous={setAnonymous}
                noise={noise}
                setNoise={setNoise}
                error={submitError}
              />
            )}
            {step === "result" && outcome && (
              <ResultStep
                outcome={outcome}
                categoryLabel={category ? categoryWord(category.slug, category.label) : ""}
                onDone={() => navigate("/", { replace: true })}
                onView={(id) => {
                  navigate("/", { replace: true });
                  setTimeout(() => useUi.getState().openIncident(id), 260);
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {step !== "category" && step !== "result" && (
        <footer className="shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          {step === "details" ? (
            <Button block size="lg" loading={submitting} onClick={submit} icon={Check} className="h-16 text-[1.1875rem]">
              Send report
            </Button>
          ) : (
            <div className="flex gap-2">
              {step === "photo" && !photo && !category?.requires_photo && (
                <Button size="lg" variant="secondary" className="h-16 flex-1 text-[1.0625rem]" onClick={() => go("location")}>
                  Skip photo
                </Button>
              )}
              <Button
                block={!(step === "photo" && !photo && !category?.requires_photo)}
                size="lg"
                className="h-16 flex-1 text-[1.1875rem]"
                disabled={!canContinue}
                onClick={() => {
                  haptic.tap();
                  go(STEPS[idx + 1]);
                }}
              >
                {step === "photo" && !photo && category?.requires_photo ? "Add a photo first" : "Next"}
              </Button>
            </div>
          )}
        </footer>
      )}

      <Sheet
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Stop this report?"
        header={<SheetTitle sub="Your photo and what you wrote will not be saved.">Stop this report?</SheetTitle>}
      >
        <div className="flex gap-2 px-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmClose(false)}>
            Keep going
          </Button>
          <Button variant="danger" className="flex-1" onClick={() => navigate(-1)}>
            Stop and delete
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function StepTitle({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-4">
      <h2 className="text-[1.4375rem] font-semibold leading-7 tracking-[-0.01em] text-ink">{title}</h2>
      {sub && <p className="mt-1 text-[0.9688rem] text-ink-2">{sub}</p>}
    </div>
  );
}

function CategoryStep({ categories, selected, onPick }: { categories: CategoryMeta[]; selected?: string; onPick: (c: CategoryMeta) => void }) {
  return (
    <div className="scroll-area flex-1 pb-[calc(16px+env(safe-area-inset-bottom))]">
      <StepTitle title="What's the problem?" sub="Pick the closest match. Not sure? Pick the nearest one — we'll check it for you." />
      <div className="grid grid-cols-2 gap-2 px-4" role="list">
        {categories.map((c) => (
          <button
            key={c.slug}
            type="button"
            role="listitem"
            aria-pressed={selected === c.slug}
            onClick={() => onPick(c)}
            className={cx(
              "pressable flex min-h-[4.5rem] items-center gap-2.5 rounded-md border px-2.5 py-2.5 text-left",
              selected === c.slug ? "border-brand bg-brand-soft" : "border-line-strong bg-surface active:bg-surface-2",
            )}
          >
            <CategoryBadge category={c.slug} domain={c.domain} size={36} />
            <span className="min-w-0">
              <span className="block text-[1rem] font-semibold leading-5 text-ink">{CATEGORY_WORD[c.slug]?.label ?? c.label}</span>
              {CATEGORY_WORD[c.slug] && <span className="mt-0.5 block text-[0.8125rem] leading-[1.0625rem] text-ink-2">{CATEGORY_WORD[c.slug].example}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PhotoStep({
  category,
  photoUrl,
  ai,
  onPhoto,
  onRetake,
  onSwitch,
  onDismiss,
}: {
  category: CategoryMeta;
  photoUrl: string | null;
  ai: { state: "idle" | "loading" | "done" | "error"; data?: Classification; dismissed?: boolean };
  onPhoto: (b: Blob) => void;
  onRetake: () => void;
  onSwitch: (slug: string) => void;
  onDismiss: () => void;
}) {
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const online = useNetwork((s) => s.online);

  async function take(source: "camera" | "gallery") {
    haptic.tap();
    if (isNative()) {
      const b = await nativePhoto(source);
      if (b) onPhoto(b);
      return;
    }
    (source === "camera" ? cameraInput : libraryInput).current?.click();
  }
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onPhoto(f);
    e.target.value = "";
  };

  const d = ai.data;
  const disagrees = d && d.category !== category.slug && !ai.dismissed;

  return (
    <div className="scroll-area flex-1 pb-4">
      <StepTitle
        title={photoUrl ? "Is the photo clear?" : "Take a photo"}
        sub={
          photoUrl
            ? "If you can see the problem in it, tap Next."
            : category.requires_photo
              ? "A photo helps the city team find and fix it."
              : "Optional, but a photo helps the city team find and fix it."
        }
      />
      <input ref={cameraInput} id="photo-camera" type="file" accept="image/*" capture="environment" className="sr-only" onChange={onFile} tabIndex={-1} aria-hidden />
      <input ref={libraryInput} id="photo-library" type="file" accept="image/*" className="sr-only" onChange={onFile} tabIndex={-1} aria-hidden />

      <div className="px-4">
        {photoUrl ? (
          <div className="relative overflow-hidden rounded-md border border-line bg-surface-3">
            <img src={photoUrl} alt="Your photo of the problem" className="aspect-[4/3] w-full object-cover" />
            <button
              type="button"
              onClick={onRetake}
              className="pressable absolute right-2 top-2 inline-flex h-10 items-center gap-1.5 rounded-md bg-black/60 px-3 text-[0.9375rem] font-medium text-white"
            >
              <RotateCcw size={15} aria-hidden /> Retake
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => take("camera")}
              className="pressable flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-line-strong bg-surface text-ink active:bg-surface-2"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-brand-ink">
                <Camera size={28} aria-hidden />
              </span>
              <span className="text-[1.1875rem] font-semibold">Take a photo</span>
              <span className="text-[0.9063rem] text-ink-3">We remove hidden details, like your location, from the photo</span>
            </button>
            <Button variant="secondary" block className="mt-2" icon={ImagePlus} onClick={() => take("gallery")}>
              Choose a photo from your phone
            </Button>
          </>
        )}

        {photoUrl && (
          <div className="mt-3 rounded-md border border-line bg-surface p-3.5" aria-live="polite">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[1rem] font-semibold text-ink">
                <ScanSearch size={16} aria-hidden /> Our quick check
              </span>
            </div>
            {ai.state === "loading" && (
              <p className="mt-2 flex items-center gap-2 text-[0.9688rem] text-ink-2">
                <Loader2 size={16} className="spin" aria-hidden /> Looking at your photo…
              </p>
            )}
            {ai.state === "error" && (
              <p className="mt-2 text-[0.9688rem] text-ink-2">{online ? "We couldn't check the photo right now." : "We can check the photo once you're online."} That's fine — you can still send your report.</p>
            )}
            {ai.state === "done" && d && (
              <>
                <p className="mt-2 text-[1.0625rem] text-ink">
                  Looks like: <span className="font-semibold">{d.label}</span> <span className="text-ink-2">({confidenceWord(d.confidence)})</span>
                </p>
                {disagrees ? (
                  <div className="mt-3 rounded-md bg-warn-soft p-3">
                    <p className="text-[0.9375rem] text-ink">
                      This looks more like <span className="font-semibold">{categoryWord(d.category, d.category_label).toLowerCase()}</span>. Do you want to change it?
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => onSwitch(d.category)}>
                        Change to {categoryWord(d.category, d.category_label).toLowerCase()}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={onDismiss}>
                        Keep {categoryWord(category.slug, category.label).toLowerCase()}
                      </Button>
                    </div>
                  </div>
                ) : (
                  d.category === category.slug && (
                    <p className="mt-2 flex items-center gap-1.5 text-[0.9063rem] text-ok">
                      <Check size={16} aria-hidden /> Matches what you picked
                    </p>
                  )
                )}
                <Disclosure className="mt-1">
                  <p>
                    A computer looks at the photo to guess the kind of problem. It is <span className="num text-ink">{Math.round(d.confidence * 100)}%</span> sure. People and city staff
                    check it too.
                  </p>
                  {d.rationale && <p>Why: {d.rationale.charAt(0).toUpperCase() + d.rationale.slice(1)}</p>}
                  <p>
                    <ProvenanceLabel kind="model" detail={`checked by ${d.provider}`} />
                  </p>
                </Disclosure>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function LocationStep({
  loc,
  locKey,
  locating,
  precision,
  onAdjust,
  onRelocate,
}: {
  loc: Loc | null;
  locKey: number;
  locating: boolean;
  precision: number;
  onAdjust: (p: { lat: number; lon: number }) => void;
  onRelocate: () => void;
}) {
  return (
    <div className="scroll-area flex-1 pb-4">
      <StepTitle title="Where is it?" sub="We've put the pin where you are. If the problem is somewhere else, drag the pin or tap the map." />
      <div className="px-4">
        <div className="relative h-[300px] overflow-hidden rounded-md border border-line bg-surface-3">
          {loc && <LocationPicker lat={loc.lat} lon={loc.lon} accuracy={loc.accuracy} onChange={onAdjust} recenterKey={locKey} />}
          <div className="absolute right-2 top-2">
            <IconButton label="Use my current location" icon={locating ? Loader2 : LocateFixed} variant="float" onClick={onRelocate} disabled={locating} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-[0.9688rem]">
          <span className="inline-flex items-center gap-2 text-ink">
            <LocateFixed size={16} className="text-ink-3" aria-hidden />
            {locating && loc?.source !== "gps" ? (
              "Finding where you are…"
            ) : loc?.source === "fallback" ? (
              "Please move the pin to the right place"
            ) : loc?.source === "adjusted" ? (
              "You moved the pin"
            ) : (
              <>Found you (accurate to about {Math.max(5, Math.round((loc?.accuracy ?? 0) / 5) * 5)} m)</>
            )}
          </span>
        </div>
        {loc?.source === "fallback" && (
          <Banner tone="warn" className="mt-3">
            We couldn't get your location. Please move the pin to where the problem is.
          </Banner>
        )}
        <div className="mt-3 flex items-start gap-2.5 rounded-md border border-line bg-surface px-3.5 py-3 text-[0.9375rem] text-ink-2">
          <Lock size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />
          <span>
            Other people only see roughly where it is (within about {precision} m). Only the city team fixing it sees the exact spot.
          </span>
        </div>
        {loc && (
          <Disclosure label="Exact position" className="mt-1">
            <p className="num">
              {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
              {loc.accuracy != null && loc.source !== "fallback" ? ` · GPS accuracy ±${Math.round(loc.accuracy)} m` : ""}
            </p>
          </Disclosure>
        )}
      </div>
    </div>
  );
}

function DetailsStep({
  category,
  photoUrl,
  loc,
  description,
  setDescription,
  anonymous,
  setAnonymous,
  noise,
  setNoise,
  error,
}: {
  category: CategoryMeta;
  photoUrl: string | null;
  loc: Loc | null;
  description: string;
  setDescription: (s: string) => void;
  anonymous: boolean;
  setAnonymous: (v: boolean) => void;
  noise: NoiseResult | null;
  setNoise: (n: NoiseResult | null) => void;
  error: string | null;
}) {
  const online = useNetwork((s) => s.online);
  return (
    <div className="scroll-area flex-1 pb-4">
      <StepTitle title="Anything to add?" sub="This is optional. A few words help the team find and fix it faster." />
      <div className="space-y-3 px-4">
        <div className="flex items-center gap-3 rounded-md border border-line bg-surface p-2.5">
          {photoUrl ? <img src={photoUrl} alt="" className="h-12 w-12 rounded-sm object-cover" /> : <CategoryBadge category={category.slug} domain={category.domain} size={48} />}
          <div className="min-w-0">
            <p className="text-[1.0625rem] font-medium text-ink">{categoryWord(category.slug, category.label)}</p>
            <p className="text-[0.875rem] text-ink-3">
              {photoUrl ? "Photo added" : "No photo"} · {loc?.source === "fallback" || loc?.source === "adjusted" ? "you placed the pin" : "place found"}
            </p>
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[0.9063rem] font-medium text-ink-2">Describe it (optional)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder={category.slug === "noise_pollution" ? "For example: loudspeakers every night after 11 pm" : "For example: the pile has been growing for a week and blocks the footpath"}
            className="block w-full rounded-md border border-line-strong bg-surface px-3.5 py-3 text-[1.0938rem] leading-[1.5rem] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none"
          />
          <span className="num mt-1 block text-right text-[0.8125rem] text-ink-3">{description.length}/1000</span>
        </label>

        {category.slug === "noise_pollution" && <NoiseMeasure value={noise} onChange={setNoise} />}

        <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[1.0625rem] font-medium text-ink">Hide my name</p>
            <p className="text-[0.875rem] leading-[1.1563rem] text-ink-3">Your name won't be shown with this report. You still get EcoPoints.</p>
          </div>
          <Switch checked={anonymous} onChange={setAnonymous} label="Hide my name" />
        </div>

        {!online && (
          <Banner tone="warn" icon={CloudOff} title="You're offline">
            We'll save your report on this phone and send it when you're back online.
          </Banner>
        )}
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    </div>
  );
}

function ResultStep({ outcome, categoryLabel, onDone, onView }: { outcome: SubmitOutcome; categoryLabel: string; onDone: () => void; onView: (incidentId: string) => void }) {
  const reduced = useReducedMotion();
  const [report, setReport] = useState<ReportResult | null>(outcome.kind === "sent" ? outcome.result : null);
  const [points, setPoints] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const qc = useQueryClient();
  const done = !!report && (report.status === "processed" || report.status === "merged") && !!report.incident;

  // Processing is asynchronous: poll the report for the AI label and the merge decision.
  useEffect(() => {
    if (outcome.kind !== "sent") return;
    let cancelled = false;
    let tries = 0;
    const id = outcome.result.id;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      tries += 1;
      try {
        const r = await api.reports.get(id);
        if (cancelled) return;
        setReport(r);
        if ((r.status === "processed" || r.status === "merged") && r.incident) {
          haptic.success();
          qc.invalidateQueries({ queryKey: ["nearby"] });
          qc.invalidateQueries({ queryKey: ["me"] });
          try {
            const pts = await api.auth.points();
            const refs = new Set([r.id, r.incident.id]);
            const earned = pts.history.filter((h) => refs.has(h.ref_id) && Date.parse(h.created_at) >= startedAt - 60_000).reduce((a, h) => a + h.delta, 0);
            if (!cancelled) setPoints(earned || 5);
            qc.setQueryData(["points"], pts);
          } catch {
            if (!cancelled) setPoints(5);
          }
          return;
        }
      } catch {
        /* keep polling */
      }
      if (tries < 14) setTimeout(tick, tries < 4 ? 1000 : 1800);
      else setTimedOut(true);
    };
    const t = setTimeout(tick, 900);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [outcome, qc]);

  if (outcome.kind === "queued") {
    return (
      <div className="scroll-area flex flex-1 flex-col px-6 pt-[calc(env(safe-area-inset-top)+48px)] pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-warn-soft text-[var(--prov-recommendation)]">
          <CloudOff size={26} aria-hidden />
        </span>
        <h2 className="mt-6 text-[1.6875rem] font-semibold leading-8 tracking-[-0.015em] text-ink">Saved on your phone</h2>
        <p className="mt-2 text-[1.0625rem] leading-[1.5938rem] text-ink-2">You're offline right now. We'll send your report by ourselves as soon as you're back online.</p>
        <p className="mt-2 text-[0.9375rem] text-ink-2">
          {categoryLabel} · we'll let you know when it's sent. You can see it under Profile → Waiting to send.
        </p>
        <div className="mt-auto pt-6">
          <Button block size="lg" onClick={onDone} className="h-16 text-[1.1875rem]">
            Done
          </Button>
        </div>
      </div>
    );
  }

  const inc = report?.incident;
  const merged = report?.status === "merged" || (inc && inc.reporter_count > 1);
  const headline = !done
    ? "We're checking your report now. This takes a few seconds."
    : merged && inc
      ? `${inc.reporter_count} people have reported this. We'll tell you when it's fixed.`
      : "Your problem is now on the map. We'll tell you when it's fixed.";
  return (
    <div className="scroll-area flex flex-1 flex-col px-6 pt-[calc(env(safe-area-inset-top)+40px)] pb-[calc(env(safe-area-inset-bottom)+20px)]">
      <motion.span
        initial={reduced ? false : { scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-ok-soft text-ok"
      >
        <Check size={28} strokeWidth={2.4} aria-hidden />
      </motion.span>
      <h2 className="mt-6 text-[1.75rem] font-semibold leading-9 tracking-[-0.015em] text-ink">Thank you!</h2>
      <p className="mt-2 text-[1.125rem] leading-[1.625rem] text-ink" aria-live="polite">
        {headline}
      </p>

      <div className="mt-6 divide-y divide-line rounded-lg border border-line bg-surface" aria-live="polite">
        <OutcomeRow
          label="What it looks like"
          pending={!report?.ai}
          value={
            report?.ai ? (
              <>
                {categoryWord(report.ai.category, report.ai.label ?? "")} <span className="text-ink-2">({confidenceWord(report.ai.confidence)})</span>
              </>
            ) : null
          }
        />
        <OutcomeRow
          label="Your report"
          pending={!inc}
          value={
            inc ? (
              <>
                {merged ? "Added to a problem other people already reported" : "A new problem on the map"}
                <span className="mt-1.5 block">
                  <PriorityChip priority={inc.priority} />
                </span>
              </>
            ) : null
          }
        />
        <OutcomeRow
          label="EcoPoints"
          pending={done && points == null}
          value={
            done && points != null ? (
              <>
                <span className="font-semibold text-ink">+{points} EcoPoints</span> for helping
                <span className="mt-0.5 block text-[0.875rem] text-ink-2">Points show how much you've helped your area.</span>
              </>
            ) : done ? null : (
              <span className="text-ink-2">Added once we've checked it</span>
            )
          }
        />
      </div>
      {timedOut && !done && <p className="mt-3 text-[0.9375rem] text-ink-2">This is taking longer than usual. We'll send you a message when it's done.</p>}
      {(inc || report?.ai) && (
        <Disclosure label="Details" className="mt-2">
          {inc && (
            <p>
              Reference number <span className="num selectable text-ink">{inc.ref}</span>
            </p>
          )}
          {report?.ai && (
            <p>
              Checked by a computer ({report.ai.provider ?? "classifier"}), <span className="num">{Math.round((report.ai.confidence ?? 0) * 100)}%</span> sure.
            </p>
          )}
          {report?.duplicate && (
            <p>
              Match with an existing report: <span className="num">{Math.round(report.duplicate.score * 100)}%</span>.
            </p>
          )}
        </Disclosure>
      )}

      <div className="mt-auto space-y-2 pt-6">
        {inc && (
          <Button block size="lg" variant="secondary" onClick={() => onView(inc.id)}>
            See the problem
          </Button>
        )}
        <Button block size="lg" onClick={onDone} className="h-16 text-[1.1875rem]">
          Done
        </Button>
      </div>
    </div>
  );
}

function OutcomeRow({ label, value, pending, aside }: { label: string; value: React.ReactNode; pending: boolean; aside?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {pending ? <Loader2 size={18} className="spin text-ink-3" aria-hidden /> : <Check size={18} className="text-ok" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] text-ink-2">{label}</p>
        <div className="mt-0.5 text-[1.0625rem] leading-6 text-ink">{pending ? <span className="text-ink-2">Working on it…</span> : value}</div>
      </div>
      {aside}
    </div>
  );
}
