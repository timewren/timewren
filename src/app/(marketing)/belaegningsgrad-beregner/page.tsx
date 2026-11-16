import type { Metadata } from "next";
import Link from "next/link";
import { BelaegningsgradBeregner } from "@/components/marketing/BelaegningsgradBeregner";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

const TITLE = "Belægningsgrad-beregner for konsulenter og bureauer";
const DESCRIPTION =
  "Beregn din belægningsgrad (fakturerbar tid ÷ disponibel tid), hvad et procentpoint er værd i kroner, og hvilken belægning dit omsætningsmål kræver. Gratis.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "belægningsgrad",
    "belægningsgrad beregning",
    "udnyttelsesgrad",
    "belægningsprocent",
    "faktureringsgrad",
    "fakturerbar tid",
  ],
  alternates: { canonical: "/belaegningsgrad-beregner" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/belaegningsgrad-beregner",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvad er belægningsgrad?",
    answer:
      "Belægningsgrad er den andel af din tilgængelige arbejdstid, som en kunde betaler for. Har du 1.665 timer til rådighed på et år og fakturerer 1.165, er belægningsgraden 70 %. Begrebet hedder også udnyttelsesgrad eller faktureringsgrad.",
  },
  {
    question: "Hvordan beregner man belægningsgrad?",
    answer:
      "Fakturerbare timer ÷ disponible timer × 100. Disponible timer er normtiden minus ferie, helligdage og fravær: 37 timer × 45 uger = 1.665 timer. Nogle regner i stedet af alle registrerede timer. Vælg én metode og brug den hver gang.",
  },
  {
    question: "Hvad er en god belægningsgrad?",
    answer:
      "Der er ingen fast norm, men mange konsulenthuse og bureauer styrer efter noget i retning af 70-80 % for medarbejdere, der kun laver kundearbejde, og lavere for ledere og sælgere. Som selvstændig skal du også selv sælge og lave administration, så 60-70 % er realistisk for mange.",
  },
  {
    question: "Hvorfor er 100 % belægning ikke målet?",
    answer:
      "Fordi nogen skal sælge næste opgave, sende fakturaer, lære nyt og tage de interne møder. En belægning tæt på 100 % over længere tid betyder som regel, at timer bliver skrevet på kunder, der ikke burde betale for dem, eller at pipelinen er tom om tre måneder.",
  },
  {
    question: "Hvordan hæver jeg min belægningsgrad?",
    answer:
      "Start med at registrere de små ting: telefonopkald, rettelser og mails, der hører til en kunde. De forsvinder oftest. Sælg klippekort til kunder med løbende småopgaver, så de korte opgaver bliver betalt. Og se på hvilke opgaver der ofte bliver markeret som ikke-fakturerbare, så de kan prissættes fra starten.",
  },
];

