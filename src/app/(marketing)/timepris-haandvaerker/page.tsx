import type { Metadata } from "next";
import Link from "next/link";
import { HaandvaerkerTimeprisBeregner } from "@/components/marketing/HaandvaerkerTimeprisBeregner";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-limits";

const TITLE = "Timepris håndværker: elektriker, tømrer og VVS";
const DESCRIPTION =
  "Hvad koster en elektriker eller tømrer i timen, og hvordan regner en håndværker sin timepris? Gratis beregner fra løn, tillæg, fakturerbare timer og faste omkostninger til timepris ekskl. og inkl. moms.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "timepris elektriker",
    "hvad koster en elektriker i timen",
    "timepris tømrer",
    "hvad koster en tømrer i timen",
    "timepris vvs",
    "timepris murer",
    "timepris håndværker",
  ],
  alternates: { canonical: "/timepris-haandvaerker" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/timepris-haandvaerker",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvad koster en elektriker i timen?",
    answer:
      "Der er ingen fast takst. Hvert firma sætter sin egen timepris, og den skal dække langt mere end svendens løn: pension, feriepenge, bil, værktøj, autorisation, forsikring og de timer, der ikke kan faktureres. Beregneren her viser, hvordan prisen hænger sammen. Spørg altid, om prisen er med eller uden moms, og om der er kørsel eller opstartsgebyr oven i.",
  },
  {
    question: "Hvad koster en tømrer i timen?",
    answer:
      "Det samme gælder for tømrere: prisen er fri, og regnestykket er det samme som for andre håndværkere. Forskellen mellem to tilbud ligger typisk i løn, hvor stor en del af tiden der faktureres, og hvad bil, værktøj og administration koster pr. time. Fast pris på en hel opgave kan være mere interessant end timeprisen alene.",
  },
  {
    question: "Er håndværkerens timepris med eller uden moms?",
    answer:
      "Til erhvervskunder oplyses priser normalt ekskl. moms, til privatkunder skal den samlede pris inkl. moms fremgå. Momsen er 25 %, så 520 kr. ekskl. moms bliver til 650 kr. inkl. moms.",
  },
  {
    question: "Hvorfor er timeprisen så meget højere end timelønnen?",
    answer:
      "Fordi lønnen betales for alle timer, men kun en del af dem kan faktureres. Kørsel mellem pladser, oprydning, tilbudsgivning og ventetid er løn uden omsætning. Med 80 % fakturerbar tid og 25 % i lønomkostninger oven i lønnen koster en svend til 220 kr. i timen allerede 344 kr. pr. fakturerbar time, før bil, værktøj og avance er betalt.",
  },
  {
    question: "Kan jeg få fradrag for håndværkerens timer?",
    answer:
      "Som privatperson kan du for visse typer arbejde, fx grønne forbedringer af boligen, trække arbejdslønnen fra med håndværkerfradraget, men ikke materialerne. Reglerne og beløbsgrænserne ændrer sig fra år til år, så tjek de aktuelle regler hos Skattestyrelsen på skat.dk, før du regner med fradraget.",
  },
];

