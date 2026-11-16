/**
 * Multibrand-register (TimeWren Cloud). Ren og uden afhængigheder, så den kan
 * bruges i middleware (edge), servere og tests. Se docs/specs/timewren-cloud.md.
 *
 * Bag feature-flaget MULTIBRAND_ENABLED=1. Uden flaget bruges aldrig noget
 * herfra til at vælge brand: appen opfører sig præcis som før (build-brandet
 * fra NEXT_PUBLIC_BRAND, se ../brand.ts).
 *
 * Domænerne er pladsholdere (`timewren.<tld>`) indtil de er købt. De rigtige
 * værdier ligger uden for repoet i BRANDS_CONFIG (JSON i miljøet) og slås ind
 * over standarderne her; det holder cloud-konfigurationen ude af AGPL-koden.
 */

export type BrandKey = "timetrack" | "timewren";
export const BRAND_KEYS: readonly BrandKey[] = ["timetrack", "timewren"];
export const DEFAULT_BRAND_KEY: BrandKey = "timetrack";

export type Locale = "da" | "en" | "de" | "es";

export type Currency = "DKK" | "EUR" | "USD";
export const CURRENCIES: readonly Currency[] = ["EUR", "USD", "DKK"];

export interface BrandHostConfig {
  key: BrandKey;
  /** Hostnavne (uden port) der giver dette brand. Første er det primære. */
  hosts: string[];
  /** Sprog brandet understøtter. Første er standard. */
  locales: Locale[];
  defaultLocale: Locale;
  /** ISO 4217. Prisvisning; Stripe-priser pr. valuta er et forslag i spec'en. */
  currency: Currency;
  /**
   * Alias-domæner, der 308-redirecter til `https://<hosts[0]>` + samme sti og
   * query (kun med flaget). Pladsholdere her; de rigtige ligger i BRANDS_CONFIG.
   */
  aliasHosts: string[];
  /** Afsender i mails. */
  mailFrom: string;
  supportEmail: string;
  /** Primær brandfarve (lys). Bruges til theme-color og --tt-gran-override. */
  colors: { primary: string; primaryDark: string; primaryLight: string };
  /** Analytics-script (Plausible CE) pr. brand; tom = ingen analyse. */
  plausibleScriptUrl?: string;
}

const DEFAULTS: Record<BrandKey, BrandHostConfig> = {
  timetrack: {
    key: "timetrack",
    hosts: ["timetrack.dk", "www.timetrack.dk", "app.timetrack.dk"],
    locales: ["da"],
    defaultLocale: "da",
    currency: "DKK",
    aliasHosts: [],
    mailFrom: "noreply@timetrack.dk",
    supportEmail: "support@timetrack.dk",
    colors: {
      primary: "#1E5B47",
      primaryDark: "#164536",
      primaryLight: "#E2EDE8",
    },
  },
  timewren: {
    key: "timewren",
    // PLADSHOLDER: ret via BRANDS_CONFIG når domænerne er valgt.
    hosts: ["timewren.com", "www.timewren.com", "app.timewren.com"],
    locales: ["en", "da", "de", "es"],
    defaultLocale: "en",
    currency: "EUR",
    // PLADSHOLDER: ret via BRANDS_CONFIG (fx også "timewren.dk").
    aliasHosts: ["timewren.org", "timewren.app", "timewren.io", "timewren.eu"],
    mailFrom: "TimeWren <noreply@timewren.com>",
    supportEmail: "support@timewren.com",
    // Brandkittet (public/brand/timewren/README.md): Thicket, en mørkere
    // Thicket til hover og Lichen som lys flade.
    colors: {
      primary: "#3F5A3A",
      primaryDark: "#2F442B",
      primaryLight: "#E8EDE3",
    },
  },
};

export function isMultibrandEnabled(): boolean {
  return process.env.MULTIBRAND_ENABLED === "1";
}

type Override = Partial<Omit<BrandHostConfig, "key" | "colors">> & {
  colors?: Partial<BrandHostConfig["colors"]>;
};

/** Slår BRANDS_CONFIG (JSON: { timewren: {...} }) ind over standarderne. */
export function getBrandConfigs(
  raw: string | undefined = process.env.BRANDS_CONFIG,
): Record<BrandKey, BrandHostConfig> {
  const out = {
    timetrack: { ...DEFAULTS.timetrack },
    timewren: { ...DEFAULTS.timewren },
  } as Record<BrandKey, BrandHostConfig>;
  if (!raw) return out;
  let parsed: Record<string, Override>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Fejl lukket: en ødelagt konfiguration må ikke give et tilfældigt brand.
    throw new Error("BRANDS_CONFIG er ikke gyldig JSON");
  }
  for (const key of BRAND_KEYS) {
    const o = parsed[key];
    if (!o) continue;
    for (const c of Object.values(o.colors ?? {})) {
      // Farverne ender i en <style>-blok: kun hex.
      if (!/^#[0-9a-fA-F]{6}$/.test(String(c))) {
        throw new Error(`BRANDS_CONFIG: ugyldig farve for ${key}`);
      }
    }
    const merged: BrandHostConfig = {
      ...out[key],
      ...o,
      key,
      colors: { ...out[key].colors, ...o.colors },
    };
    // Fejl lukket ved indlæsning, ikke først ved runtime ("https://undefined").
    if (
      !Array.isArray(merged.hosts) ||
      merged.hosts.length === 0 ||
      merged.hosts.some((h) => typeof h !== "string" || !h.trim())
    ) {
      throw new Error(`BRANDS_CONFIG: hosts mangler for ${key}`);
    }
    merged.hosts = merged.hosts.map((h) => normalizeHost(h));
    if (
      !Array.isArray(merged.aliasHosts) ||
      merged.aliasHosts.some((h) => typeof h !== "string" || !h.trim())
    ) {
      throw new Error(`BRANDS_CONFIG: ugyldige aliasHosts for ${key}`);
    }
    merged.aliasHosts = merged.aliasHosts.map((h) => normalizeHost(h));
    if (o.aliasHosts === undefined) {
      // Standard-pladsholderne viger for en host, der er sat eksplicit.
      merged.aliasHosts = merged.aliasHosts.filter(
        (h) => !merged.hosts.includes(h),
      );
    }
    if (
      !Array.isArray(merged.locales) ||
      merged.locales.length === 0 ||
      !merged.locales.every((l) => LOCALES.includes(l))
    ) {
      throw new Error(`BRANDS_CONFIG: ugyldige locales for ${key}`);
    }
    if (!merged.locales.includes(merged.defaultLocale)) {
      throw new Error(`BRANDS_CONFIG: defaultLocale uden for locales (${key})`);
    }
    out[key] = merged;
  }
  // Et alias, der også er en brand-host, ville redirecte i ring.
  const allHosts = new Set(BRAND_KEYS.flatMap((k) => out[k].hosts));
  for (const key of BRAND_KEYS) {
    if (out[key].aliasHosts.some((h) => allHosts.has(h))) {
      throw new Error(`BRANDS_CONFIG: aliasHosts overlapper hosts (${key})`);
    }
  }
  return out;
}

