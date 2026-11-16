import { Check, X } from "lucide-react";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { FounderNote } from "@/components/marketing/FounderNote";
import { Navigation } from "@/components/Navigation";
import { AFTER_TRIAL_SOLO, TRIAL_DAYS } from "@/lib/marketing/pricing-copy";
import { CTASection } from "./CTASection";
import { FAQAccordion } from "./FAQAccordion";
import { MarketingHero } from "./MarketingHero";
import { mk } from "./mk";
import type { CompetitorComparisonPageProps } from "./types";

/** Ja/nej som ikon med skjult tekst til skærmlæsere; tekstværdier vises som de er. */
function Cell({ value, own }: { value: string | boolean; own: boolean }) {
  if (value === true) {
    return (
      <>
        <Check
          className={`h-5 w-5 ${own ? "text-tt-gran" : "text-tt-graa"}`}
          aria-hidden="true"
        />
        <span className="sr-only">Ja</span>
      </>
    );
  }
  if (value === false) {
    return (
      <>
        <X className="h-5 w-5 text-tt-graa" aria-hidden="true" />
        <span className="sr-only">Nej</span>
      </>
    );
  }
  return <span className="text-sm text-tt-blaek">{value}</span>;
}

type Row = { label: string; us: string | boolean; them: string | boolean };

/** Funktion i første kolonne, TimeTrack og konkurrenten i de to næste. */
function ComparisonTable({
  rows,
  competitorName,
}: {
  rows: Row[];
  competitorName: string;
}) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[30rem] text-left">
        <thead>
          <tr className="border-b border-tt-streg text-sm">
            <th scope="col" className="py-3 pr-4 font-medium text-tt-graa">
              Funktion
            </th>
            <th
              scope="col"
              className="w-44 px-4 py-3 font-semibold text-tt-gran"
            >
              TimeTrack
            </th>
            <th scope="col" className="w-44 px-4 py-3 font-medium text-tt-graa">
              {competitorName}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-tt-streg">
              <th
                scope="row"
                className="py-3 pr-4 text-[15px] font-normal text-tt-blaek"
              >
                {row.label}
              </th>
              <td className="px-4 py-3">
                <Cell value={row.us} own />
              </td>
              <td className="px-4 py-3">
                <Cell value={row.them} own={false} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const twoCol = `${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16 [&>*]:min-w-0`;

export function CompetitorComparisonPage({
  competitor,
  hero,
  quickComparison,
  features,
  pricingComparison,
  migrationSteps,
  faq,
  ctaText,
  comparedAt,
  pricingTitle,
  relatedComparisons,
}: CompetitorComparisonPageProps) {
  // Tag /register-links pr. konkurrent, så hver alternativ-side kan måles.
  const refSlug = competitor.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const registerHref = `/register?ref=${refSlug}-alt`;
  return (
    <div className={mk.page}>
      <Navigation />
      <MarketingHero title={hero.title} subtitle={hero.subtitle}>
        {comparedAt && (
          <p className={`${mk.fine} mt-4 max-w-2xl`}>{comparedAt}</p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={registerHref}
            className={`plausible-event-name=CTA+Click ${mk.btnPrimary}`}
          >
            Prøv gratis i {TRIAL_DAYS} dage
          </Link>
          <Link href="/pricing" className={mk.btnSecondary}>
            Se priser
          </Link>
        </div>
        <p className={`${mk.fine} mt-4 max-w-xl`}>{AFTER_TRIAL_SOLO}</p>
        <FounderNote className="mt-9 max-w-xl" />
      </MarketingHero>

      <section className={mk.section}>
        <div className={twoCol}>
          <h2 className={mk.h2}>TimeTrack og {competitor.name}</h2>
          <ComparisonTable
            competitorName={competitor.name}
            rows={quickComparison.map((r) => ({
              label: r.feature,
              us: r.us,
              them: r.them,
            }))}
          />
        </div>
      </section>

      <section className={`${mk.section} bg-tt-flade`}>
        <div className={twoCol}>
          <h2 className={mk.h2}>Detaljeret sammenligning</h2>
          <div className="space-y-10">
            {features.map((cat) => (
              <div key={cat.category}>
                <h3 className={`${mk.h3} mb-3`}>{cat.category}</h3>
                <div className={`${mk.card} px-5`}>
                  <ComparisonTable
                    competitorName={competitor.name}
                    rows={cat.items.map((item) => ({
                      label: item.name,
                      us: item.us,
                      them: item.them,
                    }))}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={mk.section}>
        <div className={twoCol}>
          <div>
            <h2 className={mk.h2}>{pricingTitle ?? "Hvad koster det?"}</h2>
            <p className={`${mk.body} mt-4`}>{pricingComparison.scenario}</p>
          </div>
          <div>
            <dl className="border-t border-tt-streg">
              <div className="grid gap-1 border-b border-tt-streg py-5 sm:grid-cols-[220px_1fr] sm:gap-6">
                <dt className="font-semibold text-tt-blaek">
                  {competitor.name}
                </dt>
                <dd className="text-2xl font-bold tracking-[-0.02em] text-tt-blaek">
                  {pricingComparison.themPrice}
                </dd>
              </div>
              <div className="grid gap-1 border-b border-tt-streg py-5 sm:grid-cols-[220px_1fr] sm:gap-6">
                <dt className="font-semibold text-tt-blaek">TimeTrack</dt>
                <dd className="text-2xl font-bold tracking-[-0.02em] text-tt-gran">
                  {pricingComparison.usPrice}
                </dd>
              </div>
            </dl>
            <p className={`${mk.body} mt-5`}>{pricingComparison.savings}</p>
            <p className={`${mk.fine} mt-2`}>
              TimeTracks priser er ekskl. moms.
            </p>
          </div>
        </div>
      </section>

      <section className={`${mk.section} bg-tt-flade`}>
        <div className={twoCol}>
          <h2 className={mk.h2}>Sådan flytter du fra {competitor.name}</h2>
          <ol className="border-t border-tt-streg">
            {migrationSteps.map((step, idx) => (
              <li
                key={step.title}
                className="grid grid-cols-[2rem_1fr] gap-3 border-b border-tt-streg py-5"
              >
                <span className="font-semibold tabular-nums text-tt-gran">
                  {idx + 1}.
                </span>
                <div>
                  <h3 className="font-semibold text-tt-blaek">{step.title}</h3>
                  <p className={`${mk.body} mt-1`}>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={mk.section}>
        <div className={twoCol}>
          <h2 className={mk.h2}>Spørgsmål og svar</h2>
          <FAQAccordion items={faq} />
        </div>

        {relatedComparisons && relatedComparisons.length > 0 && (
          <div className={`${twoCol} mt-16`}>
            <h2 className="text-2xl font-bold tracking-[-0.02em] text-tt-blaek sm:text-[32px]">
              Se også
            </h2>
            <ul className="flex flex-wrap gap-3">
              {relatedComparisons.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="inline-flex min-h-11 items-center rounded-full border border-tt-kant px-4 text-sm font-medium text-tt-blaek hover:bg-tt-flade"
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <script
          type="application/ld+json"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD schema markup
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: faq.map((item) => ({
                "@type": "Question",
                name: item.question,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: item.answer,
                },
              })),
            }),
          }}
        />
      </section>

      <CTASection
        title={ctaText ?? `Klar til at skifte fra ${competitor.name}?`}
        primaryHref={registerHref}
      />
      <Footer />
    </div>
  );
}
