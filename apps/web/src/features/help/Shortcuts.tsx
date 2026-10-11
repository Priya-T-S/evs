import { useEffect } from "react";
import { Dialog } from "@/components/ui";
import { isTyping, useHelp } from "./help";

const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ["/"], what: "Search for a place, neighbourhood or incident" },
  { keys: ["↑", "↓"], what: "Move up and down the priority list" },
  { keys: ["Home", "End"], what: "Jump to the first or last problem in the list" },
  { keys: ["Enter"], what: "Open the highlighted problem or search result" },
  { keys: ["Esc"], what: "Close the details panel, a dialog or a tip" },
  { keys: ["?"], what: "Show this list" },
];

function Key({ k }: { k: string }) {
  return <kbd className="num inline-flex h-6 min-w-6 items-center justify-center rounded-[4px] border border-line-strong bg-surface-2 px-1.5 text-[12.5px] text-ink shadow-[inset_0_-1px_0_var(--line-strong)]">{k}</kbd>;
}

/** "?" opens a small list of keyboard shortcuts from anywhere in the app. */
export function ShortcutsDialog() {
  const open = useHelp((s) => s.shortcuts);
  const set = useHelp((s) => s.setShortcuts);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      e.preventDefault();
      set(!useHelp.getState().shortcuts);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [set]);
  return (
    <Dialog open={open} onClose={() => set(false)} title="Keyboard shortcuts" width={460}>
      <table className="w-full text-left">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.what} className="border-b border-line last:border-0">
              <td className="w-[112px] py-2 pr-3 align-top whitespace-nowrap">
                <span className="inline-flex gap-1">
                  {s.keys.map((k) => (
                    <Key key={k} k={k} />
                  ))}
                </span>
              </td>
              <td className="py-2 text-[14px] text-ink-2">{s.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[13px] text-ink-3">Shortcuts don’t fire while you are typing in a box.</p>
    </Dialog>
  );
}