export default function BelaegningsgradBeregnerPage() {
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
      title="Belægningsgrad-beregner"
      subtitle="Se hvor stor en del af din tid, der bliver faktureret, hvad hvert procentpoint er værd, og hvilken belægning dit omsætningsmål kræver."
      jsonLd={faqSchema}
      faqItems={FAQ.map((f) => ({
        question: f.question,
        answer: <p>{f.answer}</p>,
      }))}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Regn videre på timer og priser:"
      relatedLinks={[
        {
          href: "/timepris-beregner",
          title: "Timepris-beregner",
          description: "Sæt timeprisen ud fra en realistisk belægning.",
        },
        {
          href: "/ufaktureret-tid-beregner",
          title: "Ufaktureret tid-beregner",
          description: "Hvad koster de timer, der ikke kommer på fakturaen?",
        },
        {
          href: "/daekningsgrad-beregner",
          title: "Dækningsgrad-beregner",
          description: "Dækningsbidrag og dækningsgrad pr. opgave.",
        },
      ]}
      ctaTitle="Mål belægningen på rigtige timer"
      ctaSubtitle="TimeTrack deler tiden i fakturerbar og ikke-fakturerbar og viser udnyttelsesgraden pr. medarbejder. Gratis for op til 3 brugere."
    >
      <section className="border-t bg-slate-50/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <ToolUsageTracker tool="belaegningsgrad-beregner">
            <BelaegningsgradBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="belaegningsgrad-beregner" />
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Sådan regnes belægningsgraden
          </h2>
          <p className="rounded-xl bg-slate-50 p-4 font-medium text-slate-900">
            Belægningsgrad = fakturerbare timer ÷ disponible timer × 100
          </p>
          <p>
            <strong>Disponible timer</strong> er den tid, du er på arbejde: 37
            timer om ugen gange de uger, der er tilbage efter fem ugers ferie,
            helligdage og lidt sygdom. Med 7 uger væk giver det 45 × 37 = 1.665
            timer om året, ikke de 1.924, man får ved at gange med 52.
          </p>
          <p>
            <strong>Fakturerbare timer</strong> er de timer, en kunde betaler
            for. Timer på et klippekort tæller med, når de trækkes. Tilbud,
            salgsmøder, bogføring og interne møder tæller ikke, selv om de er
            nødvendige.
          </p>
          <h3 className="pt-2 text-xl font-semibold text-slate-900">
            Tre ord for samme tal
          </h3>
          <p>
            Belægningsgrad, udnyttelsesgrad og faktureringsgrad bruges om det
            samme i de fleste rådgivnings- og bureauvirksomheder. Nogle
            virksomheder deler dog af alle registrerede timer i stedet for
            normtiden. Så ser tallet højere ud, men det skjuler de timer, der
            slet ikke bliver registreret.
          </p>
        </div>
      </section>

      <section className="border-t bg-slate-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Eksempel: konsulent til 850 kr. i timen
          </h2>
          <p>
            En selvstændig IT-konsulent har 1.665 disponible timer og fakturerer
            i snit 24 timer om ugen i 45 uger, altså 1.080 timer.
            Belægningsgraden er 64,9 %, og omsætningen 918.000 kr.
          </p>
          <p>
            Hvert procentpoint er 16,65 timer om året. Ved 850 kr. i timen er
            det ca. 14.150 kr. Får konsulenten registreret de 30 minutter om
            dagen med mails, opkald og små rettelser, der i dag forsvinder,
            stiger belægningen med knap 7 procentpoint, og omsætningen med cirka
            95.000 kr., uden en eneste ny kunde.
          </p>
          <p>
            Vil konsulenten op på 1,1 mio. kr., kræver det 77,7 % belægning ved
            samme timepris. Det er højt for en, der også selv skal sælge. Her er
            en højere{" "}
            <Link
              href="/timepris-beregner"
              className="text-brand-600 underline"
            >
              timepris
            </Link>{" "}
            eller et{" "}
            <Link href="/klippekort" className="text-brand-600 underline">
              klippekort
            </Link>{" "}
            til de faste kunder ofte mere realistisk end flere timer.
          </p>
        </div>
      </section>

      <section className="border-t bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-5 text-slate-700">
          <h2 className="text-3xl font-bold text-slate-900">
            Belægningsgrad i TimeTrack
          </h2>
          <ul className="list-disc space-y-3 pl-6">
            <li>
              Hver registrering er fakturerbar eller ikke-fakturerbar. Du sætter
              standarden pr. kunde og kan ændre den på den enkelte registrering.
            </li>
            <li>
              Rapporten <strong>Udnyttelsesgrad</strong> viser fakturerbar tid
              mod total tid og normtid pr. medarbejder og som udvikling for hele
              teamet.
            </li>
            <li>
              Dit ugeskema bestemmer normtiden. Dashboardet viser, hvor stor en
              del af den der er registreret, så du opdager huller, mens du
              stadig kan huske, hvad du lavede.
            </li>
            <li>
              Timer uden kunde gemmes som intern tid. Så tæller de med i
              normtiden, men ikke som fakturerbare.
            </li>
          </ul>
          <p>
            <Link
              href="/teams-og-bureauer"
              className="text-brand-600 underline"
            >
              Team
            </Link>{" "}
            koster 49 kr. pr. bruger om måneden, og Gratis dækker op til 3
            brugere, så et lille bureau kan måle belægningen, før der skal
            betales.
          </p>
        </div>
      </section>
    </SEOPageLayout>
  );
}
