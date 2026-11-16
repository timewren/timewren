import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Harvest alternativ: TimeTrack",
  description:
    "Et dansk alternativ til Harvest, med dansk support, klippekort og Billy/Dinero-integration.",
  keywords: [
    "harvest alternativ",
    "harvest vs timetrack",
    "dansk tidsregistrering",
  ],
  alternates: { canonical: "/harvest-alternativ" },
};

export default function HarvestAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Harvest",
        description:
          "Amerikansk tidsregistrering med indbygget fakturering og rapporter.",
        pricing: [
          { plan: "Solo", price: 0, period: "md (1 bruger)" },
          { plan: "Team", price: 85, period: "bruger/md" },
        ],
        targetAudience: "Internationale bureauer og freelancere",
        weaknesses: [
          "Kun engelsk UI og support",
          "Ingen dansk fakturering / ingen CVR",
          "Ingen klippekort",
          "Ingen Billy/Dinero/e-conomic",
          "Dyrere end danske alternativer",
        ],
      }}
      hero={{
        title: "Et dansk alternativ til Harvest, med klippekort og Billy",
        subtitle:
          "Dansk support, klippekort og integration med Billy og Dinero.",
      }}
      quickComparison={[
        {
          feature: "Pris/måned",
          us: PLAN_PRICES.selvstaendig.price,
          them: "ca. 85 kr. pr. bruger/md. (Team)",
        },
        { feature: "Dansk UI & support", us: true, them: false },
        { feature: "Klippekort", us: true, them: false },
        { feature: "Indbygget fakturering", us: true, them: true },
        { feature: "CVR-opslag", us: true, them: false },
        { feature: "Billy integration", us: true, them: false },
        { feature: "Dinero integration", us: true, them: false },
      ]}
      features={[
        {
          category: "Tidsregistrering",
          items: [
            { name: "Start/stop timer", us: true, them: true },
            { name: "Tags & kategorier", us: true, them: true },
            { name: "Browser extension", us: true, them: true },
            { name: "Pomodoro timer", us: true, them: false },
          ],
        },
        {
          category: "Fakturering",
          items: [
            { name: "Dansk fakturering", us: true, them: false },
            { name: "Klippekort", us: true, them: false },
            { name: "Billy integration", us: true, them: false },
            { name: "Dinero integration", us: true, them: false },
            { name: "e-conomic integration", us: true, them: false },
          ],
        },
        {
          category: "Rapportering",
          items: [
            { name: "Advanced reporting", us: true, them: true },
            { name: "CSV/PDF eksport", us: true, them: true },
            { name: "Realtids omsætning", us: true, them: true },
          ],
        },
      ]}
      pricingComparison={{
        scenario: "Som freelancer med 1 bruger",
        usPrice: PLAN_PRICES.selvstaendig.price,
        themPrice: "ca. 85 kr. pr. bruger/md. (Team)",
        savings: "Dansk lokalisering og klippekort",
      }}
      migrationSteps={[
        {
          title: "Eksportér data fra Harvest",
          description:
            "Brug Harvests CSV-eksport til at hente tidsregistreringer, kunder og projekter.",
        },
        {
          title: "Importér til TimeTrack",
          description:
            "Upload CSV-filerne i TimeTracks importer. Kunder, projekter og tidsregistreringer overføres.",
        },
        {
          title: "Sæt dansk fakturering op",
          description:
            "Forbind Billy, tilføj dit CVR og begynd at sende danske fakturaer direkte fra TimeTrack.",
        },
      ]}
      faq={[
        {
          question: "Hvorfor skifte fra Harvest til TimeTrack?",
          answer:
            "Harvest er et godt internationalt produkt, men har ingen danske funktioner: ingen CVR-opslag, ingen Billy/Dinero-integration, ingen klippekort og kun engelsk support. TimeTrack er bygget til danske freelancere.",
        },
        {
          question: "Kan jeg importere fra Harvest?",
          answer:
            "Ja. Eksportér som CSV fra Harvest og importér i TimeTrack. Kunder, projekter og tidsregistreringer kommer med.",
        },
        {
          question: "Hvad koster TimeTrack i forhold til Harvest?",
          answer: `Harvest Team koster ca. 12 USD pr. bruger/md., og Harvest Solo er gratis til én bruger. TimeTrack Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms for én bruger, med klippekort, fakturagrundlag og Billy eller Dinero.`,
        },
        {
          question: "Hvad er klippekort?",
          answer:
            "Klippekort er forudbetalte timer, din kunde køber på forhånd. TimeTrack trækker automatisk timerne fra saldoen. Det kan Harvest ikke.",
        },
      ]}
      relatedComparisons={[
        { name: "Toggl alternativ", href: "/toggl-alternativ" },
        { name: "Clockify alternativ", href: "/clockify-alternativ" },
        { name: "Intempus alternativ", href: "/intempus-alternativ" },
      ]}
    />
  );
}
