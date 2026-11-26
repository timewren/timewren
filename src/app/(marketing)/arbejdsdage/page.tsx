import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import {
  ARBEJDSDAGE_YEARS,
  arbejdsdageHubSections,
} from "@/lib/marketing/arbejdsdage-seo";
import {
  formatHours,
  workdaysByMonth,
  yearSummary,
} from "@/lib/marketing/workdays";

const FIRST = ARBEJDSDAGE_YEARS[0];
const LAST = ARBEJDSDAGE_YEARS[ARBEJDSDAGE_YEARS.length - 1];
const TITLE = `Arbejdsdage ${FIRST}-${LAST}: antal pr. år og måned`;
const DESCRIPTION = `Antal arbejdsdage og arbejdstimer for hvert år fra ${FIRST} til ${LAST} og for hver måned, med danske helligdage trukket fra. Vælg år eller måned.`;

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | TimeTrack` },
  description: DESCRIPTION,
  alternates: { canonical: "/arbejdsdage" },
  robots: { index: true, follow: true },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/arbejdsdage",
    type: "website",
  },
};

export default function ArbejdsdageHubPage() {
  return (
    <SEOPageLayout
      title="Arbejdsdage pr. år og måned"
      subtitle={`Antal arbejdsdage og arbejdstimer i ${FIRST}-${LAST}, trukket fra danske helligdage. Vælg et år eller en måned.`}
      relatedLinks={[
        {
          href: "/arbejdstimer-pr-maaned",
          title: "Arbejdstimer pr. måned",
          description: "Timer i en gennemsnitsmåned og ved deltid.",
        },
        {
          href: "/arbejdstimer-beregner",
          title: "Arbejdstimer-beregner",
          description: "Beregn timer mellem to klokkeslæt.",
        },
      ]}
      ctaTitle="Registrér de timer, du faktisk arbejder"
      ctaSubtitle="TimeTrack holder styr på timer, ferie og fravær. Gratis at starte."
    >
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl space-y-14">
          {arbejdsdageHubSections().map(
            ({ year, yearHref, hoursHref, months: links }) => {
              const s = yearSummary(year);
              const months = workdaysByMonth(year);
              return (
                <div key={year}>
                  <h2 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
                    <Link href={yearHref} className="hover:underline">
                      Arbejdsdage {year}: {s.workdays} dage
                    </Link>
                  </h2>
                  <p className="mt-2 text-gray-600">
                    {formatHours(s.hours)} arbejdstimer ved 37 timer om ugen.{" "}
                    <Link
                      href={hoursHref}
                      className="font-medium text-brand-700 underline"
                    >
                      Arbejdstimer {year}
                    </Link>
                  </p>
                  <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {links.map(({ name, month: m, href }) => (
                      <li key={name}>
                        <Link
                          href={href}
                          className="block rounded-xl border border-gray-200 px-4 py-3 text-sm hover:border-brand-300"
                        >
                          <span className="font-medium text-brand-700">
                            {name} {year}
                          </span>
                          <span className="block text-gray-500">
                            {months[m].workdays} arbejdsdage
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            },
          )}
        </div>
      </section>
    </SEOPageLayout>
  );
}
