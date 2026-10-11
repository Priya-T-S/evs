const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" }) : null;

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
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "–";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString("en-IN");
}

export function formatPct(v: number | null | undefined, digits = 0): string {
  if (v == null) return "–";
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatTrend(pct: number | null | undefined): string {
  if (pct == null) return "–";
  const r = Math.round(pct);
  if (r >= 400) return "+400%+";
  return `${r > 0 ? "+" : ""}${r}%`;
}

export function formatDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371008.8;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
