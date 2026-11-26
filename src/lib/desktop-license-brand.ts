import {
  type BrandKey,
  DEFAULT_BRAND_KEY,
  isMultibrandEnabled,
  resolveBrandByHost,
} from "@/lib/brands/registry";

/**
 * Hvilket brand en desktop-licens tilhører. Licensen bærer sit brand i
 * nøglens præfiks (TT- for TimeTrack, TW- for TimeWren), så skemaet er
 * uændret: ingen migration, og alle eksisterende TT-nøgler er TimeTrack.
 *
 * Aktivering og verificering kalder licensen kun på brandets egen host, så en
 * TimeTrack-licens ikke kan aktiveres i TimeWren og omvendt (de deler ikke
 * licenser). Ren fil uden db, så reglerne kan testes uden database.
 */
const KEY_PREFIX: Record<BrandKey, string> = {
  timetrack: "TT",
  timewren: "TW",
};

export function licenseKeyPrefix(brand: BrandKey): string {
  return KEY_PREFIX[brand];
}

/** Nøglens brand; alt uden TW-præfiks er TimeTrack (også ældre nøgler). */
export function brandFromLicenseKey(
  licenseKey: string | null | undefined,
): BrandKey {
  return licenseKey?.startsWith(`${KEY_PREFIX.timewren}-`)
    ? "timewren"
    : DEFAULT_BRAND_KEY;
}

/**
 * Brandet for en desktop-forespørgsel ud fra Host-headeren. Kun
 * MULTIBRAND_ENABLED styrer det (ikke TIMEWREN_APP_ENABLED): licensruterne
 * ligger uden for middleware og skal virke, også mens TimeWren-appen er
 * lukket og kun marketingsitet er åbent. Uden flaget er alt TimeTrack, så
 * en TW-licens afvises (fejl lukket) i stedet for at blive accepteret.
 */
export function desktopBrandForHost(host: string | null | undefined): BrandKey {
  if (!isMultibrandEnabled()) return DEFAULT_BRAND_KEY;
  return resolveBrandByHost(host).key;
}

/** Må licensen bruges på denne host? */
export function licenseMatchesHost(
  licenseKey: string,
  host: string | null | undefined,
): boolean {
  return brandFromLicenseKey(licenseKey) === desktopBrandForHost(host);
}
