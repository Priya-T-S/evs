import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

/** Haptics no-op gracefully where unsupported (desktop browsers). */
const safe = (fn: () => Promise<unknown>) => {
  try {
    fn().catch(() => undefined);
  } catch {
    /* unsupported */
  }
};

export const haptic = {
  tap: () => safe(() => Haptics.impact({ style: ImpactStyle.Light })),
  select: () => safe(() => Haptics.selectionChanged()),
  medium: () => safe(() => Haptics.impact({ style: ImpactStyle.Medium })),
  success: () => safe(() => Haptics.notification({ type: NotificationType.Success })),
  warning: () => safe(() => Haptics.notification({ type: NotificationType.Warning })),
  error: () => safe(() => Haptics.notification({ type: NotificationType.Error })),
};
