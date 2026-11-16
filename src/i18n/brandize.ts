import { type BrandId, getBrandId, getHostBrandId } from "@/lib/brand-id";

/**
 * Oversættelseskatalogerne er skrevet med navnet "TimeTrack", hvor teksten omtaler produktet.
 * En TimeWren-installation (standard) skal vise "TimeWren". Skiftet sker her, når kataloget
 * bliver brugt, så der kun er én kilde til teksterne. "TimeTrack Cloud" er navnet på den
 * hostede tjeneste og bevares. Brandet vælges med NEXT_PUBLIC_BRAND (se lib/brand-id.ts),
 * eller af hosten, når multibrand er slået til (src/i18n/request.ts og currentBrandId).
 */
const PATTERN = /TimeTrack(?! Cloud)/g;
const cache = new WeakMap<object, unknown>();

function replaceDeep(value: unknown): unknown {
  if (typeof value === "string") return value.replace(PATTERN, "TimeWren");
  if (Array.isArray(value)) return value.map(replaceDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceDeep(v)]),
    );
  }
  return value;
}

let resolver: (() => BrandId | undefined) | null = null;

/** Serveren registrerer her kaldets brand (AsyncLocalStorage i tRPC), som sproget i sync-text. */
export function registerBrandResolver(fn: () => BrandId | undefined): void {
  resolver = fn;
}

/** Kaldets brand på serveren (tRPC på en TimeWren-host); ellers undefined. */
export function ambientBrandId(): BrandId | undefined {
  return resolver?.();
}

/**
 * Brandet for tekster uden udtrykkeligt brand: kaldets (server), hostens
 * (browseren, fra /runtime-config.js), ellers build-brandet. På timetrack-hosts
 * og uden multibrand er det altid build-brandet.
 */
export function currentBrandId(): BrandId {
  return ambientBrandId() ?? getHostBrandId() ?? getBrandId();
}

export function brandize<T>(
  messages: T,
  brandId: BrandId = currentBrandId(),
): T {
  if (brandId === "timetrack") return messages;
  if (messages && typeof messages === "object") {
    const hit = cache.get(messages as object);
    if (hit) return hit as T;
    const out = replaceDeep(messages) as T;
    cache.set(messages as object, out);
    return out;
  }
  return messages;
}