const LOCALES: readonly string[] = ["da", "en", "de", "es"];

let memo: { raw: string | undefined; cfg: Record<BrandKey, BrandHostConfig> };
let warned = false;

/**
 * Som getBrandConfigs, men parser kun én gang pr. proces og fejler aldrig:
 * ved en ugyldig BRANDS_CONFIG bruges standarderne (og fejlen logges én gang),
 * så timetrack-hosts fortsat virker. Brug denne i request-stier (middleware,
 * layout); getBrandConfigs kaster og bruges til validering og mails.
 */
export function getBrandConfigsSafe(): Record<BrandKey, BrandHostConfig> {
  const raw = process.env.BRANDS_CONFIG;
  if (memo && memo.raw === raw) return memo.cfg;
  let cfg: Record<BrandKey, BrandHostConfig>;
  try {
    cfg = getBrandConfigs(raw);
  } catch (error) {
    if (!warned) {
      warned = true;
      console.error("BRANDS_CONFIG ignoreret:", (error as Error).message);
    }
    cfg = getBrandConfigs(""); // "" (ikke undefined) = kun standarderne
  }
  memo = { raw, cfg };
  return cfg;
}

export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

/**
 * Brandet for et hostnavn. Ukendt host giver standardbrandet (timetrack), så
 * previews, localhost og health checks aldrig får et tilfældigt brand.
 */
export function resolveBrandByHost(
  host: string | null | undefined,
  configs: Record<BrandKey, BrandHostConfig> = getBrandConfigsSafe(),
): BrandHostConfig {
  const h = normalizeHost(host);
  for (const key of BRAND_KEYS) {
    if (configs[key].hosts.includes(h)) return configs[key];
  }
  return configs[DEFAULT_BRAND_KEY];
}

/**
 * Brandet, hvis hosten er et alias-domæne (fx timewren.org); ellers null.
 * Middleware svarer så med 308 til `https://<hosts[0]>` + samme sti og query.
 */
export function resolveAliasHost(
  host: string | null | undefined,
  configs: Record<BrandKey, BrandHostConfig> = getBrandConfigsSafe(),
): BrandHostConfig | null {
  const h = normalizeHost(host);
  if (!h) return null;
  for (const key of BRAND_KEYS) {
    if (configs[key].aliasHosts.includes(h)) return configs[key];
  }
  // www.<alias> redirecter også, medmindre www-hosten selv er en brand-host
  // (så ville den redirecte væk fra sig selv).
  if (h.startsWith("www.")) {
    const bare = h.slice(4);
    if (BRAND_KEYS.some((k) => configs[k].hosts.includes(h))) return null;
    for (const key of BRAND_KEYS) {
      if (configs[key].aliasHosts.includes(bare)) return configs[key];
    }
  }
  return null;
}

/** Sprogvalg: sti-præfiks > cookie > Accept-Language > brandets standard. */
export function pickLocale(
  cfg: BrandHostConfig,
  opts: { cookie?: string | null; acceptLanguage?: string | null },
): Locale {
  const ok = (v: string | null | undefined): v is Locale =>
    !!v && (cfg.locales as string[]).includes(v);
  if (ok(opts.cookie)) return opts.cookie;
  const fromHeader = (opts.acceptLanguage ?? "")
    .split(",")
    .map((s) => s.split(";")[0].trim().toLowerCase().slice(0, 2))
    .find((c) => ok(c));
  return (fromHeader as Locale | undefined) ?? cfg.defaultLocale;
}

/** "/de/priser" → { locale: "de", rest: "/priser" }. Kun for brandets sprog. */
export function splitLocalePrefix(
  cfg: BrandHostConfig,
  pathname: string,
): { locale: Locale | null; rest: string } {
  const m = pathname.match(/^\/([a-z]{2})(\/.*)?$/);
  if (m && (cfg.locales as string[]).includes(m[1])) {
    return { locale: m[1] as Locale, rest: m[2] || "/" };
  }
  return { locale: null, rest: pathname };
}

export const BRAND_HEADER = "x-brand";
export const LOCALE_HEADER = "x-brand-locale";
