import type { Metadata, Viewport } from "next";
import { smartAppBanner } from "@/lib/app-stores";
import { getBrandConfigsSafe, type Locale } from "./registry";
import {
  DOCS_DEFAULT_LOCALE,
  type DocsLocale,
  docsPath,
} from "./timewren-docs";
import {
  pageLocales,
  SITE_DEFAULT_LOCALE,
  type SitePage,
  sitePath,
} from "./timewren-site";
import { getSiteMessages, LOCALE_TAGS } from "./timewren-site-copy";

/** https://<primær TimeWren-host> (fra BRANDS_CONFIG, ellers pladsholderen). */
export function siteBaseUrl(): string {
  return `https://${getBrandConfigsSafe().timewren.hosts[0]}`;
}

/**
 * Opret-konto-knappen på prissiden: /register på den primære host, hvor appen
 * kører sammen med marketing (ingen app.-host). Betaling sker som i dag i
 * appen; der findes endnu ingen EUR/USD-fakturering.
 */
export function cloudSignupUrl(): string {
  return `${siteBaseUrl()}/register`;
}

const META_KEY: Record<
  SitePage,
  keyof ReturnType<typeof getSiteMessages>["meta"]
> = {
  "/": "home",
  "/pricing": "pricing",
  "/desktop": "desktop",
  "/download": "download",
  "/self-hosting": "selfHosting",
  "/privacy": "privacy",
  "/terms": "terms",
  "/delete-account": "deleteAccount",
};

/**
 * Metadata pr. side og sprog: canonical, hreflang (+ x-default = en),
 * OG-billede fra brandkittet og permanent index/follow.
 */
export function siteMetadata(page: SitePage, locale: Locale): Metadata {
  const base = siteBaseUrl();
  const m = getSiteMessages(locale).meta[META_KEY[page]];
  const languages: Record<string, string> = {};
  for (const l of pageLocales(page)) {
    languages[l] = `${base}${sitePath(page, l)}`;
  }
  languages["x-default"] = `${base}${sitePath(page, SITE_DEFAULT_LOCALE)}`;
  const url = `${base}${sitePath(page, locale)}`;
  return {
    metadataBase: new URL(base),
    title: m.title,
    description: m.description,
    applicationName: "TimeWren",
    // Safari on iPhone/iPad offers the TimeWren app at the top of every page.
    itunes: smartAppBanner("timewren"),
    alternates: { canonical: url, languages },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: "TimeWren",
      title: m.title,
      description: m.description,
      url,
      // og:locale vil have sprog_OMRÅDE; engelsk har intet område i LOCALE_TAGS.
      locale: locale === "en" ? "en_US" : LOCALE_TAGS[locale].replace("-", "_"),
      images: [
        {
          url: "/brand/timewren/og-image.png",
          width: 1200,
          height: 630,
          alt: "TimeWren",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: m.title,
      description: m.description,
      images: ["/brand/timewren/og-image.png"],
    },
    icons: {
      icon: [
        { url: "/brand/timewren/favicon.svg", type: "image/svg+xml" },
        { url: "/brand/timewren/favicon-32.png", sizes: "32x32" },
      ],
      apple: "/brand/timewren/apple-touch-icon.png",
    },
  };
}

export const siteViewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#1C2119" },
  ],
};

/** En docs-side i sitemap'en og de sprog, den findes oversat på. */
export interface SitemapDocsEntry {
  slugs: string[];
  locales: readonly DocsLocale[];
}

/**
 * sitemap.xml for marketinghosten, med hreflang-alternativer pr. side.
 * `docs` er docs-siderne (src/lib/timewren-docs/content.ts læser dem fra
 * disk; dette modul holdes fri af fs).
 */
export function siteSitemapXml(
  base: string = siteBaseUrl(),
  docs: readonly SitemapDocsEntry[] = [],
): string {
  const pages: SitePage[] = [
    "/",
    "/pricing",
    "/desktop",
    "/download",
    "/self-hosting",
    "/privacy",
    "/terms",
  ];
  const urls: string[] = [];
  for (const page of pages) {
    const locales = pageLocales(page);
    const alts = locales
      .map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${l}" href="${base}${sitePath(page, l)}"/>`,
      )
      .concat(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${base}${sitePath(page, SITE_DEFAULT_LOCALE)}"/>`,
      )
      .join("\n");
    for (const l of locales) {
      urls.push(
        `  <url>\n    <loc>${base}${sitePath(page, l)}</loc>\n${alts}\n  </url>`,
      );
    }
  }
  for (const { slugs, locales } of docs) {
    if (!locales.length) continue;
    const alts = locales
      .map(
        (l) =>
          `    <xhtml:link rel="alternate" hreflang="${l}" href="${base}${docsPath(slugs, l)}"/>`,
      )
      .concat(
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${base}${docsPath(slugs, DOCS_DEFAULT_LOCALE)}"/>`,
      )
      .join("\n");
    for (const l of locales) {
      urls.push(
        `  <url>\n    <loc>${base}${docsPath(slugs, l)}</loc>\n${alts}\n  </url>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * robots.txt pr. TimeWren-host. Crawling er altid tilladt; kun
 * marketinghosten peger på et sitemap.
 */
export function siteRobotsTxt(isMarketing: boolean): string {
  const lines = ["User-agent: *", "Allow: /"];
  if (isMarketing) {
    lines.push("", `Sitemap: ${siteBaseUrl()}/sitemap.xml`);
  }
  return `${lines.join("\n")}\n`;
}
