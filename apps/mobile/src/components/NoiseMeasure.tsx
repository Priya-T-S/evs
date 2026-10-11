import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, X } from "lucide-react";
import { noiseBand } from "@ecopulse/core";
import { noiseWord } from "../lib/words";
import { NoiseMeter, NOISE_DURATION_MS, type NoiseResult } from "../lib/noise";
import { haptic } from "../lib/haptics";
import { Banner, Button, IconButton } from "./ui";

const MIN_DB = 30;
const MAX_DB = 110;

/** Optional 5-second sound-level measurement for noise reports (processed on the device). */
export function NoiseMeasure({ value, onChange }: { value: NoiseResult | null; onChange: (r: NoiseResult | null) => void }) {
  const [state, setState] = useState<"idle" | "measuring" | "error">("idle");
  const [live, setLive] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const meter = useRef<NoiseMeter | null>(null);

  useEffect(() => () => meter.current?.cancel(), []);

  async function start() {
    if (!NoiseMeter.supported()) {
      setState("error");
      setError("This phone or browser can't use the microphone.");
      return;
    }
    haptic.tap();
    setState("measuring");
    setError(null);
    setLive(null);
    setProgress(0);
    const m = new NoiseMeter();
    meter.current = m;
    try {
      const r = await m.measure((db, p) => {
        setLive(db);
        setProgress(p);
      });
      haptic.success();
      onChange(r);
      setState("idle");
    } catch (e) {
      if ((e as Error).message === "cancelled") return setState("idle");
      haptic.error();
      setState("error");
      setError((e as Error).name === "NotAllowedError" ? "The microphone is turned off for this app. You can still send your report without measuring." : "We couldn't measure. You can still send your report without it.");
    }
  }

  const shown = state === "measuring" ? live : value?.avg ?? null;
  const band = shown != null ? noiseBand(shown) : null;
  const pct = shown == null ? 0 : Math.max(0, Math.min(1, (shown - MIN_DB) / (MAX_DB - MIN_DB))) * 100;

  return (
    <div className="rounded-md border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[1.0625rem] font-medium text-ink">Measure how loud it is</p>
          <p className="mt-0.5 text-[0.9375rem] leading-[1.375rem] text-ink-2">Optional. Takes 5 seconds. Nothing is recorded — your phone only works out how loud it is and sends that number.</p>
        </div>
        {value && state === "idle" && <IconButton label="Remove measurement" icon={X} size={40} onClick={() => onChange(null)} />}
      </div>

      {(state === "measuring" || value) && (
        <div className="mt-3" aria-live="polite">
          <div className="flex items-baseline gap-2">
            <span className="num text-[2.25rem] font-medium leading-10 text-ink">{shown != null ? Math.round(shown) : "–"}</span>
            <span className="text-[0.9688rem] text-ink-2">decibels</span>
            {band && (
              <span className="ml-1 inline-flex items-center gap-1.5 text-[0.9375rem] font-medium text-ink-2">
                <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: band.color }} aria-hidden />
                {noiseWord(shown!)}
              </span>
            )}
            <span className="ml-auto text-[0.8438rem] text-ink-2">roughly</span>
          </div>
          <div className="relative mt-2 h-2 rounded-full bg-surface-3 overflow-hidden" aria-hidden>
            <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${pct}%`, background: band?.color ?? "var(--ink-3)" }} />
          </div>
          <div className="num mt-1 flex justify-between text-[0.7813rem] text-ink-3" aria-hidden>
            <span>{MIN_DB}</span>
            <span>55</span>
            <span>75</span>
            <span>{MAX_DB}</span>
          </div>
          {state === "measuring" ? (
            <div className="mt-2.5">
              <div className="h-1 rounded-full bg-surface-3">
                <div className="h-full rounded-full bg-brand" style={{ width: `${progress * 100}%` }} />
              </div>
              <p className="mt-1.5 text-[0.875rem] text-ink-3">
                Listening… <span className="num">{Math.max(0, Math.ceil(((1 - progress) * NOISE_DURATION_MS) / 1000))}</span> seconds left. Point your phone towards the noise.
              </p>
            </div>
          ) : (
            value && (
              <p className="mt-2 text-[0.9063rem] text-ink-2">
                On average <span className="num">{value.avg.toFixed(0)}</span> decibels, loudest <span className="num">{value.peak.toFixed(0)}</span>. A normal talk is about 60.
              </p>
            )
          )}
        </div>
      )}

      {error && <Banner tone="warn" className="mt-3">{error}</Banner>}

      {state !== "measuring" && (
        <Button variant="secondary" block className="mt-3" icon={value ? RotateCcw : Mic} onClick={start}>
          {value ? "Measure again" : "Measure noise (5 seconds)"}
        </Button>
      )}
      {state === "measuring" && (
        <Button
          variant="ghost"
          block
          className="mt-2"
          onClick={() => {
            meter.current?.cancel();
            setState("idle");
          }}
        >
          Cancel
        </Button>
      )}
    </div>
  );
}