export default function TimeprisHaandvaerkerPage() {
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
      title="Timepris for håndværkere"
      subtitle="Hvad koster en elektriker, tømrer eller VVS'er i timen, og hvad skal timeprisen dække? Regn den ud fra løn, fakturerbare timer og faste omkostninger. Gratis og uden login."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedTitle="Relaterede sider"
      relatedSubtitle="Regn videre på timerne:"
      relatedLinks={[
        {
          href: "/timeregistrering-haandvaerker",
          title: "Timeregistrering for håndværkere",
          description: "Fra timeseddel på pladsen til faktura uden papir.",
        },
        {
          href: "/belaegningsgrad-beregner",
          title: "Belægningsgrad-beregner",
          description:
            "Hvor stor en del af de betalte timer bliver faktureret?",
        },
        {
          href: "/daekningsgrad-beregner",
          title: "Dækningsgrad-beregner",
          description: "Dækningsbidrag og nulpunkt for hele forretningen.",
        },
      ]}
      ctaTitle="Se om timeprisen holder på hver opgave"
      ctaSubtitle={`Registrér timerne på sagen fra telefonen, sammenlign med tilbuddet og fakturér via Billy, Dinero eller e-conomic. Gratis for op til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} aktive kunder.`}
    >
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="timepris-haandvaerker">
            <HaandvaerkerTimeprisBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="timepris-haandvaerker" />
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Hvad koster en elektriker eller tømrer i timen?
          </h2>
          <p>
            Der findes ingen officiel takst for håndværkere i Danmark. Prisen er
            fri, og to firmaer i samme by kan ligge langt fra hinanden. Det er
            derfor, vi ikke skriver en »gennemsnitspris« her. Den ville være et
            gæt. Til gengæld kan du se, hvad timeprisen skal dække, og så
            sammenligne tilbud på et bedre grundlag.
          </p>
          <p>
            Når du indhenter tilbud, er det de her ting, der flytter prisen:
          </p>
          <ul className="list-disc space-y-2 pl-6">
            <li>
              <strong>Moms.</strong> Er prisen oplyst med eller uden 25 % moms?
            </li>
            <li>
              <strong>Hvem kommer?</strong> En mestertime, en svendetime og en
              lærlingetime koster sjældent det samme.
            </li>
            <li>
              <strong>Kørsel og opstart.</strong> Mange tager et fast beløb for
              at køre ud, eller en minimumstid pr. besøg.
            </li>
            <li>
              <strong>Tidspunkt.</strong> Akutte udkald, aften og weekend koster
              typisk mere.
            </li>
            <li>
              <strong>Materialer.</strong> De kommer oven i timerne, ofte med en
              avance.
            </li>
            <li>
              <strong>Timepris eller fast pris.</strong> En lav timepris siger
              ikke noget om, hvor mange timer opgaven tager.
            </li>
          </ul>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Sådan regner en håndværker sin timepris
          </h2>
          <ol className="list-decimal space-y-3 pl-6">
            <li>
              <strong>Lønomkostning pr. time</strong> = timeløn × (1 +
              lønomkostninger i %). Her hører pension, feriepenge, SH,
              forsikringer og ATP til.
            </li>
            <li>
              <strong>Løn pr. fakturerbar time</strong> = lønomkostning ÷
              fakturerbar andel. Er 80 % af tiden fakturerbar, skal hver
              fakturerbar time bære 1,25 betalte timer.
            </li>
            <li>
              <strong>Faste omkostninger pr. time</strong> = faste omkostninger
              pr. medarbejder ÷ fakturerbare timer om året.
            </li>
            <li>
              <strong>Timepris</strong> = (løn + faste omkostninger) × (1 +
              avance).
            </li>
          </ol>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm tabular-nums">
              <caption className="px-4 pt-3 text-left text-sm text-slate-500">
                Eksempel med beregnerens standardtal, afrundet til hele kroner
                (ikke en markedspris)
              </caption>
              <tbody>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Timeløn 220 kr. + 25 % lønomkostninger
                  </th>
                  <td className="px-4 py-2 text-right">275 kr.</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Fordelt på 80 % fakturerbar tid
                  </th>
                  <td className="px-4 py-2 text-right">344 kr.</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    150.000 kr. faste omkostninger ÷ 1.320 timer
                  </th>
                  <td className="px-4 py-2 text-right">114 kr.</td>
                </tr>
                <tr className="border-b border-slate-200">
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Kostpris pr. fakturerbar time
                  </th>
                  <td className="px-4 py-2 text-right">457 kr.</td>
                </tr>
                <tr className="border-b border-slate-200 bg-brand-50/60">
                  <th scope="row" className="px-4 py-2 text-left font-semibold">
                    Timepris med 15 % avance, ekskl. moms
                  </th>
                  <td className="px-4 py-2 text-right font-semibold">
                    526 kr.
                  </td>
                </tr>
                <tr>
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    Inkl. 25 % moms
                  </th>
                  <td className="px-4 py-2 text-right">657 kr.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            Læg mærke til, hvor meget den fakturerbare andel betyder. Falder den
            fra 80 % til 70 %, stiger kostprisen fra 457 til 523 kr. i timen,
            uden at nogen har fået mere i løn. Det er den andel, du måler med{" "}
            <Link
              href="/belaegningsgrad-beregner"
              className="text-brand-600 underline"
            >
              belægningsgraden
            </Link>
            .
          </p>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Elektriker, tømrer, VVS og murer: samme regnestykke
          </h2>
          <p>
            Formlen er den samme på tværs af fag. Det, der varierer, er tallene,
            du sætter ind: lønnen efter jeres overenskomst eller aftale, hvor
            meget bil og værktøj koster, og hvor meget af dagen der går med
            kørsel og ting, kunden ikke betaler for.
          </p>
          <p>
            El- og VVS-firmaer har desuden udgifter til autorisation og det
            kvalitetsledelsessystem, der følger med. Det er en fast omkostning
            og hører med i feltet for faste omkostninger. Et murer- eller
            tømrerfirma med meget kørsel mellem små opgaver har typisk en lavere
            fakturerbar andel end et firma med få, store sager.
          </p>
          <div className="rounded-xl border border-brand-200 bg-brand-50/60 p-5">
            <h3 className="font-semibold text-slate-900">
              Sådan hjælper TimeTrack
            </h3>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>
                Timerne registreres på kunde og sag fra telefonen, så du kan se
                den reelle fakturerbare andel i stedet for at gætte den.
              </li>
              <li>
                Timepriser kan sættes pr. kunde og pr. projekt, og projekter kan
                have et timebudget, så du kan se, om tilbuddet holder.
              </li>
              <li>
                Regningsarbejde bliver til en faktura i Billy, Dinero eller
                e-conomic med timerne som dokumentation.
              </li>
            </ul>
            <p className="mt-3 text-sm text-slate-600">
              TimeTrack er timeregistrering og fakturering, ikke ordrestyring.
              Læs mere på siden om{" "}
              <Link
                href="/timeregistrering-haandvaerker"
                className="text-brand-600 underline"
              >
                timeregistrering for håndværkere
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </SEOPageLayout>
  );
}
