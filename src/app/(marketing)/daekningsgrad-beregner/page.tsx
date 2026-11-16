import type { Metadata } from "next";
import Link from "next/link";
import { DaekningsgradBeregner } from "@/components/marketing/DaekningsgradBeregner";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

const TITLE = "Dækningsgrad-beregner: formel, eksempler og dækningsbidrag";
const DESCRIPTION =
  "Beregn dækningsgrad og dækningsbidrag gratis. Formlen forklaret med eksempler fra konsulent- og servicevirksomheder, nulpunktsomsætning og pris ud fra ønsket dækningsgrad.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "dækningsgrad",
    "dækningsgrad formel",
    "beregn dækningsgrad",
    "dækningsbidrag",
    "beregn dækningsbidrag",
    "hvad er dækningsgrad",
  ],
  alternates: { canonical: "/daekningsgrad-beregner" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/daekningsgrad-beregner",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvad er formlen for dækningsgrad?",
    answer:
      "Dækningsgrad = dækningsbidrag ÷ omsætning × 100. Dækningsbidraget er omsætningen minus de variable omkostninger. Sælger du for 800.000 kr. og har 320.000 kr. i variable omkostninger, er dækningsbidraget 480.000 kr. og dækningsgraden 60 %.",
  },
  {
    question: "Hvad er forskellen på dækningsbidrag og dækningsgrad?",
    answer:
      "Dækningsbidraget er et beløb i kroner: det, der er tilbage til at dække faste omkostninger og overskud. Dækningsgraden er det samme udtrykt i procent af omsætningen, så du kan sammenligne opgaver, kunder og år af forskellig størrelse.",
  },
  {
    question: "Hvad er en god dækningsgrad?",
    answer:
      "Det afhænger af branchen. En virksomhed, der videresælger varer, lever typisk med en lavere dækningsgrad end en rådgivningsvirksomhed, hvor de variable omkostninger mest er løn til timerne. Det bedste pejlemærke er din egen udvikling og om dækningsbidraget kan bære de faste omkostninger med god margin.",
  },
  {
    question: "Hvad er forskellen på avance (pålæg) og dækningsgrad?",
    answer:
      "Pålæg regnes af kostprisen, dækningsgrad af salgsprisen. Køber du en time ind til 450 kr. og lægger 40 % på, sælger du til 630 kr., og dækningsgraden er kun 28,6 %. Vil du have 40 % i dækningsgrad, skal prisen være 450 ÷ 0,6 = 750 kr.",
  },
  {
    question: "Hvad er nulpunktsomsætning?",
    answer:
      "Den omsætning, hvor dækningsbidraget lige præcis dækker de faste omkostninger, så resultatet er 0. Formlen er faste omkostninger ÷ dækningsgrad. Med 180.000 kr. i faste omkostninger og 60 % i dækningsgrad er nulpunktet 300.000 kr.",
  },
];

