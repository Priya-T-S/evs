/**
 * Friendlier versions of the shared formatters: "3 hours ago" instead of "3 hr. ago",
 * "2 km" instead of "2.0 km".
 */
const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "long" }) : null;

export function timeAgo(iso: string | Date | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2592000],
    ["year", 31536000],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let div = 60;
  for (const [u, d] of units) if (abs >= d) [unit, div] = [u, d];
  return rtf ? rtf.format(Math.round(s / div), unit) : `${Math.round(abs / div)} ${unit}s ago`;
}

export function formatDistance(m: number | null | undefined): string {
  if (m == null) return "";
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 && Math.abs(km - Math.round(km)) > 0.05 ? km.toFixed(1) : Math.round(km)} km`;
}
