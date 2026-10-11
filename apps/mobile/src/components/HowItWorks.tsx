import { Bell, Camera, Users, Wrench } from "lucide-react";
import { cx } from "./ui";

const STEPS = [
  { icon: Camera, title: "You report", body: "Take a photo of a problem and say where it is. It takes about a minute." },
  { icon: Users, title: "Neighbours confirm", body: "People nearby say “yes, I see it too”, so the city knows it's real." },
  { icon: Wrench, title: "The city team fixes it", body: "The most urgent problems are sent to the right team first." },
  { icon: Bell, title: "You're told when it's done", body: "We send you a message when it's fixed, and you can check the fix." },
];

/** The four-step explanation used in the intro and in Profile → How EcoPulse works. */
export function HowItWorks({ className }: { className?: string }) {
  return (
    <ol className={cx("relative", className)} aria-label="How EcoPulse works">
      {STEPS.map((s, i) => (
        <li key={s.title} className="relative flex gap-3.5 pb-5 last:pb-0">
          {i < STEPS.length - 1 && <span aria-hidden className="absolute left-[1.25rem] top-11 bottom-1 w-px bg-line-strong" />}
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
            <s.icon size={19} aria-hidden />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className="text-[1.0625rem] font-semibold leading-6 text-ink">
              <span className="sr-only">Step {i + 1}: </span>
              {s.title}
            </p>
            <p className="mt-0.5 text-[0.9375rem] leading-[1.375rem] text-ink-2">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
