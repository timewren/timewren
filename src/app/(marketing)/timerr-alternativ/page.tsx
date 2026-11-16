import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timerr alternativ: TimeTrack",
  description: `Leder du efter et alternativ til Timerr? TimeTrack giver dig klippekort, AI email-to-task og browserudvidelse. Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms, Timerrs Freelancer-plan 199 kr./md.`,
  keywords: [
    "timerr alternativ",
    "timerr vs timetrack",
    "tidsregistrering freelancer",
    "klippekort tidsregistrering",
  ],
  alternates: { canonical: "/timerr-alternativ" },
};

export default function TimerRAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Timerr",
        description:
          "Dansk tidsregistreringsværktøj der visualiserer 'skjulte omkostninger' og usynligt arbejde for freelancere.",
        pricing: [
          { plan: "Hobby", price: 0, period: "md" },
          { plan: "Freelancer", price: 199, period: "md" },
          { plan: "Pro", price: 499, period: "md" },
        ],
        targetAudience:
          "Fotografer, konsulenter, designere og andre freelancere",
        weaknesses: [
          "Ingen klippekort, kan ikke håndtere forudbetalte timepakker",
          "Ingen indbygget fakturering (kun integrationer til regnskabssystemer)",
          "Ingen browser extension",
          "Ingen native mobilapp",
          "AI-features er 'Kommer snart' på dyr Pro-plan",
          "Ingen opgavehåndtering / Kanban",
          "Freelancer-plan koster 199 kr./md.",
        ],
      }}
      hero={{
        title: "Leder du efter et alternativ til Timerr?",
        subtitle: `Timerr er god til at vise usynligt arbejde, men mangler klippekort, fakturering og AI. TimeTrack Selvstændig har klippekort og fakturagrundlag til Billy eller Dinero og koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms mod Timerrs 199 kr./md.`,
      }}
      quickComparison={[
        {
          feature: "Pris (freelancer)",
          us: PLAN_PRICES.selvstaendig.price,
          them: "199 kr./md.",
        },
        { feature: "Klippekort", us: true, them: false },
        { feature: "Indbygget fakturering", us: true, them: false },
        { feature: "Browser extension", us: true, them: false },
        { feature: "AI email-to-task", us: true, them: "Kommer snart" },
        { feature: "CVR-opslag", us: true, them: true },
        { feature: "Dansk support", us: true, them: true },
        { feature: "Opgavehåndtering", us: true, them: false },
      ]}
      features={[
        {
          category: "Tidsregistrering",
          items: [
            { name: "Start/stop timer", us: true, them: true },
            { name: "Manuel tidsregistrering", us: true, them: true },
            { name: "Pomodoro timer", us: true, them: false },
            { name: "Browser extension", us: true, them: false },
            { name: "Kalendersynkronisering", us: true, them: false },
          ],
        },
        {
          category: "Fakturering & økonomi",
          items: [
            { name: "Klippekort (forudbetalte timer)", us: true, them: false },
            { name: "Indbygget fakturering", us: true, them: false },
            { name: "Billy integration", us: true, them: true },
            { name: "Dinero integration", us: true, them: true },
            { name: "e-conomic integration", us: true, them: false },
          ],
        },
        {
          category: "Projektstyring & AI",
          items: [
            { name: "Opgavehåndtering", us: true, them: false },
            { name: "AI email-to-task", us: true, them: "Kommer snart" },
            { name: "Dashboard-widgets (14 stk)", us: true, them: false },
            { name: "Rate history tracking", us: true, them: false },
            { name: "Webhooks & API", us: true, them: true },
          ],
        },
      ]}
      pricingComparison={{
        scenario: "Som freelancer med 1 bruger",
        usPrice: PLAN_PRICES.selvstaendig.price,
        themPrice: "199 kr./md. (Freelancer-plan)",
        savings:
          "Selvstændig er billigere og har klippekort, fakturering og browserudvidelse.",
      }}
      migrationSteps={[
        {
          title: "Eksportér dine data fra Timerr",
          description:
            "Brug Timerrs PDF-rapporter og CSV-eksport til at hente dine tidsregistreringer, projekter og kunder.",
        },
        {
          title: "Importér til TimeTrack",
          description:
            "Upload dine data i TimeTracks importværktøj. Kunder, projekter og tidsregistreringer overføres trin for trin.",
        },
        {
          title: "Sæt klippekort og fakturering op",
          description:
            "Opret klippekort for dine faste kunder og forbind Billy eller Dinero. Du er kørende på under 10 minutter.",
        },
      ]}
      faq={[
        {
          question: "Hvad er klippekort og hvorfor mangler Timerr det?",
          answer:
            "Klippekort er forudbetalte timer, din kunde køber på forhånd. Når du registrerer tid, trækkes timerne automatisk fra saldoen. Det passer til kunder på retainer og faste månedspakker. Timerr har ikke denne funktion og fokuserer i stedet på at visualisere usynligt arbejde.",
        },
        {
          question: "Timerr koster 199 kr./md. Hvad koster TimeTrack?",
          answer: `Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms for én bruger, med klippekort, fakturagrundlag og Billy eller Dinero. Timerrs Freelancer-plan koster 199 kr./md. og har ikke klippekort eller indbygget fakturering.`,
        },
        {
          question: "Har TimeTrack Timerrs 'skjulte omkostninger'-funktion?",
          answer:
            "TimeTrack viser profitabilitet pr. projekt og kunde via dashboard-widgets. TimeTrack fokuserer på at gøre hele kundeforholdet profitabelt med klippekort og præcis fakturering, frem for én specifik visualisering.",
        },
        {
          question: "Kan jeg importere data fra Timerr til TimeTrack?",
          answer:
            "Ja. Eksportér CSV-data fra Timerr og brug TimeTracks importværktøj til at overføre tidsregistreringer, kunder og projekter.",
        },
        {
          question: "Er TimeTrack kun for freelancere?",
          answer:
            "Primært. TimeTrack er bygget til den danske freelancer med fokus på klippekort, kunder og fakturering. Men det fungerer også for små teams, der sælger deres tid.",
        },
      ]}
      ctaText="Start gratis med TimeTrack"
      relatedComparisons={[
        { name: "Effihub alternativ", href: "/effihub-alternativ" },
        { name: "TimeOps alternativ", href: "/timeops-alternativ" },
        { name: "Clockify alternativ", href: "/clockify-alternativ" },
      ]}
    />
  );
}
