import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { Navigation } from "@/components/Navigation";
import { appLinkHref } from "@/lib/config";
import { AFTER_TRIAL_SOLO, TRIAL_DAYS } from "@/lib/marketing/pricing-copy";
import { CTASection } from "./CTASection";
import { FAQAccordion } from "./FAQAccordion";
import { MarketingHero } from "./MarketingHero";
import { mk } from "./mk";
import { RelatedLinks } from "./RelatedLinks";

type FAQItem = { question: string; answer: ReactNode };
type RelatedLink = { href: string; title: string; description: string };

/**
 * Fælles ramme for SEO-sider: venstrestillet hero, sidens eget indhold,
 * spørgsmål og svar, relaterede sider og en afslutnings-CTA. Alt på
 * brand-tokens og altid lyst (docs/BRAND.md).
 */
export function SEOPageLayout({
  badge,
  title,
  subtitle,
  jsonLd,
  faqItems,
  relatedLinks,
  relatedTitle,
  relatedSubtitle,
  showHeroCta = true,
  ctaTitle,
  ctaSubtitle,
  children,
}: {
  badge?: ReactNode;
  title: ReactNode;
  subtitle?: string;
  jsonLd?: object | object[];
  faqItems?: FAQItem[];
  relatedLinks?: RelatedLink[];
  relatedTitle?: string;
  relatedSubtitle?: string;
  showHeroCta?: boolean;
  ctaTitle?: string;
  ctaSubtitle?: string;
  children: ReactNode;
}) {
  const lds = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  return (
    <div className={mk.page}>
      {lds.map((ld) => (
        <script
          key={JSON.stringify(ld).slice(0, 80)}
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: statisk JSON-LD
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
        />
      ))}

      <Navigation />

      <MarketingHero badge={badge} title={title} subtitle={subtitle}>
        {showHeroCta && (
          <>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={appLinkHref("/register")}
                className={`plausible-event-name=CTA+Click ${mk.btnPrimary}`}
              >
                Prøv gratis i {TRIAL_DAYS} dage
              </Link>
              <Link href="/pricing" className={mk.btnSecondary}>
                Se priser
              </Link>
            </div>
            <p className={`${mk.fine} mt-4 max-w-xl`}>{AFTER_TRIAL_SOLO}</p>
          </>
        )}
      </MarketingHero>

      {children}

      {faqItems && faqItems.length > 0 && (
        <section className={`${mk.section} bg-tt-flade`}>
          <div
            className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16 [&>*]:min-w-0`}
          >
            <h2 className={mk.h2}>Spørgsmål og svar</h2>
            <FAQAccordion items={faqItems} />
          </div>
        </section>
      )}

      {relatedLinks && relatedLinks.length > 0 && (
        <section className={mk.section}>
          <div className={mk.wrap}>
            <RelatedLinks
              title={relatedTitle}
              subtitle={relatedSubtitle}
              links={relatedLinks}
            />
          </div>
        </section>
      )}

      <CTASection title={ctaTitle} subtitle={ctaSubtitle} />

      <Footer />
    </div>
  );
}
