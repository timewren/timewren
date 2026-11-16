import { defineI18n } from "fumadocs-core/i18n";
import { loader } from "fumadocs-core/source";
import { metaSchema, pageSchema } from "fumadocs-core/source/schema";
import { defineDocs } from "fumadocs-mdx/macro";
import { DOCS_DEFAULT_LOCALE, DOCS_LOCALES } from "@/lib/brands/timewren-docs";

/*
 * Fumadocs-kilden til TimeWren-docs (HTML-siderne og søgningen). Filerne
 * ligger i content/docs/<sprog>/ (parser "dir"); en side, der mangler på et
 * sprog, vises med den engelske tekst. URL'erne er de offentlige
 * (/docs/…, /da/docs/…); middleware omskriver dem til den interne rute.
 *
 * defineDocs er en makro: fumadocs-mdx (createMDX i next.config.ts)
 * kompilerer MDX-filerne ved build, så kilden kun kan importeres fra
 * Next-ruter, ikke fra Vitest. Markdown-udgaverne (llms.txt, .md) læses
 * derfor direkte fra filerne i content.ts.
 */

export const docsI18n = defineI18n({
  languages: [...DOCS_LOCALES],
  defaultLanguage: DOCS_DEFAULT_LOCALE,
  hideLocale: "default-locale",
  parser: "dir",
});

const docs = defineDocs({
  dir: "content/docs",
  docs: { schema: pageSchema },
  meta: { schema: metaSchema },
});

export const docsSource = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  i18n: docsI18n,
});
