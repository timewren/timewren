import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import {
  adjacentMonth,
  arbejdsdageMonthMeta,
  type DayKind,
  dayRowsForMonth,
  monthPath,
  yearPath,
} from "@/lib/marketing/arbejdsdage-seo";
import {
  formatHours,
  MONTH_NAMES,
  WEEKDAY_NAMES,
  workdaysByMonth,
} from "@/lib/marketing/workdays";

const KIND_LABEL: Record<DayKind, string> = {
  arbejdsdag: "Arbejdsdag",
  helligdag: "Helligdag",
  valgfri: "Valgfri fridag",
  weekend: "Weekend",
};

const PART_TIME = [30, 32, 35, 37, 40];

export function arbejdsdageMonthMetadata(
  year: number,
  month: number,
): Metadata {
  const { title, description, path } = arbejdsdageMonthMeta(year, month);
  return {
    title: { absolute: `${title} | TimeTrack` },
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: { title, description, url: path, type: "website" },
  };
}

/** /arbejdsdage-<år>/<måned>: dag for dag, helligdage og timer. */
export function ArbejdsdageMonthPage({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const name = MONTH_NAMES[month];
  const lower = name.toLowerCase();
  const m = workdaysByMonth(year)[month];
  const rows = dayRowsForMonth(year, month);
  const optional = rows.filter((r) => r.kind === "valgfri");
  const weekdayHolidays = rows.filter((r) => r.kind === "helligdag");
  const onWeekdays = weekdayHolidays.length;
  const prev = adjacentMonth(year, month, -1);
  const next = adjacentMonth(year, month, 1);

  const faq = [
    {
      question: `Hvor mange arbejdsdage er der i ${lower} ${year}?`,
      answer: `${name} ${year} har ${m.workdays} arbejdsdage. Der er ${m.weekdays} hverdage fra mandag til fredag${onWeekdays ? `, og ${onWeekdays} af dem er helligdage` : ", og ingen af dem er helligdage"}.`,
    },
    {
      question: `Hvor mange arbejdstimer er der i ${lower} ${year}?`,
      answer: `Ved 37 timer om ugen (7,4 timer om dagen) er der ${formatHours(m.hours)} arbejdstimer i ${lower} ${year}. Ved 32 timer om ugen er der ${formatHours((m.workdays * 32) / 5)} timer.`,
    },
    ...(optional.length
      ? [
          {
            question: `Tæller ${optional.map((o) => o.name?.toLowerCase()).join(" og ")} som arbejdsdag?`,
            answer: `Ja, i tallet ovenfor. ${optional.map((o) => o.name).join(" og ")} er ikke officielle helligdage, men mange har fri eller halv fri efter overenskomst eller aftale. Har du fri ${optional.length === 1 ? "den dag" : "de dage"}, er der ${m.workdays - optional.length} arbejdsdage i ${lower}.`,
          },
        ]
      : []),
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
      title={`Arbejdsdage ${lower} ${year}`}
      subtitle={`${name} ${year} har ${m.workdays} arbejdsdage og ${formatHours(m.hours)} arbejdstimer ved 37 timer om ugen. Her er hver dag, helligdagene og timerne ved deltid.`}
      jsonLd={faqSchema}
      faqItems={faq}
      relatedLinks={[
        {
          href: yearPath(year),
          title: `Arbejdsdage ${year}`,
          description: `Alle måneder og helligdage i ${year}.`,
        },
        {
          href: "/arbejdstimer-beregner",
          title: "Arbejdstimer-beregner",
          description: "Beregn timer mellem to klokkeslæt.",
        },
        {
          href: "/arbejdsdage",
          title: "Arbejdsdage pr. år og måned",
          description: "Oversigt over alle år og måneder.",
        },
      ]}
      ctaTitle="Registrér de timer, du faktisk arbejder"
      ctaSubtitle="TimeTrack holder styr på timer, ferie og fravær. Gratis at starte."
    >
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="rounded-2xl border border-brand-200 bg-brand-50 p-6 text-lg leading-relaxed text-gray-900">
            <strong>Kort svar:</strong> Der er <strong>{m.workdays}</strong>{" "}
            arbejdsdage i {lower} {year}: {m.weekdays} hverdage
            {onWeekdays
              ? ` minus ${onWeekdays} helligdag${onWeekdays === 1 ? "" : "e"} (${weekdayHolidays
                  .map((r) => r.name?.toLowerCase())
                  .join(", ")})`
              : ", og ingen helligdage på hverdage"}
            . Det er {formatHours(m.hours)} timer ved 37 timer om ugen.
          </div>

          <h2 className="mt-14 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Timer i {lower} {year} ved forskellig ugenorm
          </h2>
          <div className="mt-6 overflow-x-auto rounded-[14px] border border-tt-streg">
            <table className="w-full min-w-[22rem] text-left text-sm">
              <thead className="border-b border-tt-streg text-tt-graa">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Ugenorm
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Timer pr. dag
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Timer i {lower}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tt-streg">
                {PART_TIME.map((h) => (
                  <tr key={h}>
                    <th
                      scope="row"
                      className="px-5 py-2.5 font-medium text-tt-blaek"
                    >
                      {h} t/uge
                    </th>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatHours(h / 5)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatHours((m.workdays * h) / 5)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-16 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
            Dag for dag i {lower} {year}
          </h2>
          <div className="mt-6 overflow-x-auto rounded-[14px] border border-tt-streg">
            <table className="w-full min-w-[22rem] text-left text-sm">
              <thead className="border-b border-tt-streg text-tt-graa">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Dato
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Ugedag
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tt-streg">
                {rows.map((r) => (
                  <tr
                    key={r.date}
                    className={r.kind === "arbejdsdag" ? "" : "text-tt-graa"}
                  >
                    <th
                      scope="row"
                      className="px-5 py-2 font-medium tabular-nums"
                    >
                      {r.day}. {lower}
                    </th>
                    <td className="px-5 py-2">{WEEKDAY_NAMES[r.weekday]}</td>
                    <td className="px-5 py-2">
                      {KIND_LABEL[r.kind]}
                      {r.name ? ` (${r.name})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-gray-500">
            Valgfri fridage (grundlovsdag, juleaftensdag og nytårsaftensdag) er
            ikke officielle helligdage og tæller med som arbejdsdage i tallene.
            Helligdagene er beregnet ud fra påskedag; store bededag er afskaffet
            fra 2024 ved lov vedtaget i 2023. Kilde: folkekirkens kalender
            (Kirkeministeriet) og lovgivningen om store bededag.
          </p>

          <p className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
            {prev ? (
              <Link
                href={monthPath(prev.year, prev.month)}
                className="text-brand-700 underline"
              >
                ← {MONTH_NAMES[prev.month]} {prev.year}
              </Link>
            ) : null}
            {next ? (
              <Link
                href={monthPath(next.year, next.month)}
                className="text-brand-700 underline"
              >
                {MONTH_NAMES[next.month]} {next.year} →
              </Link>
            ) : null}
            <Link href={yearPath(year)} className="text-brand-700 underline">
              Hele {year}
            </Link>
          </p>

          <p className="mt-8 leading-relaxed text-gray-700">
            Vil du se, hvor mange timer du selv har arbejdet i forhold til
            normen? Brug{" "}
            <Link
              href="/arbejdstimer-beregner"
              className="font-medium text-brand-700 underline"
            >
              timeberegneren
            </Link>
            , eller lad TimeTrack registrere timerne for dig.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
