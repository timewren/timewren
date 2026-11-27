import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageActions } from "@/components/timewren-docs/PageActions";
import { Screenshot } from "@/components/timewren-docs/Screenshot";
import {
  DOCS_LOCALES,
  type DocsLocale,
  docsMarkdownPath,
  isDocsLocale,
} from "@/lib/brands/timewren-docs";
import { siteBaseUrl } from "@/lib/brands/timewren-site-meta";
import { docsPageMetadata } from "@/lib/timewren-docs/meta";
import { docsSource } from "@/lib/timewren-docs/source";
import {
  chatGptUrl,
  claudeUrl,
  DOCS_UI,
  docsPrompt,
} from "@/lib/timewren-docs/ui";

// Statisk pr. sprog og side; fornyes, så host fra miljøet slår igennem.
export const revalidate = 300;
export const dynamicParams = false;

type ScreenshotProps = { name: string; alt: string };

/** <Screenshot> pr. sprog, defineret én gang på modulniveau (ikke pr. render). */
function ScreenshotEn(p: ScreenshotProps) {
  return <Screenshot {...p} locale="en" />;
}
function ScreenshotDa(p: ScreenshotProps) {
  return <Screenshot {...p} locale="da" />;
}
function ScreenshotDe(p: ScreenshotProps) {
  return <Screenshot {...p} locale="de" />;
}
function ScreenshotEs(p: ScreenshotProps) {
  return <Screenshot {...p} locale="es" />;
}
const SCREENSHOTS: Record<DocsLocale, typeof ScreenshotEn> = {
  en: ScreenshotEn,
  da: ScreenshotDa,
  de: ScreenshotDe,
  es: ScreenshotEs,
};

type Params = { params: Promise<{ locale: string; slug?: string[] }> };

async function resolve({ params }: Params) {
  const { locale, slug = [] } = await params;
  if (!isDocsLocale(locale)) notFound();
  const page = docsSource.getPage(slug, locale);
  if (!page) notFound();
  return { locale, slug, page };
}

export function generateStaticParams() {
  return DOCS_LOCALES.flatMap((locale) =>
    docsSource.getPages(locale).map((page) => ({ locale, slug: page.slugs })),
  );
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const { locale, slug, page } = await resolve(props);
  return docsPageMetadata({
    locale,
    slugs: slug,
    title: page.data.title,
    description: page.data.description,
  });
}

export default async function TimewrenDocsPage(props: Params) {
  const { locale, slug, page } = await resolve(props);
  const ui = DOCS_UI[locale as DocsLocale];
  const markdownUrl = `${siteBaseUrl()}${docsMarkdownPath(slug, locale)}`;
  const prompt = docsPrompt(locale, markdownUrl);
  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">
        {page.data.description}
      </DocsDescription>
      <PageActions
        markdownUrl={docsMarkdownPath(slug, locale)}
        chatGptUrl={chatGptUrl(prompt)}
        claudeUrl={claudeUrl(prompt)}
        labels={ui}
      />
      <DocsBody>
        <MDX
          components={{
            ...defaultMdxComponents,
            a: createRelativeLink(docsSource, page),
            Screenshot: SCREENSHOTS[locale],
          }}
        />
      </DocsBody>
    </DocsPage>
  );
}
