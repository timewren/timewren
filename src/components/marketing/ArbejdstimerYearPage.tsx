import type { Metadata } from "next";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { WorkdaysTable } from "@/components/marketing/WorkdaysTable";
import {
  ARBEJDSDAGE_YEARS,
  arbejdstimerYearMeta,
  hoursPath,
  yearPath,
} from "@/lib/marketing/arbejdsdage-seo";
import {
  averageMonthlyHours,
  formatHours,
  VACATION_DAYS,
  yearSummary,
} from "@/lib/marketing/workdays";

const WEEK_NORMS = [30, 32, 35, 37, 40];

export function arbejdstimerYearMetadata(year: number): Metadata {
  const { title, description, path } = arbejdstimerYearMeta(year);
  return {
    title: { absolute: `${title} | TimeTrack` },
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: { title, description, url: path, type: "website" },
  };
}

/** /arbejdstimer-<år>: årets timer ved forskellige ugenormer. */
export function ArbejdstimerYearPage({ year }: { year: number }) {
  const s = yearSummary(year, 37);
  const otherYears = ARBEJDSDAGE_YEARS.filter((y) => y !== year);

  const faq = [
    {
      question: `Hvor mange arbejdstimer er der i ${year}?`,
      answer: `Ved 37 timer om ugen er der ${formatHours(s.hours)} arbejdstimer i ${year}, fordelt på ${s.workdays} arbejdsdage à 7,4 timer. Efter ${VACATION_DAYS} feriedage er der ${formatHours(s.hoursAfterVacation)} timer.`,
    },
    {
      question: `Hvor mange arbejdstimer er der på en måned i ${year}?`,
      answer: `I gennemsnit ${formatHours(averageMonthlyHours(37))} timer ved 37 timer om ugen (37 × 52 ÷ 12). Den enkelte måned afhænger af antallet af arbejdsdage, så tabellen ovenfor viser hver måned i ${year}.`,
    },
    {
      question: "Hvordan regnes arbejdstimer ud?",
      answer:
        "Antal arbejdsdage (hverdage minus officielle helligdage) ganget med ugenormen delt med fem. Ved 37 timer om ugen er en arbejdsdag 7,4 timer.",
    },
  ];

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <SEOPageLayout
      title={`Arbejdstimer ${year}`}
      subtitle={`${year} har ${formatHours(s.hours)} arbejdstimer ved 37 timer om ugen, fordelt på ${s.workdays} arbejdsdage. Her er timerne for hver måned og ved 30, 32, 35 og 40 timer om ugen.`}
      jsonLd={faqSchema}
      faqItems={faq}
      relatedLinks={[
        {
          href: yearPath(year),
          title: `Arbejdsdage ${year}`,
          description: `Arbejdsdage og helligdage i ${year}.`,
        },
        {
          href: "/arbejdstimer-pr-maaned",
          title: "Arbejdstimer pr. måned",
          description: "Timer i en gennemsnitsmåned og ved deltid.",
        },
        ...otherYears.map((y) => ({
          href: hoursPath(y),
          title: `Arbejdstimer ${y}`,
          description: `Arbejdstimer i ${y} ved forskellig ugenorm.`,
        })),
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
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6 text-lg leading-relaxed text-gray-900">
            <strong>Kort svar:</strong> Der er{" "}
            <strong>{formatHours(s.hours)}</strong> arbejdstimer i {year} ved 37
            timer om ugen. Efter {VACATION_DAYS} feriedage er det{" "}
            {formatHours(s.hoursAfterVacation)} timer.
          </div>

          <h2 className="mt-14 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Arbejdstimer pr. måned i {year}
          </h2>
          <div className="mt-6">
            <WorkdaysTable year={year} partTimeHours={[32, 30]} />
          </div>
          <p className="mt-3 text-sm text-gray-500">
            * Grundlovsdag, juleaftensdag og nytårsaftensdag, når de falder på
            en hverdag. De er ikke helligdage og tæller med i timerne.
          </p>

          <h2 className="mt-16 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Arbejdstimer {year} efter ugenorm
          </h2>
          <div className="mt-6 overflow-x-auto rounded-[14px] border border-tt-streg">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="border-b border-tt-streg text-tt-graa">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Ugenorm
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Pr. måned (gns.)
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    {year} før ferie
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Efter {VACATION_DAYS} feriedage
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tt-streg">
                {WEEK_NORMS.map((h) => (
                  <tr key={h}>
                    <th
                      scope="row"
                      className="px-5 py-2.5 font-medium text-tt-blaek"
                    >
                      {h} t/uge
                    </th>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatHours(averageMonthlyHours(h))}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatHours((s.workdays * h) / 5)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatHours(((s.workdays - VACATION_DAYS) * h) / 5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-gray-500">
            Timer = arbejdsdage × ugenorm ÷ 5. Arbejdsdage er hverdage minus
            officielle helligdage; helligdagene er beregnet ud fra påskedag
            (kilde: folkekirkens kalender hos Kirkeministeriet; store bededag er
            afskaffet fra 2024).
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
