import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { FREE_LIMITS, PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "TimeOps alternativ: TimeTrack",
  description:
    "Et alternativ til TimeOps for danske freelancere, med klippekort, indbygget fakturering og opgavehåndtering i ét system.",
  keywords: ["timeops alternativ", "timeops vs timetrack", "tidsregistrering"],
  alternates: { canonical: "/timeops-alternativ" },
};

export default function TimeOpsAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "TimeOps",
        description:
          "Dansk tidsregistreringssystem rettet mod freelancere og små teams.",
        // Tjekket på timeops.dk/priser 23. oktober 2026: Free har plads til
        // 3 brugere og ubegrænsede kunder/projekter, Premium starter ved
        // 44 kr. pr. bruger/md. ekskl. moms.
        pricing: [
          { plan: "Free (3 brugere)", price: 0, period: "md" },
          { plan: "Premium", price: 44, period: "bruger/md" },
        ],
        targetAudience: "Danske freelancere og små teams",
        weaknesses: [
          "Ingen klippekort-funktionalitet",
          "Ingen indbygget fakturering",
          "Ingen opgavehåndtering",
          "Ingen nyheder på hjemmesiden siden 2022",
          "Kræver CVR, blokerer hobbybrugere",
        ],
      }}
      hero={{
        title: "Et alternativ til TimeOps for danske freelancere",
        subtitle:
          "Klippekort, indbygget fakturering og opgavehåndtering, som TimeOps ikke har.",
      }}
      quickComparison={[
        {
          feature: "Pris (freelancer)",
          us: PLAN_PRICES.selvstaendig.price,
          them: "44 kr./md.",
        },
        { feature: "Klippekort", us: true, them: false },
        { feature: "Indbygget fakturering", us: true, them: false },
        { feature: "Opgavehåndtering", us: true, them: false },
        { feature: "Dansk support", us: true, them: true },
        { feature: "CVR-opslag", us: true, them: false },
        { feature: "Aktiv udvikling", us: true, them: false },
      ]}
      features={[
        {
          category: "Tidsregistrering",
          items: [
            { name: "Start/stop timer", us: true, them: true },
            { name: "Tags & kategorier", us: true, them: true },
            { name: "Automatisk afrunding", us: true, them: true },
            { name: "Kalendersynkronisering", us: true, them: true },
            { name: "Pomodoro timer", us: true, them: false },
          ],
        },
        {
          category: "Fakturering",
          items: [
            { name: "Indbygget fakturering", us: true, them: false },
            { name: "Klippekort (forudbetalte timer)", us: true, them: false },
            { name: "Billy integration", us: true, them: false },
            { name: "Dinero integration", us: true, them: true },
            {
              name: "e-conomic integration",
              us: true,
              them: "I pipeline",
            },
          ],
        },
        {
          category: "Projektstyring",
          items: [
            { name: "Opgavehåndtering", us: true, them: false },
            { name: "Rapporter & eksport", us: true, them: true },
            { name: "Rate history tracking", us: true, them: false },
            { name: "Browser extension", us: true, them: false },
          ],
        },
      ]}
      pricingComparison={{
        scenario: "Som freelancer med 1 bruger",
        usPrice: PLAN_PRICES.selvstaendig.price,
        themPrice: "44 kr./md.",
        savings:
          "Selvstændig koster mere, men har klippekort, fakturering og opgaver, som TimeOps ikke har.",
      }}
      migrationSteps={[
        {
          title: "Eksportér dine data fra TimeOps",
          description:
            "Brug TimeOps' CSV-eksport til at hente dine tidsregistreringer, kunder og projekter.",
        },
        {
          title: "Importér til TimeTrack",
          description:
            "Upload CSV-filerne i TimeTracks importværktøj. TimeTrack guider dig gennem hvert trin.",
        },
        {
          title: "Sæt dine klippekort op",
          description:
            "Opret klippekort for dine faste kunder, og få dem i brug fra dag ét.",
        },
      ]}
      faq={[
        {
          question: "Kan jeg importere data fra TimeOps?",
          answer:
            "Ja, TimeTrack understøtter CSV-import af tidsregistreringer, kunder og projekter direkte fra TimeOps' eksportformat.",
        },
        {
          question: "Hvorfor er TimeTrack dyrere end TimeOps Free?",
          answer: `TimeOps Free giver op til 3 brugere grundlæggende tidsregistrering, uden klippekort, fakturering eller opgaver. TimeTrack Selvstændig (${PLAN_PRICES.selvstaendig.price} ekskl. moms) har klippekort, fakturagrundlag til Billy eller Dinero og opgavehåndtering. ${FREE_LIMITS}`,
        },
        {
          question: "Hvad er klippekort?",
          answer:
            "Klippekort er forudbetalte timer, som din kunde køber på forhånd. Når du registrerer tid på kundens projekter, trækkes timerne automatisk fra klippekortet. Det er det, TimeTrack er bygget omkring.",
        },
        {
          question: "Har TimeTrack en mobilapp?",
          answer:
            "TimeTrack fungerer som PWA (Progressive Web App) på mobil med alle funktioner tilgængelige. Apps til iPhone og Android er i beta.",
        },
        {
          question: "Står der en rigtig person bag TimeTrack?",
          answer:
            "Ja. Jeg hedder Mads og bygger og driver TimeTrack selv. Skriver du til mig, svarer jeg, som regel samme dag.",
        },
      ]}
      relatedComparisons={[
        { name: "Intempus alternativ", href: "/intempus-alternativ" },
        { name: "Toggl alternativ", href: "/toggl-alternativ" },
        { name: "Harvest alternativ", href: "/harvest-alternativ" },
      ]}
    />
  );
}
