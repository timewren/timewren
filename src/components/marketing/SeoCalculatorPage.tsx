import type { Metadata } from "next";
import Link from "next/link";
import { appLinkHref } from "@/lib/config";
import type { seoTools } from "@/lib/marketing/seo-tools";
import { mk } from "./mk";
import { SEOPageLayout } from "./SEOPageLayout";
import { SeoCalculator } from "./SeoCalculator";
import { ToolUsageTracker } from "./ToolUsageTracker";

type Tool = (typeof seoTools)[keyof typeof seoTools];

export function seoCalculatorMetadata(tool: Tool): Metadata {
  return {
    title: tool.metaTitle,
    description: tool.description,
    alternates: { canonical: `/${tool.slug}` },
    openGraph: {
      title: tool.metaTitle,
      description: tool.description,
      url: `/${tool.slug}`,
      type: "website",
    },
  };
}

export function SeoCalculatorPage({ tool }: { tool: Tool }) {
  return (
    <SEOPageLayout
      title={tool.title}
      subtitle={tool.description}
      showHeroCta={false}
      jsonLd={[
        {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: tool.title,
          url: `/${tool.slug}`,
          description: tool.description,
          inLanguage: "da",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          offers: { "@type": "Offer", price: 0, priceCurrency: "DKK" },
        },
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: tool.faq.map(({ question, answer }) => ({
            "@type": "Question",
            name: question,
            acceptedAnswer: { "@type": "Answer", text: answer },
          })),
        },
      ]}
      faqItems={tool.faq}
      relatedLinks={[
        tool.related,
        {
          href: "/vaerktoejer",
          title: "Alle gratis værktøjer",
          description: "Find flere beregnere og skabeloner fra TimeTrack.",
        },
      ]}
      ctaTitle="Gem dine timer med en timer"
      ctaSubtitle="Start og stop timeren i TimeTrack, så gemmes tiden på den kunde eller opgave, du vælger."
    >
      <div className={mk.wrap}>
        <ToolUsageTracker tool={tool.slug}>
          <SeoCalculator
            calculation={tool.calculation}
            fields={tool.fields}
            results={tool.results}
          />
        </ToolUsageTracker>
        <p className={`${mk.fine} mt-4`}>
          Registrerer du de samme timer hver uge?{" "}
          <Link href={appLinkHref("/register")} className={mk.link}>
            Gem dine timer i TimeTrack
          </Link>
          .
        </p>
      </div>

      <section className={`${mk.wrap} py-12 sm:py-16`}>
        <h2 className={mk.h2}>Sådan regner du det ud</h2>
        <p className={`${mk.body} mt-4 max-w-[65ch]`}>{tool.example}</p>
        {"source" in tool && (
          <p className="mt-4">
            <a className={mk.link} href={tool.source.href}>
              {tool.source.label}
            </a>
          </p>
        )}
      </section>
    </SEOPageLayout>
  );
}
