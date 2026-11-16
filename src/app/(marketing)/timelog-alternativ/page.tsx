import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Timelog alternativ: TimeTrack",
  description:
    "Et alternativ til Timelog for danske freelancere, med klippekort, moderne UI og uden bindingsperiode.",
  keywords: [
    "timelog alternativ",
    "timelog vs timetrack",
    "dansk tidsregistrering freelancer",
  ],
  alternates: { canonical: "/timelog-alternativ" },
};

export default function TimelogAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Timelog",
        description:
          "Dansk enterprise-tidsregistrering rettet mod store virksomheder og konsulenthuse.",
        pricing: [
          { plan: "Professional", price: 200, period: "bruger/md" },
          { plan: "Enterprise", price: 300, period: "bruger/md" },
        ],
        targetAudience: "Enterprise og store konsulenthuse",
        weaknesses: [
          "Meget dyr (200–300+ kr. pr. bruger/md.)",
          "Lange bindingskontrakter",
          "Overkill for freelancere",
          "Kompleks implementering",
          "Ingen klippekort-funktionalitet",
        ],
      }}
      hero={{
        title: "Et alternativ til Timelog for freelancere, med klippekort",
        subtitle: `Dansk kvalitet uden enterprise-kompleksitet. Klippekort, moderne UI og Selvstændig til ${PLAN_PRICES.selvstaendig.price} ekskl. moms uden binding.`,
      }}
      quickComparison={[
        {
          feature: "Pris/måned",
          us: PLAN_PRICES.selvstaendig.price,
          them: "200–300+ kr. pr. bruger/md.",
        },
        { feature: "Bindingsperiode", us: "Ingen", them: "12+ måneder" },
        { feature: "Klippekort", us: true, them: false },
        { feature: "Freelance-fokus", us: true, them: false },
        { feature: "Moderne UI/UX", us: true, them: false },
        { feature: "Dansk support", us: true, them: true },
        { feature: "CVR-opslag", us: true, them: true },
      ]}
      features={[
        {
          category: "Tidsregistrering",
          items: [
            { name: "Start/stop timer", us: true, them: true },
            { name: "Manuel registrering", us: true, them: true },
            { name: "Tags & kategorier", us: true, them: true },
            { name: "Pomodoro timer", us: true, them: false },
            { name: "Browser extension", us: true, them: false },
          ],
        },
        {
          category: "Kunde- og projektstyring",
          items: [
            { name: "Klippekort (forudbetalte timer)", us: true, them: false },
            { name: "Opgavehåndtering", us: true, them: true },
            { name: "Rate history tracking", us: true, them: true },
            { name: "Kundeportal", us: true, them: true },
          ],
        },
        {
          category: "Fakturering & integrationer",
          items: [
            { name: "Indbygget fakturering", us: true, them: true },
            { name: "Billy integration", us: true, them: false },
            { name: "Dinero integration", us: true, them: true },
            { name: "e-conomic integration", us: true, them: true },
          ],
        },
      ]}
      pricingComparison={{
        scenario: "Som freelancer med 1 bruger",
        usPrice: PLAN_PRICES.selvstaendig.price,
        themPrice: "200–300+ kr. pr. bruger/md.",
        savings: "Mindst 120 kr. mindre om måneden og ingen bindingsperiode.",
      }}
      migrationSteps={[
        {
          title: "Eksportér data fra Timelog",
          description:
            "Kontakt Timelog support for en eksport af dine tidsregistreringer, kunder og projekter.",
        },
        {
          title: "Importér til TimeTrack",
          description:
            "Upload CSV-filerne i TimeTracks importer. TimeTrack hjælper dig med at mappe felterne.",
        },
        {
          title: "Sæt klippekort op og kom i gang",
          description:
            "Opret klippekort for dine faste kunder og begynd at fakturere direkte fra TimeTrack.",
        },
      ]}
      faq={[
        {
          question: "Er TimeTrack overhovedet en reel Timelog-konkurrent?",
          answer:
            "For enterprise med 50+ brugere og komplekse godkendelsesflows er Timelog stadig stærkere. Men for freelancere og små teams er TimeTrack billigere, enklere og har klippekort, hvilket Timelog ikke har.",
        },
        {
          question: "Kan jeg importere fra Timelog?",
          answer:
            "Ja. Timelog understøtter CSV-eksport som kan importeres direkte i TimeTrack. Kontakt Timelog support for at få din data udleveret.",
        },
        {
          question: "Hvor meget kan jeg spare?",
          answer: `Timelog ligger typisk på 200–300+ kr. pr. bruger/md. med lange bindinger. TimeTrack Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms uden binding på månedsabonnementet. For en solo-freelancer er det over 1.200 kr./år i besparelse.`,
        },
        {
          question: "Hvad er klippekort?",
          answer:
            "Klippekort er forudbetalte timer, din kunde køber på forhånd. TimeTrack trækker automatisk timerne fra saldoen, når du registrerer tid. Det har Timelog ikke.",
        },
      ]}
      relatedComparisons={[
        { name: "Intempus alternativ", href: "/intempus-alternativ" },
        { name: "TimeOps alternativ", href: "/timeops-alternativ" },
        { name: "Harvest alternativ", href: "/harvest-alternativ" },
      ]}
    />
  );
}
