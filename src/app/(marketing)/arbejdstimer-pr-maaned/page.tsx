import type { Metadata } from "next";
import Link from "next/link";
import { MonthlyWorkHours } from "@/components/marketing/MonthlyWorkHours";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { TimerPrMaanedBeregner } from "@/components/marketing/TimerPrMaanedBeregner";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { appLinkHref } from "@/lib/config";
import {
  averageMonthlyHours,
  formatHours,
  VACATION_DAYS,
  workdaysByMonth,
  yearSummary,
} from "@/lib/marketing/workdays";

// Året følger bygget, så siden altid viser indeværende og næste år.
const YEAR = new Date().getFullYear();
const NEXT = YEAR + 1;
const AVG = formatHours(averageMonthlyHours(37));
const THIS_YEAR = yearSummary(YEAR, 37);
const MONTHS = workdaysByMonth(YEAR, 37);
const MIN = MONTHS.reduce((a, b) => (b.workdays < a.workdays ? b : a));
const MAX = MONTHS.reduce((a, b) => (b.workdays > a.workdays ? b : a));

const TITLE = `Arbejdstimer pr. måned ${YEAR} og ${NEXT} ved 37 timer`;
const DESCRIPTION = `Se arbejdstimer pr. måned i ${YEAR} og ${NEXT} ved 37, 32 og 30 timer om ugen. Tabellerne trækker danske helligdage fra. Beregn også din egen norm.`;

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | TimeTrack` },
  description: DESCRIPTION,
  alternates: { canonical: "/arbejdstimer-pr-maaned" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/arbejdstimer-pr-maaned",
    type: "website",
  },
};

const WEEKLY = [37, 32, 30, 25, 20];

const FAQ = [
  {
    question: "Hvor mange arbejdstimer er der på en måned?",
    answer: `Ved en 37-timers uge er der i gennemsnit ${AVG} arbejdstimer på en måned (37 × 52 uger ÷ 12 måneder). Den enkelte måned svinger efter antallet af arbejdsdage. I ${YEAR} har ${MIN.name.toLowerCase()} færrest med ${formatHours(MIN.hours)} timer, og ${MAX.name.toLowerCase()} flest med ${formatHours(MAX.hours)} timer.`,
  },
  {
    question: "Hvor mange arbejdsdage er der på en måned?",
    answer: `I ${YEAR} er der ${THIS_YEAR.workdays} arbejdsdage, når helligdagene er trukket fra, eller i gennemsnit ${formatHours(THIS_YEAR.workdays / 12)} arbejdsdage pr. måned. ${MIN.name} har færrest med ${MIN.workdays} dage, og ${MAX.name.toLowerCase()} flest med ${MAX.workdays} dage. Tabellen ovenfor viser hver måned.`,
  },
  {
    question: "Hvor mange uger er der på en måned?",
    answer:
      "Der er i gennemsnit 4,33 uger på en måned (52 uger ÷ 12 måneder). Det er derfor, en månedsnorm regnes som ugetimer × 4,33 og ikke × 4.",
  },
  {
    question: "Hvor mange arbejdstimer er der på et år?",
    answer: `En 37-timers uge giver 1.924 timer om året, hvis man regner med 52 hele uger. Trækker man de officielle helligdage fra, er der ${formatHours(THIS_YEAR.hours)} timer i ${YEAR}, og efter ${VACATION_DAYS} feriedage er der ${formatHours(THIS_YEAR.hoursAfterVacation)} timer tilbage.`,
  },
  {
    question: "Hvor mange timer er fuldtid i Danmark?",
    answer:
      "Fuldtid er i de fleste overenskomster 37 timer om ugen, svarende til 7,4 timer om dagen i en fem-dages uge. Deltid er alt under det, typisk 30 eller 32 timer.",
  },
  {
    question: "Hvor mange timer er der på en måned ved 32 timer om ugen?",
    answer: `Ved 32 timer om ugen er der i gennemsnit ${formatHours(averageMonthlyHours(32))} timer på en måned, og ved 30 timer er der ${formatHours(averageMonthlyHours(30))} timer.`,
  },
  {
    question: "Tæller grundlovsdag og juleaften med som fridage?",
    answer:
      "Nej, de er ikke officielle helligdage, så de tæller som arbejdsdage i tabellen. Mange har dog fri eller halv fri, afhængigt af overenskomst eller ansættelseskontrakt. Kolonnen med almindelige fridage viser, hvor mange af dem der falder på en hverdag.",
  },
];

export default function ArbejdstimerPrMaanedPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  return (
    <SEOPageLayout
      title={`Arbejdstimer pr. måned i ${YEAR} og ${NEXT}`}
      showHeroCta={false}
      subtitle={`I gennemsnit ${AVG} timer ved 37 timer om ugen. Her er tallet for hver måned i ${YEAR} og ${NEXT}, og en beregner til deltid.`}
      jsonLd={faqSchema}
      faqItems={FAQ}
      relatedLinks={[
        {
          href: "/arbejdsdage-2027",
          title: "Arbejdsdage 2027",
          description: "Se datoer for alle helligdage i 2027.",
        },
        {
          href: "/overarbejde-beregner",
          title: "Beregn overarbejde",
          description: "Sammenlign din arbejdstid med normen.",
        },
        {
          href: "/flextid-beregner",
          title: "Beregn flextid",
          description: "Find din nye saldo ud fra timer og norm.",
        },
        {
          href: "/arbejdsdage-2026",
          title: "Arbejdsdage 2026",
          description: "Arbejdsdage og helligdage måned for måned.",
        },
        {
          href: "/arbejdstimer-beregner",
          title: "Arbejdstimer-beregner",
          description: "Beregn timer mellem to klokkeslæt med pause.",
        },
        {
          href: "/timeseddel-skabelon",
          title: "Timeseddel-skabelon",
          description: "Gratis skabelon til ugens timer.",
        },
        {
          href: "/virksomheder",
          title: "Registrering af arbejdstid",
          description: "Check ind og ud, ferie og flex for virksomheder.",
        },
      ]}
      ctaTitle="Hold styr på dine faktiske timer"
      ctaSubtitle="Normtimerne siger, hvad du skal arbejde. TimeTrack viser, hvad du faktisk har arbejdet. Gratis at starte, og virksomheder får flex og overtid regnet ud."
    >
      <section className={`${mk.wrap} pb-12 sm:pb-16`}>
        <p className={`${mk.body} max-w-[65ch]`}>
          En 37-timers uge svarer til{" "}
          <strong>{AVG} timer pr. måned i gennemsnit</strong>. For en bestemt
          måned bruger du kalenderen nedenfor. Timerne er fordelt ligeligt på
          mandag til fredag, og helligdage på hverdage er trukket fra.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          {[YEAR, NEXT].map((year) => (
            <a key={year} href={`#timer-${year}`} className={mk.link}>
              Gå til {year}
            </a>
          ))}
        </div>

        {[YEAR, NEXT].map((year) => (
          <MonthlyWorkHours key={year} year={year} />
        ))}
        <p className={`${mk.fine} mt-4 max-w-4xl`}>
          * Grundlovsdag, juleaftensdag og nytårsaftensdag, når de falder på en
          hverdag. De er med i normen. Har du fri en af dagene, kan du trække
          dine daglige timer fra.
        </p>
        <p className={`${mk.body} mt-4`}>
          Vil du sammenligne din norm med de timer, du faktisk arbejder?{" "}
          <Link href={appLinkHref("/register")} className={mk.link}>
            Gem dine timer i TimeTrack
          </Link>
          .
        </p>
      </section>

      <section className={mk.section}>
        <div className={mk.wrap}>
          <h2 className={mk.h2}>Regn dine egne timer ud</h2>
          <p className={`${mk.body} mt-4 max-w-2xl`}>
            Skriv dine ugentlige timer, så ser du timer pr. måned og år.
          </p>
          <div className="mt-8 max-w-4xl">
            <ToolUsageTracker tool="arbejdstimer-pr-maaned">
              <TimerPrMaanedBeregner years={[YEAR, NEXT]} />
            </ToolUsageTracker>
          </div>
        </div>
      </section>

      <section className={mk.section}>
        <div className={mk.wrap}>
          <h2 className={mk.h2}>Fuldtid og deltid</h2>
          <div className="mt-8 max-w-4xl overflow-x-auto rounded-[14px] border border-tt-streg">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <thead className="border-b border-tt-streg text-tt-graa">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Timer pr. uge
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Pr. dag
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Pr. måned (gns.)
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    {YEAR} efter ferie
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-tt-streg">
                {WEEKLY.map((h) => (
                  <tr key={h}>
                    <th
                      scope="row"
                      className="px-5 py-2.5 font-medium tabular-nums text-tt-blaek"
                    >
                      {h}
                    </th>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatHours(h / 5)}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatHours(averageMonthlyHours(h))}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {formatHours(yearSummary(YEAR, h).hoursAfterVacation)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={mk.section}>
        <div
          className={`${mk.wrap} grid gap-10 lg:grid-cols-[1fr_2fr] lg:gap-16`}
        >
          <h2 className={mk.h2}>Sådan regner man det ud</h2>
          <div className={`${mk.body} space-y-4`}>
            <p>
              Gennemsnittet for en måned findes ved at gange de ugentlige timer
              med 52 uger og dele med 12 måneder. For 37 timer giver det 37 × 52
              ÷ 12 = {AVG} timer. Det er det tal, mange lønsystemer bruger som
              normtimer for en måned.
            </p>
            <p>
              Vil du vide, hvor mange timer der er i en bestemt måned, tæller du
              hverdagene, trækker helligdagene fra og ganger med de daglige
              timer. En 37-timers uge giver 7,4 timer om dagen.
            </p>
            <p>
              Har du flextid, er det de faktiske timer, der afgør din saldo. Med{" "}
              <Link href="/" className={mk.link}>
                TimeTrack
              </Link>{" "}
              registrerer du dem med et klik, og i{" "}
              <Link href="/virksomheder" className={mk.link}>
                Virksomhed-planen
              </Link>{" "}
              regnes flex og overtid ud automatisk.
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
