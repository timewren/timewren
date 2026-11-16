import type { Metadata } from "next";
import Link from "next/link";
import { MinutterTilTimerBeregner } from "@/components/marketing/MinutterTilTimerBeregner";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import {
  formatDecimaltimer,
  minutterTilDecimal,
} from "@/lib/marketing/tidsomregning";

const TITLE = "Minutter til timer: omregn til decimaltimer (100-dele)";
const DESCRIPTION =
  "Omregn minutter til timer i decimaltal: 45 min = 0,75 timer. Gratis omregner, tabel for 1-60 minutter og den fejl der koster penge på fakturaen.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "minutter til timer",
    "omregn minutter til timer",
    "minutter til decimaltal",
    "100 dele til minutter",
    "timer i 100 dele",
    "decimaltimer",
  ],
  alternates: { canonical: "/minutter-til-timer" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/minutter-til-timer",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvordan omregner man minutter til timer?",
    answer:
      "Del antallet af minutter med 60. 90 minutter ÷ 60 = 1,5 timer, og 135 minutter ÷ 60 = 2,25 timer. Har du timer og minutter, så del kun minutterne med 60 og læg de hele timer til: 3 timer og 20 minutter = 3 + 0,33 = 3,33 timer.",
  },
  {
    question: "Hvad er 100-dele?",
    answer:
      "100-dele er det samme som decimaltimer: en time delt i 100 i stedet for 60. Et kvarter er 25/100, en halv time 50/100 og 6 minutter 10/100. Lønsystemer og mange timesedler bruger 100-dele, fordi man kan gange dem direkte med en timeløn eller timepris.",
  },
  {
    question: "Hvad er 7 timer og 24 minutter i decimaltal?",
    answer:
      "7,40 timer. Det er en normal dansk arbejdsdag ved 37 timer om ugen fordelt på fem dage. 24 minutter ÷ 60 = 0,40.",
  },
  {
    question: "Hvorfor må jeg ikke skrive 1,45 for 1 time og 45 minutter?",
    answer:
      "Fordi 1,45 timer kun er 1 time og 27 minutter. Det rigtige tal er 1,75. Ved en timepris på 750 kr. mangler der 225 kr. på den ene linje, og fejlen gentager sig på hver linje med minutter over 0.",
  },
  {
    question: "Hvordan omregner jeg decimaltimer tilbage til minutter?",
    answer:
      "Gang decimaldelen med 60. 2,3 timer er 2 timer + 0,3 × 60 = 18 minutter, altså 2 timer og 18 minutter.",
  },
];

const TABEL_MINUTTER = Array.from({ length: 60 }, (_, i) => i + 1);

