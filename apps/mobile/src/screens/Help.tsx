import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { PRIORITY } from "@ecopulse/core";
import { useMeta } from "../lib/queries";
import { PRIORITY_WORD } from "../lib/words";
import { ScreenHeader } from "../components/ScreenHeader";
import { HowItWorks } from "../components/HowItWorks";
import { Button, PriorityChip, cx } from "../components/ui";

function Faq({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="pressable flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-surface-2"
      >
        <span className="min-w-0 flex-1 text-[1.0625rem] font-medium leading-6 text-ink">{q}</span>
        <ChevronDown size={20} aria-hidden className={cx("shrink-0 text-ink-2 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && <div className="space-y-2 px-4 pb-4 text-[1rem] leading-6 text-ink-2">{children}</div>}
    </li>
  );
}

export function HelpScreen() {
  const precision = useMeta().data?.public_location_precision_m ?? 120;
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="Help & questions" />
      <div className="scroll-area flex-1 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        <p className="px-4 pt-4 text-[1rem] leading-6 text-ink-2">Tap a question to see the answer.</p>
        <ul className="mt-3 border-y border-line bg-surface divide-y divide-line">
          <Faq q="Is my exact location shared?">
            <p>No. Other people only see roughly where a problem is — within about {precision} metres. Only the city team that fixes it sees the exact spot.</p>
            <p>We only check your location while the app is open.</p>
          </Faq>
          <Faq q="What happens after I report?">
            <p>We check what kind of problem it is. If other people reported the same thing, we join the reports together.</p>
            <p>Neighbours confirm it, the city puts it in order of urgency, and a team is sent. We send you a message at each step, and when it's fixed.</p>
          </Faq>
          <Faq q="What do the colours mean?">
            <p>Colours show how urgent a problem is. Each one also has its own shape and word, so you don't need to tell colours apart.</p>
            <ul className="space-y-1.5 pt-1">
              {(Object.keys(PRIORITY) as (keyof typeof PRIORITY)[]).map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <PriorityChip priority={p} /> <span>{PRIORITY_WORD[p].hint}</span>
                </li>
              ))}
            </ul>
            <p>Green means fixed. For areas, green means good and red means poor.</p>
          </Faq>
          <Faq q="Why do I need to confirm problems?">
            <p>When people nearby say “yes, I see it too”, the city knows the problem is real and not a mistake. Confirmed problems get fixed sooner.</p>
            <p>After a fix, your answer tells the city whether the problem is really gone.</p>
          </Faq>
          <Faq q="What are EcoPoints?">
            <p>EcoPoints are a thank-you for helping. You get 5 points for each report and 2 for each time you confirm a problem.</p>
            <p>They show how much you've helped your area. They can't be exchanged for money.</p>
          </Faq>
          <Faq q="Is my photo safe?">
            <p>Before your photo is sent, we remove hidden details such as where it was taken and which phone took it.</p>
            <p>Photos are shown with the problem, but your name never is. You can also hide your name when you report.</p>
          </Faq>
          <Faq q="What does “Sample data” mean?">
            <p>Some information in this version of the app is made up to show how it works. It is always marked “Sample data”.</p>
          </Faq>
          <Faq q="How do I make the text bigger?">
            <p>Go to Profile and choose Text size → Large or Extra large.</p>
          </Faq>
        </ul>
        <div className="px-4 pt-6">
          <Button variant="secondary" block onClick={() => navigate("/profile/how")}>
            See how EcoPulse works
          </Button>
          <Button variant="ghost" block className="mt-1" onClick={() => navigate("/profile/privacy")}>
            Read more about your privacy
          </Button>
        </div>
      </div>
    </div>
  );
}

export function HowItWorksScreen() {
  const navigate = useNavigate();
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader title="How EcoPulse works" />
      <div className="scroll-area flex-1 px-5 pt-5 pb-4">
        <p className="mb-5 text-[1.0625rem] leading-[1.625rem] text-ink-2">EcoPulse helps you tell the city about problems near you — and see them get fixed.</p>
        <HowItWorks />
      </div>
      <div className="shrink-0 border-t border-line px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        <Button block size="lg" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
          Got it
        </Button>
      </div>
    </div>
  );
}
