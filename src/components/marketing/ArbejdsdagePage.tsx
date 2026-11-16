import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { WorkdaysTable } from "@/components/marketing/WorkdaysTable";
import {
  commonDaysOff,
  formatHours,
  officialHolidays,
  VACATION_DAYS,
  WEEKDAY_NAMES,
  weekdayOf,
  yearSummary,
} from "@/lib/marketing/workdays";

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("da-DK", {
    day: "numeric",
    month: "long",
  });
}

function isWeekend(date: string): boolean {
  const day = weekdayOf(date);
  return day === 0 || day === 6;
}

export function arbejdsdageMetadata(year: number): Metadata {
  const s = yearSummary(year);
  const title = `Arbejdsdage ${year}: helligdage og arbejdsdage pr. måned`;
  const description = `Der er ${s.workdays} arbejdsdage i ${year}, når de officielle helligdage er trukket fra. Se arbejdsdage og timer for hver måned og alle helligdage i ${year}.`;
  return {
    title: { absolute: `${title} | TimeTrack` },
    description,
    alternates: { canonical: `/arbejdsdage-${year}` },
    openGraph: {
      title,
      description,
      url: `/arbejdsdage-${year}`,
      type: "website",
    },
  };
}

/** Fælles side for /arbejdsdage-<år>. */
export function ArbejdsdagePage({
  year,
  otherYears,
}: {
  year: number;
  otherYears: number[];
}) {
  const s = yearSummary(year);
  const holidays = officialHolidays(year);
  const onWeekdays = holidays.filter((h) => !isWeekend(h.date)).length;
  const extra = commonDaysOff(year);

  const faq = [
    {
      question: `Hvor mange arbejdsdage er der i ${year}?`,
      answer: `Der er ${s.workdays} arbejdsdage i ${year}. Det er alle hverdage fra mandag til fredag, minus de ${onWeekdays} officielle helligdage, der falder på en hverdag. Efter ${VACATION_DAYS} feriedage er der ${s.workdays - VACATION_DAYS} dage tilbage.`,
    },
    {
      question: `Hvor mange arbejdstimer er der i ${year}?`,
      answer: `Ved 37 timer om ugen er der ${formatHours(s.hours)} arbejdstimer i ${year} og ${formatHours(s.hoursAfterVacation)} timer efter ${VACATION_DAYS} feriedage.`,
    },
    {
      question: "Er store bededag stadig en helligdag?",
      answer:
        "Nej. Store bededag blev afskaffet som helligdag fra 2024, så den tæller som en almindelig arbejdsdag.",
    },
    {
      question: "Er grundlovsdag en fridag?",
      answer:
        "Grundlovsdag er ikke en officiel helligdag, men mange har fri eller halv fri efter overenskomst eller aftale. Det samme gælder juleaftensdag og nytårsaftensdag.",
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
      title={`Arbejdsdage ${year}`}
      subtitle={`${year} har ${s.workdays} arbejdsdage og ${onWeekdays} helligdage på hverdage. Her er tallet for hver måned, alle helligdage og arbejdstimerne ved 37 timer om ugen.`}
      jsonLd={faqSchema}
      faqItems={faq}
      relatedLinks={[
        {
          href: "/arbejdstimer-pr-maaned",
          title: "Arbejdstimer pr. måned",
          description: "Timer i en gennemsnitsmåned og ved deltid.",
        },
        ...otherYears.map((y) => ({
          href: `/arbejdsdage-${y}`,
          title: `Arbejdsdage ${y}`,
          description: `Arbejdsdage og helligdage i ${y}.`,
        })),
        {
          href: "/arbejdstimer-beregner",
          title: "Arbejdstimer-beregner",
          description: "Beregn timer mellem to klokkeslæt.",
        },
      ]}
      ctaTitle="Registrér de dage, du faktisk arbejder"
      ctaSubtitle="TimeTrack holder styr på timer, ferie og fravær. Gratis at starte."
    >
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6 text-lg leading-relaxed text-gray-900">
            <strong>Kort svar:</strong> Der er <strong>{s.workdays}</strong>{" "}
            arbejdsdage i {year}. Ved 37 timer om ugen svarer det til{" "}
            {formatHours(s.hours)} arbejdstimer før ferie.
          </div>

          <h2 className="mt-14 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Arbejdsdage pr. måned i {year}
          </h2>
          <div className="mt-6">
            <WorkdaysTable year={year} />
          </div>
          <p className="mt-3 text-sm text-gray-500">
            * Grundlovsdag, juleaftensdag og nytårsaftensdag, når de falder på
            en hverdag. De er ikke helligdage og tæller med som arbejdsdage.
          </p>

          <h2 className="mt-16 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Helligdage i {year}
          </h2>
          <ul className="mt-6 divide-y divide-gray-100 rounded-2xl border border-gray-200">
            {holidays.map((h) => (
              <li
                key={h.date}
                className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
              >
                <span className="font-medium text-gray-900">{h.name}</span>
                <span className="text-gray-600">
                  {WEEKDAY_NAMES[weekdayOf(h.date)]} {formatDate(h.date)}
                  {isWeekend(h.date) ? (
                    <span className="ml-2 text-gray-400">(weekend)</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          <h2 className="mt-16 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Dage, mange har fri
          </h2>
          <p className="mt-3 text-gray-600">
            Disse dage er ikke officielle helligdage, men mange har fri eller
            halv fri. Tjek din overenskomst eller kontrakt.
          </p>
          <ul className="mt-6 divide-y divide-gray-100 rounded-2xl border border-gray-200">
            {extra.map((h) => (
              <li
                key={h.date}
                className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
              >
                <span className="font-medium text-gray-900">{h.name}</span>
                <span className="text-gray-600">
                  {WEEKDAY_NAMES[weekdayOf(h.date)]} {formatDate(h.date)}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-12 leading-relaxed text-gray-700">
            Skal medarbejdernes arbejdsdage, ferie og fravær registreres, kan{" "}
            <Link
              href="/virksomheder"
              className="font-medium text-brand-700 underline"
            >
              TimeTrack til virksomheder
            </Link>{" "}
            hente helligdagene automatisk og regne normtid, flex og feriesaldo
            ud for hver medarbejder.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
