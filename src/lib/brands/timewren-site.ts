/**
 * TimeWrens marketingsite (timewren.com) i multibrand-appen. Ren og uden
 * afhængigheder, så middleware (edge), sider og tests deler samme regler.
 *
 * Siderne ligger internt under /timewren-site/<locale>/… (rutegruppen
 * src/app/(timewren)) og nås kun via middleware-rewrite fra en TimeWren-
 * marketinghost. Direkte kald af /timewren-site giver 404 på alle hosts.
 *
 * URL'er udadtil: engelsk uden præfiks (/, /pricing), øvrige sprog med
 * (/da, /da/pricing). Marketing-URL'er vælger ALDRIG sprog ud fra cookie
 * eller Accept-Language: samme URL skal altid give samme side (SEO).
 */

import type { BrandHostConfig, Locale } from "./registry";
import { type DocsRoute, routeDocs } from "./timewren-docs";

/** Intern stipræfiks for rutegruppen; må ikke kunne nås udefra. */
export const SITE_PREFIX = "/timewren-site";

/** Sidernes stier uden sprogpræfiks. */
export const SITE_PAGES = [
  "/",
  "/pricing",
  "/desktop",
  "/download",
  "/self-hosting",
  "/privacy",
  "/terms",
  "/delete-account",
] as const;
export type SitePage = (typeof SITE_PAGES)[number];

/** Sprog på marketingsitet. Engelsk er standard (x-default). */
export const SITE_LOCALES: readonly Locale[] = ["en", "da", "de", "es"];
export const SITE_DEFAULT_LOCALE: Locale = "en";
/** Sprog, der vises som "beta" i sprogvælgeren (oversættelser ikke gennemlæst). */
export const BETA_LOCALES: readonly Locale[] = [];

/** Juridiske sider. De findes kun på LEGAL_LOCALES. */
export const LEGAL_PAGES: readonly SitePage[] = ["/privacy", "/terms"];
/** Sprog med juridiske tekster; de øvrige falder tilbage til engelsk. */
export const LEGAL_LOCALES: readonly Locale[] = ["en", "da", "de", "es"];

/** Sprog, som en side findes på. */
export function pageLocales(page: SitePage): readonly Locale[] {
  return LEGAL_PAGES.includes(page) ? LEGAL_LOCALES : SITE_LOCALES;
}

/** Sproget, en side vises på: sidens eget, ellers engelsk. */
export function pageLocale(page: SitePage, locale: Locale): Locale {
  return pageLocales(page).includes(locale) ? locale : SITE_DEFAULT_LOCALE;
}

export function isSiteLocale(l: string): l is Locale {
  return (SITE_LOCALES as readonly string[]).includes(l);
}

export function isSiteInternalPath(pathname: string): boolean {
  return pathname === SITE_PREFIX || pathname.startsWith(`${SITE_PREFIX}/`);
}

/** Marketing vises på brandets primære host og dens www-variant, ikke app.-hosten. */
export function isMarketingHost(cfg: BrandHostConfig, host: string): boolean {
  const primary = cfg.hosts[0];
  return host === primary || host === `www.${primary}`;
}

/**
 * Marketinghostens offentlige sider er indekserbare som standard. Kun
 * TIMEWREN_INDEXABLE=0 (fx staging) slår det fra. Appen og Markdown-
 * repræsentationerne er noindex uanset.
 */
export function isTimewrenIndexable(): boolean {
  return process.env.TIMEWREN_INDEXABLE !== "0";
}

/**
 * Eksplicit til: appen (login, signup, dashboard) på TimeWren-hosts kræver
 * TIMEWREN_APP_ENABLED=1. Indtil auth er host-bevidst, svarer kun
 * marketingsitet; alle andre stier giver 404.
 */
export function isBrandAppEnabled(): boolean {
  return process.env.TIMEWREN_APP_ENABLED === "1";
}

/** Offentlig sti for en side på et sprog: ("/pricing", "da") → "/da/pricing". */
export function sitePath(page: SitePage, locale: Locale): string {
  if (locale === SITE_DEFAULT_LOCALE) return page;
  return page === "/" ? `/${locale}` : `/${locale}${page}`;
}

export type SiteRoute =
  /** Omskriv til den interne side. */
  | { action: "page"; to: string; locale: Locale; page: SitePage }
  /** Kanonisk form (fx /en/pricing → /pricing). */
  | { action: "redirect"; to: string }
  | { action: "robots" }
  | { action: "sitemap" }
  | { action: "install.sh" }
  /** Dokumentationen (src/lib/brands/timewren-docs.ts). */
  | Exclude<DocsRoute, { action: "redirect" }>
  /** Ikke en marketingsti: appens egen logik tager over. */
  | { action: "none" };

/**
 * Hvad sker der med en sti på en TimeWren-host? Kun marketinghosten har
 * siderne; app.-hosten får `none` (appen som i dag) undtagen robots.txt.
 */
export function routeSite(
  cfg: BrandHostConfig,
  host: string,
  pathname: string,
  /** Accept-headeren: docs-sider kan forhandles til Markdown. */
  accept?: string | null,
): SiteRoute {
  if (pathname === "/robots.txt") return { action: "robots" };
  if (!isMarketingHost(cfg, host)) return { action: "none" };
  if (pathname === "/sitemap.xml") return { action: "sitemap" };
  if (pathname === "/install.sh") return { action: "install.sh" };
  const docs = routeDocs(pathname, accept);
  if (docs) return docs;

  const m = pathname.match(/^\/([a-z]{2})(\/.*)?$/);
  let locale: Locale = SITE_DEFAULT_LOCALE;
  let rest = pathname;
  if (m && (SITE_LOCALES as string[]).includes(m[1])) {
    locale = m[1] as Locale;
    rest = m[2] || "/";
  }
  // Afsluttende skråstreg er ikke en egen side.
  if (rest.length > 1 && rest.endsWith("/")) rest = rest.slice(0, -1);
  if (!(SITE_PAGES as readonly string[]).includes(rest)) {
    return { action: "none" };
  }
  const page = rest as SitePage;
  // Brug sidens tilgængelige sprog.
  locale = pageLocale(page, locale);
  const canonical = sitePath(page, locale);
  if (canonical !== pathname) return { action: "redirect", to: canonical };
  return {
    action: "page",
    to:
      page === "/"
        ? `${SITE_PREFIX}/${locale}`
        : `${SITE_PREFIX}/${locale}${page}`,
    locale,
    page,
  };
}
