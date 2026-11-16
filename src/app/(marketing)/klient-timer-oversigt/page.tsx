import type { Metadata } from "next";
import Link from "next/link";
import { ClientHoursTracker } from "@/components/marketing/ClientHoursTracker";
import { FeatureRows } from "@/components/marketing/FeatureRows";
import { mk } from "@/components/marketing/mk";
import { SEOPageLayout } from "@/components/marketing/SEOPageLayout";
import { ToolLeadCapture } from "@/components/marketing/ToolLeadCapture";
import { ToolUsageTracker } from "@/components/marketing/ToolUsageTracker";

export const metadata: Metadata = {
  title: "Timeoversigt pr. kunde: gratis tidsregistrering",
  description:
    "Gratis timeoversigt pr. kunde. Tilføj kunder, registrér timer med dato og beskrivelse, og eksportér som CSV. Ingen login påkrævet.",
  alternates: { canonical: "/klient-timer-oversigt" },
  openGraph: {
    title: "Timeoversigt pr. kunde: gratis | TimeTrack",
    description:
      "Registrér timer pr. kunde gratis. Data gemmes lokalt i din browser. Eksportér som CSV.",
    url: "/klient-timer-oversigt",
    type: "website",
  },
};

// Schema-teksten (text) og den viste besvarelse (answer) holdes sammen, så
// FAQPage-markup og synligt indhold ikke glider fra hinanden.
const FAQ = [
  {
    question: "Kan jeg bruge timeoversigten gratis?",
    text: "Ja. Timeoversigten er gratis og kræver ingen login. Dine data gemmes lokalt i din browser.",
    answer: (
      <p>
        Ja. Timeoversigten er gratis og kræver ingen login. Dine data gemmes
        lokalt i din browser.
      </p>
    ),
  },
  {
    question: "Hvor gemmes mine data?",
    text: "Alle data gemmes lokalt i din browsers lokale lager. Intet sendes til en server. Hvis du rydder browserdata, mister du registreringerne.",
    answer: (
      <p>
        Alle data gemmes lokalt i din browsers lokale lager. Intet sendes til en
        server. Hvis du rydder browserdata, mister du registreringerne.
      </p>
    ),
  },
  {
    question: "Kan jeg eksportere mine timer?",
    text: "Ja. Du kan eksportere alle registreringer som CSV-fil, som kan åbnes i Excel eller Google Sheets.",
    answer: (
      <p>
        Ja. Du kan eksportere alle registreringer som CSV-fil, som kan åbnes i
        Excel eller Google Sheets.
      </p>
    ),
  },
  {
    question: "Hvad er forskellen på denne oversigt og TimeTrack?",
    text: "Denne oversigt er et simpelt, gratis værktøj, der gemmer data lokalt. TimeTrack gemmer timerne på din konto og har klippekort, fakturering, rapporter og samarbejde med dit team.",
    answer: (
      <p>
        Denne oversigt er et simpelt, gratis værktøj, der gemmer data lokalt.{" "}
        <Link className={mk.link} href="/register">
          TimeTrack
        </Link>{" "}
        gemmer timerne på din konto og har klippekort, fakturering, rapporter og
        samarbejde med dit team.
      </p>
    ),
  },
];

export default function KlientTimerOversigtPage() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.text },
    })),
  };

  const faqItems = FAQ.map(({ question, answer }) => ({ question, answer }));

  const relatedLinks = [
    {
      href: "/online-stopur",
      title: "Online stopur",
      description: "Gratis stopur til tidsregistrering.",
    },
    {
      href: "/freelance-budget",
      title: "Freelance budget",
      description: "Beregn din økonomi som freelancer.",
    },
    {
      href: "/timeregistrering",
      title: "Timeregistrering",
      description: "Registrér timer pr. kunde og projekt i TimeTrack.",
    },
    {
      href: "/klippekort",
      title: "Klippekort",
      description: "Sælg forudbetalte timer til dine kunder.",
    },
  ];

  return (
    <SEOPageLayout
      title="Timeoversigt pr. kunde"
      subtitle="Registrér timer pr. kunde med dato og beskrivelse. Gratis og uden login: data gemmes lokalt i din browser."
      jsonLd={faqSchema}
      faqItems={faqItems}
      relatedLinks={relatedLinks}
      relatedTitle="Relaterede værktøjer"
      relatedSubtitle="Flere gratis værktøjer til tidsregistrering:"
      ctaTitle="Vil du have timerne på din konto?"
      ctaSubtitle="Med TimeTrack ligger timerne på din konto, og du får klippekort, rapporter og fakturering samlet ét sted. Gratis at starte."
    >
      <section className={mk.section}>
        <div className={mk.wrap}>
          <ToolUsageTracker tool="klient-timer-oversigt">
            <ClientHoursTracker />
          </ToolUsageTracker>
          <ToolLeadCapture tool="klient-timer-oversigt" />
        </div>
      </section>

      <FeatureRows
        title="Det, TimeTrack kan ud over oversigten"
        intro="TimeTrack kan det samme som oversigten, og timerne bliver på din konto, når du lukker browseren."
        items={[
          {
            title: "Kunder og projekter",
            text: "Registrér timer pr. kunde og projekt, og se totaler og gennemsnit pr. dag i en rapport.",
          },
          {
            title: "Eksport og rapporter",
            text: "Eksportér timer som CSV eller PDF, eller send en rapport til dine kunder.",
          },
          {
            title: "Timerne ligger på din konto",
            text: "Du kan åbne timerne fra computer, tablet og telefon.",
          },
        ]}
      />
    </SEOPageLayout>
  );
}
