import type { Metadata } from "next";
import {
  DOCS_DEFAULT_LOCALE,
  DOCS_LOCALES,
  type DocsLocale,
  docsMarkdownPath,
  docsPath,
} from "@/lib/brands/timewren-docs";
import { LOCALE_TAGS } from "@/lib/brands/timewren-site-copy";
import { siteBaseUrl } from "@/lib/brands/timewren-site-meta";
import { isTranslated } from "./content";
import { DOCS_UI } from "./ui";

/**
 * Metadata for en docs-side: canonical, hreflang mellem de sprog, siden er
 * oversat til (+ x-default = en), Markdown-alternativet og permanent
 * index/follow. En side uden oversættelse viser den engelske tekst og peger
 * kanonisk på den.
 */
export function docsPageMetadata({
  locale,
  slugs,
  title,
  description,
}: {
  locale: DocsLocale;
  slugs: string[];
  title: string;
  description?: string;
}): Metadata {
  const base = siteBaseUrl();
  const translated = DOCS_LOCALES.filter((l) => isTranslated(l, slugs));
  const languages: Record<string, string> = {};
  for (const l of translated) languages[l] = `${base}${docsPath(slugs, l)}`;
  languages["x-default"] = `${base}${docsPath(slugs, DOCS_DEFAULT_LOCALE)}`;
  const canonicalLocale = translated.includes(locale)
    ? locale
    : DOCS_DEFAULT_LOCALE;
  const url = `${base}${docsPath(slugs, canonicalLocale)}`;
  const fullTitle = `${title} | ${DOCS_UI[locale].metaTitleSuffix}`;
  return {
    metadataBase: new URL(base),
    title: fullTitle,
    description,
    applicationName: "TimeWren",
    alternates: {
      canonical: url,
      languages,
      types: {
        "text/markdown": `${base}${docsMarkdownPath(slugs, locale)}`,
      },
    },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      siteName: "TimeWren",
      title: fullTitle,
      description,
      url,
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
    icons: {
      icon: [
        { url: "/brand/timewren/favicon.svg", type: "image/svg+xml" },
        { url: "/brand/timewren/favicon-32.png", sizes: "32x32" },
      ],
      apple: "/brand/timewren/apple-touch-icon.png",
    },
  };
}
