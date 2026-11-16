import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { FREE_MAX_SEATS } from "@/lib/billing/plan-gate";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Clockify alternativ: TimeTrack",
  description:
    "Et dansk alternativ til Clockify, med klippekort, dansk fakturering og Billy/Dinero-integration.",
  keywords: [
    "clockify alternativ",
    "clockify vs timetrack",
    "dansk tidsregistrering",
  ],
  alternates: { canonical: "/clockify-alternativ" },
};

export default function ClockifyAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Clockify",
        description:
          "Internationalt tidsregistreringssystem med generøs gratis plan.",
        pricing: [
          { plan: "Free", price: 0, period: "md" },
          { plan: "Pro", price: 65, period: "bruger/md" },
        ],
        targetAudience: "Teams og freelancere verden over",
        weaknesses: [
          "Ingen dansk fakturering",
          "Ingen CVR-opslag",
          "Ingen klippekort",
          "Begrænsede danske integrationer",
          "Engelsk UI og support",
        ],
      }}
      hero={{
        title: "Et dansk alternativ til Clockify, med klippekort og Billy",
        subtitle:
          "Clockify er gratis, men mangler det danske. TimeTrack giver dig klippekort, dansk fakturering og Billy-integration.",
      }}
      quickComparison={[
        {
          feature: "Gratis plan",
          us: `Op til ${FREE_MAX_SEATS} brugere`,
          them: true,
        },
        { feature: "Dansk UI & support", us: true, them: false },
        { feature: "Klippekort", us: true, them: false },
        { feature: "Indbygget fakturering", us: true, them: "Pro" },
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
            { name: "Pomodoro timer", us: true, them: true },
            { name: "Kalendersynkronisering", us: true, them: true },
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
          category: "Projekt & kunde",
          items: [
            { name: "CVR auto-lookup", us: true, them: false },
            { name: "Opgavehåndtering", us: true, them: true },
            { name: "Rate history", us: true, them: false },
            { name: "Kundeportal", us: true, them: false },
          ],
        },
      ]}
      pricingComparison={{
        scenario: "Som freelancer med 1 bruger",
        usPrice: PLAN_PRICES.selvstaendig.price,
        themPrice: "0 kr. (Free) / ca. 65 kr. pr. bruger/md. (Pro)",
        savings: "Dansk lokalisering, klippekort og fakturering",
      }}
      migrationSteps={[
        {
          title: "Eksportér dine data fra Clockify",
          description:
            "Brug Clockifys CSV/Excel eksport til at hente tidsregistreringer, kunder og projekter.",
        },
        {
          title: "Importér til TimeTrack",
          description:
            "Upload filerne i TimeTracks importer. Strukturen oversættes automatisk.",
        },
        {
          title: "Forbind Billy og sæt klippekort op",
          description:
            "Tilføj dit CVR, forbind Billy og opret klippekort for dine faste kunder.",
        },
      ]}
      faq={[
        {
          question: "Hvorfor betale for TimeTrack når Clockify er gratis?",
          answer:
            "Clockify Free har grundlæggende tidsregistrering, men ingen dansk fakturering, ingen klippekort, ingen Billy/Dinero-integration og ingen dansk support. For danske freelancere sparer TimeTrack dig tid og gebyrer.",
        },
        {
          question: "Kan jeg importere fra Clockify?",
          answer:
            "Ja. Brug Clockifys CSV-eksport og upload filerne i TimeTrack. Kunder, projekter og tidsregistreringer overføres.",
        },
        {
          question: "Hvad er klippekort?",
          answer:
            "Klippekort er forudbetalte timer, din kunde køber på forhånd. TimeTrack trækker automatisk timerne fra saldoen. Det kan Clockify ikke.",
        },
        {
          question: "Har TimeTrack samme funktioner som Clockify Pro?",
          answer:
            "Ja, og mere til: avancerede rapporter, egne timepriser, kundeportal og danske funktioner som CVR-opslag, Billy-integration og klippekort.",
        },
      ]}
      relatedComparisons={[
        { name: "Toggl alternativ", href: "/toggl-alternativ" },
        { name: "Harvest alternativ", href: "/harvest-alternativ" },
        { name: "Effihub alternativ", href: "/effihub-alternativ" },
      ]}
    />
  );
}
