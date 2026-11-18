import type { Metadata } from "next";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { TimeprisBeregner } from "@/components/marketing/TimeprisBeregner";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";
import { PAID_FROM_LINE } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timepris-beregner: hvad skal du tage i timen som freelancer?",
  description:
    "Gratis timepris-beregner for freelancere. Beregn din timepris ud fra ønsket indkomst, udgifter og fakturerbar tid. Find den rette timepris inkl. og ekskl. moms.",
  alternates: { canonical: "/timepris-beregner" },
  openGraph: {
    title: "Timepris-beregner: hvad skal du tage i timen som freelancer?",
    description:
      "Gratis timepris-beregner for freelancere. Beregn din timepris ud fra ønsket indkomst, udgifter og fakturerbar tid.",
    url: "/timepris-beregner",
    type: "website",
  },
};

const FAQ = [
  {
    question: "Hvordan beregner jeg min timepris som freelancer?",
    answer:
      "Tag din ønskede månedsindkomst plus faste udgifter, gang med 12 for årsbehovet, og divider med dine fakturerbare timer pr. år. Husk at fratrække ferie, og regn ikke med, at hele arbejdsdagen kan faktureres. Beregneren starter med 70% fakturerbar tid, og du kan ændre tallet.",
  },
  {
    question: "Hvad er en typisk timepris for en freelancer i Danmark?",
    answer:
      "Det afhænger af branche, erfaring og specialisering, og der er ikke én rigtig pris. Find først den timepris, du skal have for at nå din indkomst, og sammenlign den derefter med, hvad kunderne i din branche betaler.",
  },
  {
    question: "Skal moms lægges oven i timeprisen?",
    answer:
      "Ja. Hvis du er momsregistreret (påkrævet ved omsætning over 50.000 kr. på 12 måneder), skal du lægge 25% moms oven i din timepris. Momsen er ikke din indtægt: den afregnes til Skattestyrelsen.",
  },
  {
    question: "Hvad er fakturerbar tid?",
    answer:
      "Fakturerbar tid er den del af din arbejdstid, du kan fakturere en kunde for. Tid til admin, salg og pauser hører ikke med. Registrér dine timer i et par uger, så ser du, hvor stor en del af ugen der faktisk kan faktureres.",
  },
];

export default function TimeprisBeregnerPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  };

  const relatedLinks = [
    {
      href: "/effektiv-timepris-beregner",
      title: "Beregn effektiv timepris",
      description: "Se hvad en afsluttet opgave gav pr. arbejdstime.",
    },
    {
      href: "/moms-beregner",
      title: "Moms-beregner",
      description: "Beregn moms (25%) hurtigt.",
    },
    {
      href: "/faktura-skabelon",
      title: "Faktura-skabelon",
      description: "Gratis faktura-skabelon til freelancere.",
    },
    {
      href: "/arbejdstimer-beregner",
      title: "Arbejdstimer-beregner",
      description: "Beregn arbejdstimer mellem to tidspunkter.",
    },
    {
      href: "/pricing",
      title: "Priser",
      description: PAID_FROM_LINE,
    },
  ];

  return (
    <SEOPageLayout
      title="Timepris-beregner"
      subtitle="Beregn din freelance timepris ud fra indkomst, udgifter og fakturerbar tid. Gratis og uden login."
      jsonLd={faqSchema}
      faqItems={FAQ}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Andre gratis værktøjer til freelancere:"
      ctaTitle="Hold styr på dine timer og timepriser"
      ctaSubtitle="Med TimeTrack sætter du timepriser pr. kunde og projekt, registrerer timerne og kan bruge dem som fakturagrundlag."
    >
      <section className={mk.section}>
        <div className={mk.wrap}>
          <ToolUsageTracker tool="timepris-beregner">
            <TimeprisBeregner />
          </ToolUsageTracker>
          <ToolLeadCapture tool="timepris-beregner" />
        </div>
      </section>

      <FeatureRows
        title="Fra timepris til faktura"
        intro="Kender du din timepris, kan du lægge den ind i TimeTrack og bruge den på dine timer."
        items={[
          {
            title: "Timepris pr. kunde og projekt",
            text: "Sæt en timepris pr. kunde og pr. projekt, hvis du tager forskellig pris for forskellige opgaver.",
          },
          {
            title: "Fakturerbare og interne timer",
            text: "Markér timer som fakturerbare eller ikke, og se i rapporten, hvor mange timer der kan faktureres.",
          },
          {
            title: "Klippekort med din timepris",
            text: "Sælg forudbetalte timer til dine kunder med din timepris. Timerne trækkes fra saldoen, når du registrerer dem.",
          },
        ]}
      />
    </SEOPageLayout>
  );
}