export default function DaekningsgradBeregnerPage() {
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
      title="Dækningsgrad-beregner"
      subtitle="Beregn dækningsbidrag, dækningsgrad og nulpunktsomsætning, og find den pris, der giver den dækningsgrad, du vil have. Gratis og uden login."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Regn videre på din forretning:"
      relatedLinks={[
        {
          href: "/belaegningsgrad-beregner",
          title: "Belægningsgrad-beregner",
          description: "Hvor stor en del af tiden bliver faktureret?",
        },
        {
          href: "/timepris-beregner",
          title: "Timepris-beregner",
          description: "Find den timepris, der dækker løn og udgifter.",
        },
        {
          href: "/klippekort-prisberegner",
          title: "Klippekort-prisberegner",
          description: "Prissæt forudbetalte timepakker uden at sænke DB.",
        },
      ]}
      ctaTitle="Se dækningsbidraget pr. projekt og medarbejder"
      ctaSubtitle="TimeTrack trækker intern kostpris fra omsætningen pr. projekt, så du ser hvilke opgaver der tjener penge. Gratis at starte."
    >
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="daekningsgrad-beregner">
            <DaekningsgradBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="daekningsgrad-beregner" />
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Dækningsgrad: formlen trin for trin
          </h2>
          <ol className="list-decimal space-y-3 pl-6">
            <li>
              <strong>Dækningsbidrag</strong> = omsætning − variable
              omkostninger
            </li>
            <li>
              <strong>Dækningsgrad</strong> = dækningsbidrag ÷ omsætning × 100
            </li>
            <li>
              <strong>Resultat</strong> = dækningsbidrag − faste omkostninger
            </li>
            <li>
              <strong>Nulpunktsomsætning</strong> = faste omkostninger ÷
              dækningsgrad
            </li>
          </ol>
          <p>
            Variable omkostninger er dem, der følger med salget: varer,
            underleverandører og løn til de timer, der går til opgaven. Faste
            omkostninger er der, uanset om du sælger: husleje, forsikring,
            software, bil og administration.
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Eksempel: et lille bureau med to medarbejdere
          </h2>
          <p>
            Et webbureau sælger 1.400 timer om året til 850 kr. Det giver
            1.190.000 kr. i omsætning. De to medarbejdere koster tilsammen 420
            kr. i timen i løn og pension for hver time, de arbejder på
            kundeopgaver, og der købes for 60.000 kr. freelancehjælp.
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm tabular-nums">
              <tbody>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Omsætning (1.400 t × 850 kr.)
                  </th>
                  <td className="px-4 py-2 text-right">1.190.000 kr.</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Løn til kundetimer (1.400 t × 420 kr.)
                  </th>
                  <td className="px-4 py-2 text-right">−588.000 kr.</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Freelancehjælp
                  </th>
                  <td className="px-4 py-2 text-right">−60.000 kr.</td>
                </tr>
                <tr className="border-b border-slate-200 bg-brand-50/60">
                  <th scope="row" className="px-4 py-2 text-left font-semibold">
                    Dækningsbidrag
                  </th>
                  <td className="px-4 py-2 text-right font-semibold">
                    542.000 kr.
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-2 text-left font-semibold">
                    Dækningsgrad
                  </th>
                  <td className="px-4 py-2 text-right font-semibold">45,5 %</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Pointen er ikke tallet for hele året, men fordelingen. Ét
            fastprisprojekt, der løb 120 timer over budgettet, kostede 50.400
            kr. i løn uden at give én krone mere i omsætning. Det kan kun ses,
            hvis tiden er registreret på projektet.
          </p>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Dækningsgrad for freelancere og konsulenter
          </h2>
          <p>
            Arbejder du alene uden underleverandører, er dine variable
            omkostninger små, og dækningsgraden ligger tæt på 100 %. Så
            fortæller den ikke meget. Det, der flytter din indtjening, er hvor
            mange af dine timer, der bliver faktureret, og hvad du reelt får pr.
            time. Det måler du med{" "}
            <Link
              href="/belaegningsgrad-beregner"
              className="text-brand-600 underline"
            >
              belægningsgraden
            </Link>{" "}
            og din effektive timepris.
          </p>
          <p>
            Dækningsgraden bliver interessant, når du begynder at bruge
            underleverandører eller ansætter. Sælger du en time til 750 kr., som
            en anden freelancer leverer til 600 kr., er dækningsgraden 20 %. Det
            er ofte mindre, end man tror, når både salg og projektledning skal
            betales af de 150 kr.
          </p>
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-5">
            <h3 className="font-semibold text-slate-900">
              Sådan hjælper TimeTrack
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Rapporten <strong>Team-lønsomhed</strong> trækker hver
                medarbejders interne kostpris fra omsætningen pr. projekt og pr.
                medarbejder. Det er dit dækningsbidrag, opgave for opgave.
              </li>
              <li>
                <strong>Hvad tjener du faktisk?</strong> viser den reelle
                timepris pr. kunde: optjente kroner delt med alle brugte timer,
                også dem, der ikke blev faktureret.
              </li>
              <li>
                Timepriser kan sættes pr. kunde og projekt, og hver ændring
                gemmes i en prishistorik.
              </li>
            </ul>
            <p className="mt-3 text-sm text-slate-600">
              Bemærk: inde i TimeTrack bruger vi også ordet dækningsgrad om
              noget andet, nemlig hvor stor en del af din normale arbejdstid der
              er registreret. Det er et tjek af, om tiden bliver logget, ikke et
              regnskabstal.
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
