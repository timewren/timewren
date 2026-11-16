/**
 * TimeWrens dokumentation (timewren.com/docs) i multibrand-appen. Ren og uden
 * afhængigheder, så middleware (edge), sider og tests deler samme regler.
 *
 * Offentlige stier (kun på marketinghosten, se routeSite):
 *   /docs, /docs/install/quick         engelsk (uden præfiks)
 *   /da/docs, /de/docs/…, /es/docs/…   øvrige sprog
 *   <sti>.md                           siden som ren Markdown
 *   /llms.txt, /llms-full.txt          indeks og hele den engelske dokumentation
 *   /docs-search                       Fumadocs' søge-API
 *
 * Internt ligger de under /timewren-site/docs|docs-md|llms|llms-full|
 * docs-search, som kun nås via middleware-rewrite.
 */

import type { Locale } from "./registry";

/** Sprog med oversat dokumentation. Øvrige sprog omdirigeres til engelsk. */
export const DOCS_LOCALES = [
  "en",
  "da",
  "de",
  "es",
] as const satisfies readonly Locale[];
export type DocsLocale = (typeof DOCS_LOCALES)[number];
export const DOCS_DEFAULT_LOCALE: DocsLocale = "en";

/** Interne præfikser (under SITE_PREFIX, så de ikke kan nås direkte). */
export const DOCS_INTERNAL = "/timewren-site/docs";
export const DOCS_MD_INTERNAL = "/timewren-site/docs-md";

/** Offentlig URL til søge-API'et (RootProvider i docs-layoutet bruger den). */
export const DOCS_SEARCH_PATH = "/docs-search";

export function isDocsLocale(l: string): l is DocsLocale {
  return (DOCS_LOCALES as readonly string[]).includes(l);
}

/** Slug-segmenter: små bogstaver, tal og bindestreg (som filnavnene). */
const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

/** Offentlig sti til en docs-side: ([], "da") → "/da/docs"; (["api","rest"], "en") → "/docs/api/rest". */
export function docsPath(slugs: readonly string[], locale: DocsLocale): string {
  const base = locale === DOCS_DEFAULT_LOCALE ? "/docs" : `/${locale}/docs`;
  return slugs.length ? `${base}/${slugs.join("/")}` : base;
}

/** Markdown-varianten af en side: "/docs" → "/docs.md". */
export function docsMarkdownPath(
  slugs: readonly string[],
  locale: DocsLocale,
): string {
  return `${docsPath(slugs, locale)}.md`;
}

/**
 * Foretrækker klienten Markdown? Kun når Accept nævner text/markdown med
 * højere (eller samme) vægt end text/html, så browsere altid får HTML.
 */
export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  let md = -1;
  let html = -1;
  for (const part of accept.split(",")) {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const q = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
    const weight = Number.isFinite(q) ? q : 0;
    if (type === "text/markdown" || type === "text/x-markdown") {
      md = Math.max(md, weight);
    } else if (type === "text/html") {
      html = Math.max(html, weight);
    }
  }
  return md > 0 && md >= html;
}

export type DocsRoute =
  /** HTML-siden (intern sti under DOCS_INTERNAL). */
  | { action: "docs"; to: string; locale: DocsLocale }
  /** Markdown-varianten (intern sti under DOCS_MD_INTERNAL). */
  | { action: "docs-md"; to: string; locale: DocsLocale }
  /** Kanonisk form (fx /en/docs → /docs, /docs/ → /docs). */
  | { action: "redirect"; to: string }
  | { action: "llms" }
  | { action: "llms-full" }
  | { action: "docs-search" };

/**
 * Hvad sker der med en sti på TimeWrens marketinghost? null = ikke en
 * docs-sti. `accept` er Accept-headeren (Markdown-forhandling).
 */
export function routeDocs(
  pathname: string,
  accept?: string | null,
): DocsRoute | null {
  if (pathname === "/llms.txt") return { action: "llms" };
  if (pathname === "/llms-full.txt") return { action: "llms-full" };
  if (pathname === DOCS_SEARCH_PATH) return { action: "docs-search" };

  // Valgfrit sprogpræfiks, derefter /docs, /docs.md eller /docs/….
  const m = pathname.match(/^(?:\/([a-z]{2}))?(\/docs(?:\.md|\/.*)?)$/);
  if (!m) return null;
  // Sprog uden oversættelse (fx /fr/docs) falder tilbage til engelsk: den
  // kanoniske form nedenfor omdirigerer dem til /docs/….
  const locale: DocsLocale =
    m[1] && isDocsLocale(m[1]) ? m[1] : DOCS_DEFAULT_LOCALE;

  let rest = m[2].slice("/docs".length);
  const markdown = rest.endsWith(".md");
  if (markdown) rest = rest.slice(0, -".md".length);
  const slugs = rest.split("/").filter(Boolean);
  if (!slugs.every((s) => SEGMENT.test(s))) return null;

  // Kanonisk form: uden /en, uden afsluttende skråstreg (/docs/ → /docs).
  const canonical = markdown
    ? docsMarkdownPath(slugs, locale)
    : docsPath(slugs, locale);
  if (canonical !== pathname) return { action: "redirect", to: canonical };
  const internalSlug = slugs.length ? `/${slugs.join("/")}` : "";
  if (markdown || prefersMarkdown(accept)) {
    return {
      action: "docs-md",
      to: `${DOCS_MD_INTERNAL}/${locale}${internalSlug}`,
      locale,
    };
  }
  return {
    action: "docs",
    to: `${DOCS_INTERNAL}/${locale}${internalSlug}`,
    locale,
  };
}

/**
 * Docs-stier med filendelse, som middleware-matcheren tager med ekstra
 * (llms*.txt og *.md). På alle andre hosts end TimeWrens skal de svare
 * præcis som før, altså som om middleware ikke kørte.
 */
export function isDocsFilePath(pathname: string): boolean {
  return (
    pathname === "/llms.txt" ||
    pathname === "/llms-full.txt" ||
    /^(?:\/[a-z]{2})?\/docs(?:\/[a-z0-9/-]*)?\.md$/.test(pathname)
  );
}
