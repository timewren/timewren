import "./docs.css";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Bricolage_Grotesque } from "next/font/google";
import { notFound } from "next/navigation";
import {
  DOCS_LOCALES,
  DOCS_SEARCH_PATH,
  isDocsLocale,
} from "@/lib/brands/timewren-docs";
import { sitePath } from "@/lib/brands/timewren-site";
import { LOCALE_TAGS, REPO_URL } from "@/lib/brands/timewren-site-copy";
import { siteViewport } from "@/lib/brands/timewren-site-meta";
import { docsSource } from "@/lib/timewren-docs/source";
import { DOCS_UI, FUMADOCS_UI } from "@/lib/timewren-docs/ui";

/*
 * Rodlayout for TimeWren-docs (timewren.com/docs). Eget <html> ligesom
 * marketingsitet, men med Fumadocs (Tailwind + docs.css) i stedet for
 * site.css, hvis globale regler ellers ville ramme Fumadocs' komponenter.
 * Nås kun via middleware-rewrite (src/lib/brands/timewren-docs.ts).
 */

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--tw-font-display",
});

export const viewport = siteViewport;
export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS_LOCALES.map((locale) => ({ locale }));
}

function Brand({ alt }: { alt: string }) {
  return (
    <>
      {/* biome-ignore lint/performance/noImgElement: SVG-ordmærke, som next/image ikke optimerer */}
      <img
        src="/brand/timewren/wordmark.svg"
        alt={alt}
        width={124}
        height={24}
        className="dark:hidden"
      />
      {/* biome-ignore lint/performance/noImgElement: SVG-ordmærke, som next/image ikke optimerer */}
      <img
        src="/brand/timewren/wordmark-light.svg"
        alt={alt}
        width={124}
        height={24}
        className="hidden dark:block"
      />
    </>
  );
}

export default async function TimewrenDocsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isDocsLocale(locale)) notFound();
  const ui = DOCS_UI[locale];
  return (
    <html
      lang={LOCALE_TAGS[locale]}
      className={display.variable}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <RootProvider
          search={{ options: { api: DOCS_SEARCH_PATH } }}
          i18n={{
            locale,
            defaultLanguage: "en",
            hideLocale: "default-locale",
            translations: locale === "en" ? undefined : FUMADOCS_UI[locale],
            locales: DOCS_LOCALES.map((l) => ({
              locale: l,
              name: DOCS_UI[l].beta
                ? `${DOCS_UI[l].displayName} (${DOCS_UI[l].beta})`
                : DOCS_UI[l].displayName,
            })),
          }}
        >
          <DocsLayout
            tree={docsSource.getPageTree(locale)}
            nav={{
              title: <Brand alt={`TimeWren ${ui.docs}`} />,
              url: sitePath("/", locale),
            }}
            githubUrl={REPO_URL}
            links={[{ text: ui.home, url: sitePath("/", locale) }]}
          >
            {children}
          </DocsLayout>
        </RootProvider>
      </body>
    </html>
  );
}