export default function MinutterTilTimerPage() {
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
      badge="Gratis værktøj"
      title="Minutter til timer"
      subtitle="Omregn minutter og timer:minutter til decimaltimer (100-dele) og tilbage igen. Med tabel og fakturaeksempel. Gratis og uden login."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Flere gratis værktøjer til dig, der arbejder på timer:"
      relatedLinks={[
        {
          href: "/arbejdstimer-beregner",
          title: "Arbejdstimer-beregner",
          description:
            "Fra mødetid og fyraften til timer med pause trukket fra.",
        },
        {
          href: "/belaegningsgrad-beregner",
          title: "Belægningsgrad-beregner",
          description: "Hvor stor en del af din tid får du betaling for?",
        },
        {
          href: "/timeseddel-skabelon",
          title: "Timeseddel-skabelon",
          description: "Gratis timeseddel i Excel med decimaltimer.",
        },
      ]}
      ctaTitle="Lad TimeTrack regne timerne om for dig"
      ctaSubtitle="Registrér med timer eller fritekst. Fakturagrundlaget får decimaltimer, der passer til Billy, Dinero og e-conomic."
    >
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="minutter-til-timer">
            <MinutterTilTimerBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="minutter-til-timer" />
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Formlen: minutter ÷ 60
          </h2>
          <p>
            En time har 60 minutter, så et minut er 1/60 time, altså cirka
            0,0167. Du får decimaltimer ved at dele minutterne med 60. Tre
            eksempler:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>45 minutter</strong> = 45 ÷ 60 ={" "}
              <strong>0,75 timer</strong>
            </li>
            <li>
              <strong>2 timer og 10 minutter</strong> = 2 + 10 ÷ 60 ={" "}
              <strong>2,17 timer</strong>
            </li>
            <li>
              <strong>444 minutter</strong> (en arbejdsdag på 37-timersugen) =
              444 ÷ 60 = <strong>7,40 timer</strong>
            </li>
          </ul>
          <p>
            Decimaltal kaldes også 100-dele. Det er dem, lønsystemer, timesedler
            og regnskabsprogrammer regner med, fordi de kan ganges direkte med
            en timepris. Timer og minutter (1:45) kan ikke.
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold text-slate-900">
            Omregningstabel: 1-60 minutter i decimaltimer
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">
            Afrundet til to decimaler, som de fleste fakturaer og lønsedler
            bruger.
          </p>
          <div className="mt-8 grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((kolonne) => (
              <table
                key={kolonne}
                className="w-full text-sm tabular-nums"
                aria-label={`Minutter ${kolonne * 15 + 1} til ${kolonne * 15 + 15}`}
              >
                <thead>
                  <tr className="border-b border-slate-300 text-left text-slate-600">
                    <th scope="col" className="py-2 font-medium">
                      Minutter
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      Timer
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TABEL_MINUTTER.slice(kolonne * 15, kolonne * 15 + 15).map(
                    (m) => (
                      <tr key={m} className="border-b border-slate-200">
                        <td className="py-1.5 text-slate-700">{m} min</td>
                        <td className="py-1.5 text-right font-medium text-slate-900">
                          {formatDecimaltimer(minutterTilDecimal(m))}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Fejlen der koster penge: komma i stedet for kolon
          </h2>
          <p>
            Den hyppigste fejl på håndskrevne timesedler og fakturaer er at
            skrive timer og minutter med komma. 1 time og 45 minutter bliver til
            “1,45”, men 1,45 timer er kun 1 time og 27 minutter. På en uge med
            ti registreringer med 30-50 minutter hver kan det løbe op i flere
            timer, du aldrig får betaling for.
          </p>
          <p>
            Det modsatte sker også. Bliver 2 timer og 30 minutter til “2,30”,
            mangler der 0,2 timer, og kunden kan med rette undre sig, når næste
            faktura pludselig har 2,50 for samme opgave.
          </p>
          <h3 className="pt-2 text-xl font-semibold text-slate-900">
            Afrunding: aftal den med kunden
          </h3>
          <p>
            Mange runder op til nærmeste kvarter (0,25), andre bruger 6 eller 10
            minutter. Hvad du vælger, er en aftale med kunden. Det vigtige er,
            at reglen er den samme hver gang og står i tilbuddet eller aftalen.
            Revisorer og advokater bruger ofte små enheder, mens håndværkere
            typisk runder til halve timer.
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Slip for at regne om i hånden
          </h2>
          <p>
            I TimeTrack starter du en timer eller skriver fx “2 timer på
            hjemmeside til Jensen i går”, og tiden gemmes i minutter. På{" "}
            <Link href="/fakturagrundlag" className="text-brand-600 underline">
              fakturagrundlaget
            </Link>{" "}
            står tiden som decimaltimer ganget med den timepris, der gælder for
            kunden eller projektet. Afrunding sættes pr. kunde til 5, 10, 15, 30
            eller 60 minutter.
          </p>
          <p>
            Herfra sender du fakturaen til{" "}
            <Link href="/billy" className="text-brand-600 underline">
              Billy
            </Link>{" "}
            eller{" "}
            <Link href="/dinero" className="text-brand-600 underline">
              Dinero
            </Link>
            . Til{" "}
            <Link href="/e-conomic" className="text-brand-600 underline">
              e-conomic
            </Link>{" "}
            er der integration og fakturagrundlag. Har kunden et{" "}
            <Link href="/klippekort" className="text-brand-600 underline">
              klippekort
            </Link>
            , trækkes de samme decimaltimer fra saldoen.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
