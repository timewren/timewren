import type { Metadata } from "next";
import Link from "next/link";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { TimeloenBeregner } from "@/components/marketing/TimeloenBeregner";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

const TITLE = "Timeløn-beregner: omregn månedsløn til timeløn og omvendt";
const DESCRIPTION =
  "Beregn timeløn ud fra månedsløn, eller månedsløn ud fra timeløn, ved fuld tid og deltid. Formlen med 160,33 timer forklaret, og hvad en timeløn svarer til, når du er selvstændig.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "timeløn beregner",
    "beregn timeløn",
    "månedsløn til timeløn",
    "timeløn til månedsløn",
    "beregn timeløn ud fra månedsløn",
  ],
  alternates: { canonical: "/timeloen-beregner" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/timeloen-beregner",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvordan beregner man timeløn ud fra månedsløn?",
    answer:
      "Del månedslønnen med antal arbejdstimer pr. måned. Ved 37 timer om ugen er det 37 × 52 ÷ 12 = 160,33 timer. En månedsløn på 35.000 kr. svarer derfor til 218,30 kr. i timen.",
  },
  {
    question: "Hvorfor 160,33 timer og ikke 148 timer?",
    answer:
      "Fordi en måned i gennemsnit har 52 ÷ 12 = 4,33 uger, ikke 4. Regner du med 4 uger, bliver timelønnen for høj, fordi du glemmer de ekstra dage, der er i de fleste måneder.",
  },
  {
    question: "Hvad er timelønnen ved deltid?",
    answer:
      "Brug dit eget ugentlige timetal. 18,5 timer om ugen giver 80,17 timer om måneden, så en deltidsløn på 17.500 kr. svarer til samme timeløn som 35.000 kr. på fuld tid: 218,30 kr.",
  },
  {
    question: "Er beregningen før eller efter skat?",
    answer:
      "Før skat. Beregneren omregner bruttolønnen. Hvad du får udbetalt, afhænger af AM-bidrag, din trækprocent og dine fradrag, som står på din forskudsopgørelse hos Skattestyrelsen.",
  },
  {
    question: "Skal pension regnes med?",
    answer:
      "Det afhænger af, hvad du vil sammenligne. Vil du sammenligne to job, hvor det ene har mere arbejdsgiverbetalt pension end det andet, så læg pensionen til månedslønnen, før du omregner.",
  },
];

export default function TimeloenBeregnerPage() {
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
      title="Timeløn-beregner"
      subtitle="Omregn månedsløn til timeløn og timeløn til månedsløn, på fuld tid eller deltid. Gratis og uden login."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Regn videre:"
      relatedLinks={[
        {
          href: "/timepris-beregner",
          title: "Timepris-beregner",
          description: "Hvilken timepris skal du tage som selvstændig?",
        },
        {
          href: "/minutter-til-timer",
          title: "Minutter til timer",
          description: "Omregn minutter til decimaltimer til timesedlen.",
        },
        {
          href: "/tidsregistrering-lovkrav",
          title: "Lovkrav om tidsregistrering",
          description: "Reglerne for registrering af medarbejderes arbejdstid.",
        },
      ]}
      ctaTitle="Registrér timerne, lønnen bygger på"
      ctaSubtitle="TimeTrack holder styr på timer, flex og overtid pr. medarbejder og laver en lønfil til lønkørslen. Gratis at starte."
    >
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="timeloen-beregner">
            <TimeloenBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="timeloen-beregner" />
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Formlen: fra månedsløn til timeløn
          </h2>
          <ol className="list-decimal space-y-3 pl-6">
            <li>
              <strong>Timer pr. måned</strong> = timer pr. uge × 52 ÷ 12
            </li>
            <li>
              <strong>Timeløn</strong> = månedsløn ÷ timer pr. måned
            </li>
            <li>
              <strong>Månedsløn</strong> = timeløn × timer pr. måned
            </li>
          </ol>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th scope="col" className="px-4 py-2 text-left font-medium">
                    Månedsløn (37 t/uge)
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Timeløn
                  </th>
                </tr>
              </thead>
              <tbody>
                {[25000, 30000, 35000, 40000, 45000, 50000].map((m) => (
                  <tr
                    key={m}
                    className="border-b border-slate-200 last:border-0"
                  >
                    <td className="px-4 py-2">
                      {m.toLocaleString("da-DK")} kr.
                    </td>
                    <td className="px-4 py-2 text-right">
                      {(m / ((37 * 52) / 12)).toLocaleString("da-DK", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      kr.
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Timelønnen her er det, du får for en arbejdstime. Den er ikke det
            samme som det, en time koster arbejdsgiveren. Oven i lønnen kommer
            blandt andet pension, ATP og forsikringer.
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Fra lønmodtager til selvstændig: timeløn er ikke timepris
          </h2>
          <p>
            Overvejer du at gå selvstændig, er det fristende at tage din
            nuværende timeløn og lægge lidt til. Det går sjældent godt. Som
            lønmodtager får du løn for alle timer, også dem i møder, på kursus
            og i ferien. Som selvstændig får du kun betaling for de timer, en
            kunde vil betale for.
          </p>
          <p>
            Et eksempel: 35.000 kr. om måneden er 218 kr. i timen. Kan du
            fakturere 60 % af din arbejdstid, skal hver fakturerbar time give
            364 kr. bare for at erstatte lønnen. Så mangler pension, ferie,
            sygdom, udstyr, forsikring og regnskab stadig. Den fulde beregning
            laver du i{" "}
            <Link
              href="/timepris-beregner"
              className="text-brand-600 underline"
            >
              timepris-beregneren
            </Link>
            , og andelen af fakturerbar tid kan du regne på med{" "}
            <Link
              href="/belaegningsgrad-beregner"
              className="text-brand-600 underline"
            >
              belægningsgrad-beregneren
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Har du timelønnede medarbejdere?
          </h2>
          <p>
            Siden 1. juli 2024 skal arbejdsgivere registrere medarbejdernes
            daglige arbejdstid. For timelønnede er registreringen samtidig
            grundlaget for lønnen. Læs mere om reglerne i vores guide til{" "}
            <Link
              href="/tidsregistrering-lovkrav"
              className="text-brand-600 underline"
            >
              lovkrav om tidsregistrering
            </Link>
            .
          </p>
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-5">
            <h3 className="font-semibold text-slate-900">
              Sådan hjælper TimeTrack
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Medarbejderne checker ind og ud eller udfylder en timeseddel, og
                lederen godkender ugen.
              </li>
              <li>
                Normtid pr. medarbejder, så flex og overtid bliver opgjort
                løbende.
              </li>
              <li>
                En lønfil (CSV) med timer pr. medarbejder og lønart til
                lønkørslen.
              </li>
            </ul>
            <p className="mt-3 text-sm text-slate-600">
              Det er en del af planen{" "}
              <Link href="/virksomheder" className="text-brand-600 underline">
                Virksomhed
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
