/**
 * Approximate sound-level measurement with the phone microphone (Web Audio).
 *
 * Pipeline: getUserMedia (echo cancellation / noise suppression / AGC disabled)
 *   → high-pass 2nd-order biquads at 160 Hz and 500 Hz (Q 0.5) + low-pass at 10 kHz
 *     — a coarse approximation of the A-weighting curve, which de-emphasises low
 *     frequencies the ear is less sensitive to
 *   → AnalyserNode time-domain samples every 100 ms → RMS → dBFS = 20·log10(rms)
 *   → dB(A) ≈ dBFS + NOISE_CALIBRATION_DB.
 *
 * Calibration: phone microphones are not calibrated. The offset of +94 dB maps a full-scale
 * RMS of 0 dBFS to 94 dB SPL (the level of a standard 1 kHz acoustic calibrator), which puts a
 * quiet room (≈ −60 dBFS) near 34 dB and normal speech at 1 m (≈ −34 dBFS) near 60 dB on typical
 * phones. Readings are therefore labelled "approximate" everywhere. The average is an
 * energy average (Leq) of the 100 ms samples; the peak is the loudest 100 ms sample.
 *
 * Privacy: audio is processed in memory on the device and never recorded or uploaded —
 * only the final number is sent with the report (`noise_db`).
 */
export const NOISE_CALIBRATION_DB = 94;
export const NOISE_DURATION_MS = 5000;

export interface NoiseResult {
  avg: number;
  peak: number;
  samples: number;
}

export class NoiseMeter {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  static supported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== "undefined";
  }

  async measure(onLevel: (db: number, progress: number) => void, durationMs = NOISE_DURATION_MS): Promise<NoiseResult> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    const src = ctx.createMediaStreamSource(this.stream);
    const hp1 = new BiquadFilterNode(ctx, { type: "highpass", frequency: 160, Q: 0.5 });
    const hp2 = new BiquadFilterNode(ctx, { type: "highpass", frequency: 500, Q: 0.5 });
    const lp = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 10_000, Q: 0.7 });
    const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
    src.connect(hp1).connect(hp2).connect(lp).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const levels: number[] = [];
    const t0 = performance.now();

    return new Promise<NoiseResult>((resolve, reject) => {
      this.timer = setInterval(() => {
        if (this.stopped) {
          this.cleanup();
          reject(new Error("cancelled"));
          return;
        }
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const dbfs = 20 * Math.log10(Math.max(rms, 1e-7));
        const db = clamp(dbfs + NOISE_CALIBRATION_DB, 20, 140);
        levels.push(db);
        const progress = Math.min(1, (performance.now() - t0) / durationMs);
        onLevel(db, progress);
        if (progress >= 1) {
          this.cleanup();
          const leq = 10 * Math.log10(levels.reduce((a, l) => a + 10 ** (l / 10), 0) / levels.length);
          resolve({ avg: round1(leq), peak: round1(Math.max(...levels)), samples: levels.length });
        }
      }, 100);
    });
  }

  cancel() {
    this.stopped = true;
    this.cleanup();
  }

  private cleanup() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
