import {
  Axe,
  Bone,
  CircleDot,
  CloudRain,
  Construction,
  Cpu,
  Droplets,
  Flame,
  HardHat,
  Pipette,
  Recycle,
  Trash2,
  TreeDeciduous,
  Trees,
  Truck,
  Volume2,
  Waves,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { CATEGORY_ICON, DOMAIN, type Domain } from "@ecopulse/core";

/** Explicit map of the lucide names used by @ecopulse/core (keeps the bundle small). */
const ICONS: Record<string, LucideIcon> = {
  "trash-2": Trash2,
  truck: Truck,
  recycle: Recycle,
  cpu: Cpu,
  bone: Bone,
  wind: Wind,
  flame: Flame,
  "hard-hat": HardHat,
  droplets: Droplets,
  pipette: Pipette,
  "volume-2": Volume2,
  "tree-deciduous": TreeDeciduous,
  axe: Axe,
  waves: Waves,
  "cloud-rain": CloudRain,
  construction: Construction,
  "circle-dot": CircleDot,
  trees: Trees,
};

export function iconFor(category?: string | null, domain?: Domain | null): LucideIcon {
  const name = (category && CATEGORY_ICON[category]) || (domain && DOMAIN[domain]?.icon) || "circle-dot";
  return ICONS[name] ?? CircleDot;
}

export function CategoryIcon({ category, domain, size = 20, className }: { category?: string | null; domain?: Domain | null; size?: number; className?: string }) {
  const Icon = iconFor(category, domain);
  return <Icon size={size} strokeWidth={1.9} className={className} aria-hidden />;
}

/** Square badge tinted with the domain colour. */
export function CategoryBadge({ category, domain, size = 40 }: { category?: string | null; domain?: Domain | null; size?: number }) {
  const color = DOMAIN[domain ?? "other"]?.color ?? DOMAIN.other.color;
  return (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-md"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 13%, var(--surface))`, color }}
    >
      <CategoryIcon category={category} domain={domain} size={Math.round(size * 0.5)} />
    </span>
  );
}
