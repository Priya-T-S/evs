import { plainText } from "../lib/words";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff } from "lucide-react";
import { type Notification } from "@ecopulse/core";
import { timeAgo } from "../lib/format";
import { api } from "../lib/api";
import { useNotifications } from "../lib/queries";
import { useUi } from "../lib/ui";
import { useNetwork } from "../lib/network";
import { haptic } from "../lib/haptics";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyState, ErrorState, SkeletonRows, cx } from "../components/ui";

export function InboxScreen() {
  const q = useNotifications();
  const qc = useQueryClient();
  const open = useUi((s) => s.openIncident);
  const online = useNetwork((s) => s.online);
  const items = q.data?.items ?? [];

  const readOne = useMutation({
    mutationFn: (id: number) => api.notifications.read(id),
    onMutate: (id) => {
      qc.setQueryData<{ unread: number; items: Notification[] }>(["notifications"], (old) =>
        old ? { unread: Math.max(0, old.unread - (old.items.find((n) => n.id === id && !n.read) ? 1 : 0)), items: old.items.map((n) => (n.id === id ? { ...n, read: true } : n)) } : old,
      );
    },
  });
  const readAll = useMutation({
    mutationFn: api.notifications.readAll,
    onMutate: () => {
      haptic.tap();
      qc.setQueryData<{ unread: number; items: Notification[] }>(["notifications"], (old) => (old ? { unread: 0, items: old.items.map((n) => ({ ...n, read: true })) } : old));
    },
  });

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        title="Messages"
        action={
          (q.data?.unread ?? 0) > 0 ? (
            <button type="button" className="h-11 px-3 text-[0.9688rem] font-medium text-brand" onClick={() => readAll.mutate()}>
              Mark all as read
            </button>
          ) : null
        }
      />
      <div className="scroll-area flex-1 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        {q.isLoading && !q.data ? (
          <div className="pt-3">
            <SkeletonRows rows={4} />
          </div>
        ) : q.isError && !q.data ? (
          <ErrorState offline={!online} message="We couldn't load your messages." onRetry={() => q.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={BellOff} title="No messages yet" body="We'll send you news about your reports and problems near your home here." className="pt-20" />
        ) : (
          <ul className="border-b border-line bg-surface divide-y divide-line">
            {items.map((n) => {
              const incidentId = n.data?.incident_id;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.read) readOne.mutate(n.id);
                      if (incidentId) open(incidentId);
                    }}
                    className={cx("pressable flex w-full gap-3 px-4 py-3.5 text-left active:bg-surface-2", !n.read && "bg-brand-soft/40")}
                  >
                    <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand")} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={cx("text-[1.0625rem] leading-5 text-ink", !n.read && "font-medium")}>{plainText(n.title)}</span>
                        <span className="shrink-0 text-[0.8438rem] text-ink-3">{timeAgo(n.created_at)}</span>
                      </span>
                      <span className="mt-0.5 block text-[0.9375rem] leading-[1.3125rem] text-ink-2">{plainText(n.body)}</span>
                      {!n.read && <span className="sr-only">Unread</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
