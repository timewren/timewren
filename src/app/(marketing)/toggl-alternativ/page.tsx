import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Toggl alternativ: TimeTrack",
  description:
    "Et dansk alternativ til Toggl, med klippekort, dansk fakturering og Billy/Dinero-integration.",
  keywords: [
    "toggl alternativ",
    "toggl vs timetrack",
    "dansk tidsregistrering",
  ],
  alternates: { canonical: "/toggl-alternativ" },
};

export default function TogglAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Toggl",
        description:
          "Internationalt tidsregistreringssystem med fokus på brugervenlighed.",
        pricing: [
          { plan: "Starter", price: 70, period: "bruger/md" },
          { plan: "Premium", price: 130, period: "bruger/md" },
        ],
        targetAudience: "Internationale teams og freelancere",
        weaknesses: [
          "Ingen dansk fakturering",
          "Ingen CVR-opslag",
          "Ingen klippekort",
          "Ingen Billy/Dinero/e-conomic integration",
          "Engelsk UI og support",
        ],
      }}
      hero={{
        title: "Et dansk alternativ til Toggl, med klippekort og Billy",
        subtitle:
          "Det, Toggl er god til, plus dansk fakturering, klippekort og integration med Billy, Dinero og e-conomic.",
      }}
      quickComparison={[
        {
          feature: "Pris (freelancer)",
          us: PLAN_PRICES.selvstaendig.price,
          them: "ca. 70–130 kr. pr. bruger/md.",
        },
        { feature: "Dansk UI & support", us: true, them: false },
        { feature: "Klippekort", us: true, them: false },
        { feature: "Indbygget fakturering", us: true, them: "Premium" },
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
            { name: "Kalendersynkronisering", us: true, them: true },
          ],
        },
        {
          category: "Fakturering",
          items: [
            { name: "Dansk fakturering", us: true, them: false },
            { name: "Klippekort (forudbetalte timer)", us: true, them: false },
            { name: "Billy integration", us: true, them: false },
            { name: "Dinero integration", us: true, them: false },
            { name: "e-conomic integration", us: true, them: false },
          ],
        },
        {
          category: "Kunde & projekt",
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
        themPrice: "ca. 70–130 kr. pr. bruger/md.",
        savings: "Dansk lokalisering, klippekort og fakturering",
      }}
      migrationSteps={[
        {
          title: "Eksportér tidsregistreringer fra Toggl",
          description:
            "Brug Togglens CSV-eksport til at hente dine tidsregistreringer, kunder og projekter.",
        },
        {
          title: "Importér i TimeTrack",
          description:
            "Upload CSV-filerne i TimeTrack. TimeTrack oversætter Toggl-strukturen automatisk.",
        },
        {
          title: "Sæt dansk fakturering op",
          description:
            "Tilføj dit CVR, forbind til Billy og start med at fakturere direkte fra TimeTrack.",
        },
      ]}
      faq={[
        {
          question: "Hvorfor skifte fra Toggl til TimeTrack?",
          answer:
            "Toggl er god til ren tidsregistrering, men mangler alt det danske: fakturering, CVR-opslag, Billy/Dinero-integration og klippekort. TimeTrack er bygget specifikt til danske freelancere.",
        },
        {
          question: "Kan jeg importere mine Toggl-data?",
          answer:
            "Ja. Eksportér som CSV fra Toggl og importér direkte i TimeTrack. Kunder, projekter og tidsregistreringer overføres.",
        },
        {
          question: "Har TimeTrack samme UX som Toggl?",
          answer:
            "TimeTrack prioriterer også enkel og hurtig registrering med start/stop timer, tags og tastaturgenveje. Oven i det får du danske funktioner.",
        },
        {
          question: "Hvad er klippekort?",
          answer:
            "Klippekort er forudbetalte timer, din kunde køber på forhånd. TimeTrack trækker automatisk timerne, når du registrerer tid. Det har Toggl ikke.",
        },
      ]}
      relatedComparisons={[
        { name: "Harvest alternativ", href: "/harvest-alternativ" },
        { name: "Clockify alternativ", href: "/clockify-alternativ" },
        { name: "TimeOps alternativ", href: "/timeops-alternativ" },
      ]}
    />
  );
}
