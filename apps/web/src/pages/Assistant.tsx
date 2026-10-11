import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Database, RotateCcw } from "lucide-react";
import { humanize, type AssistantAnswer } from "@ecopulse/core";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/query";
import { TopBar } from "@/components/layout/AppShell";
import { Button, IconButton, Textarea } from "@/components/ui";

const STARTERS = [
  "Why is BTM Layout's score low?",
  "Where are the worst waste hotspots?",
  "What changed this month?",
  "Which areas need more green cover?",
  "What interventions are recommended?",
  "What's the flood outlook?",
];

type Msg = { role: "user"; content: string } | { role: "assistant"; content: string; meta: AssistantAnswer } | { role: "error"; content: string };

/** Render plain-text answers: paragraphs, "•"/"-" bullets, and PROVENANCE words emphasised. */
function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length} className="my-1.5 space-y-1 pl-4">
          {list.map((l, i) => (
            <li key={i} className="list-disc marker:text-ink-3">
              {emph(l)}
            </li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^[•\-*]\s+/.test(line)) list.push(line.replace(/^[•\-*]\s+/, ""));
    else {
      flush();
      if (line)
        blocks.push(
          <p key={blocks.length} className="my-1">
            {emph(line)}
          </p>,
        );
    }
  }
  flush();
  return <>{blocks}</>;
}

function emph(s: string): ReactNode {
  const parts = s.split(/\b(OBSERVED|EXTERNAL|MODEL|RECOMMENDATION|FORECAST)\b/);
  const color: Record<string, string> = { OBSERVED: "var(--prov-observed)", EXTERNAL: "var(--prov-external)", MODEL: "var(--prov-model)", RECOMMENDATION: "var(--prov-recommendation)", FORECAST: "var(--prov-model)" };
  return parts.map((p, i) =>
    color[p] ? (
      <span key={i} className="text-[12px] font-semibold tracking-wide" style={{ color: color[p] }}>
        {p}
      </span>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const ask = useMutation({
    mutationFn: (q: string) => {
      const history = msgs.filter((m): m is Exclude<Msg, { role: "error" }> => m.role !== "error").slice(-8).map((m) => ({ role: m.role, content: m.content }));
      return api.assistant.ask(q, history);
    },
    onSuccess: (r) => setMsgs((m) => [...m, { role: "assistant", content: r.answer, meta: r }]),
    onError: (e) => setMsgs((m) => [...m, { role: "error", content: errorMessage(e) }]),
  });

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, ask.isPending]);

  const send = (q: string) => {
    const t = q.trim();
    if (!t || ask.isPending) return;
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setInput("");
    ask.mutate(t);
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  return (
    <>
      <TopBar title="Assistant" />
      <main id="main" className="flex min-h-0 flex-1 flex-col bg-bg">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] px-6 py-6">
            {msgs.length === 0 ? (
              <div className="pt-6">
                <h1 className="text-[18px] font-semibold">Ask about the city’s environment</h1>
                <p className="mt-1 max-w-[560px] text-[14px] text-ink-2">
                  Answers are built only from EcoPulse data — reports, scores, hotspots, forecasts and recommendations. Each answer shows which data it queried. If the data doesn’t cover a question, the assistant says so.
                </p>
                <div className="mt-6 grid grid-cols-2 gap-2">
                  {STARTERS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="rounded-md border border-line bg-surface px-3.5 py-2.5 text-left text-[14px] text-ink-2 hover:border-line-strong hover:text-ink">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="space-y-5" aria-live="polite">
                {msgs.map((m, i) => (
                  <li key={i}>
                    {m.role === "user" ? (
                      <div className="flex justify-end">
                        <p className="max-w-[80%] rounded-md bg-surface-3 px-3.5 py-2 text-[14px]">{m.content}</p>
                      </div>
                    ) : m.role === "error" ? (
                      <p role="alert" className="text-[14px] text-[color:var(--danger-ink)]">
                        Couldn’t get an answer: {m.content}
                      </p>
                    ) : (
                      <div data-answer className="text-[14px] leading-relaxed text-ink">
                        <RichText text={m.content} />
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-3">
                          {m.meta.tool_calls.length > 0 ? (
                            <>
                              <span>Queried</span>
                              {m.meta.tool_calls.map((t, j) => (
                                <span
                                  key={j}
                                  title={JSON.stringify(t.args)}
                                  className="inline-flex items-center gap-1 rounded-[4px] border border-line-strong px-1.5 py-[1px] text-ink-2"
                                >
                                  <Database className="size-2.5" aria-hidden />
                                  {humanize(t.tool)}
                                  {Object.values(t.args).filter((v) => typeof v === "string" || typeof v === "number").length > 0 && (
                                    <span className="text-ink-3">· {Object.values(t.args).filter((v) => typeof v === "string" || typeof v === "number").join(", ")}</span>
                                  )}
                                </span>
                              ))}
                            </>
                          ) : (
                            <span>No data tools were queried</span>
                          )}
                          <span className="ml-1">
                            · via <span className="tabular-nums">{m.meta.provider}</span>
                          </span>
                          {!m.meta.grounded && <span className="text-[color:var(--warn-ink)]">· not grounded in EcoPulse data</span>}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
                {ask.isPending && (
                  <li className="flex items-center gap-2 text-[14px] text-ink-3" aria-busy="true">
                    <span className="size-1.5 rounded-full bg-brand live-dot" aria-hidden /> Querying EcoPulse data…
                  </li>
                )}
              </ol>
            )}
            <div ref={end} />
          </div>
        </div>
        <div className="border-t border-line bg-surface">
          <form onSubmit={onSubmit} className="mx-auto flex max-w-[760px] items-end gap-2 px-6 py-3">
            <label htmlFor="ask" className="sr-only">
              Ask a question
            </label>
            <Textarea
              id="ask"
              ref={box}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Ask about scores, hotspots, trends, floods, recommendations…"
              style={{ minHeight: 38, height: 38 }}
              className="max-h-[140px] resize-none py-2"
              maxLength={500}
            />
            {msgs.length > 0 && (
              <IconButton label="Start a new conversation" onClick={() => setMsgs([])}>
                <RotateCcw className="size-4" />
              </IconButton>
            )}
            <Button type="submit" variant="primary" disabled={!input.trim()} loading={ask.isPending} icon={<ArrowUp className="size-3.5" />} className="h-9">
              Ask
            </Button>
          </form>
        </div>
      </main>
    </>
  );
}
