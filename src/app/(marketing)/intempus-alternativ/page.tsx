import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Intempus alternativ: TimeTrack",
  description:
    "Et alternativ til Intempus for freelancere og konsulenter, med klippekort, enklere brugerflade og lavere pris for én bruger.",
  keywords: [
    "intempus alternativ",
    "intempus vs timetrack",
    "tidsregistrering konsulent",
  ],
  alternates: { canonical: "/intempus-alternativ" },
};

export default function IntempusAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Intempus",
        description:
          "Dansk tidsregistreringssystem rettet mod konsulenter og mellemstore virksomheder.",
        pricing: [
          { plan: "Standard", price: 149, period: "bruger/md" },
          { plan: "Pro", price: 199, period: "bruger/md" },
        ],
        targetAudience: "Konsulenter og mellemstore virksomheder",
        weaknesses: [
          "Ingen klippekort-funktionalitet",
          "Højere pris per bruger",
          "Kompleks UI med stejl læringskurve",
          "Overkill for freelancere",
          "Ingen moderne integrationer",
        ],
      }}
      hero={{
        title: "Et alternativ til Intempus for freelancere, med klippekort",
        subtitle:
          "Klippekort, enklere brugerflade og lavere pris for én bruger. Bygget til freelancere, ikke enterprise.",
      }}
      quickComparison={[
        {
          feature: "Pris/måned",
          us: PLAN_PRICES.selvstaendig.price,
          them: "149–199 kr. pr. bruger/md.",
        },
        { feature: "Klippekort", us: true, them: false },
        { feature: "Indbygget fakturering", us: true, them: true },
        { feature: "Moderne UI/UX", us: true, them: false },
        { feature: "Dansk support", us: true, them: true },
        { feature: "CVR-opslag", us: true, them: true },
        { feature: "Freelance-fokus", us: true, them: false },
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
            { name: "Rate history tracking", us: true, them: false },
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
        themPrice: "149–199 kr. pr. bruger/md.",
        savings:
          "Selvstændig er billigere end begge Intempus-planer for én bruger.",
      }}
      migrationSteps={[
        {
          title: "Eksportér data fra Intempus",
          description:
            "Kontakt Intempus support for at få en eksport af dine tidsregistreringer, kunder og projekter.",
        },
        {
          title: "Importér i TimeTrack",
          description:
            "Brug TimeTracks CSV-importer til at indlæse kunder, projekter og tidsregistreringer.",
        },
        {
          title: "Sæt klippekort op",
          description:
            "Konverter dine faste kunder til klippekort-modellen og få bedre overblik over forudbetalte timer.",
        },
      ]}
      faq={[
        {
          question: "Er TimeTrack billigere end Intempus?",
          answer: `Ja, for én bruger. TimeTrack Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms, mens Intempus ligger på 149–199 kr. pr. bruger/md.`,
        },
        {
          question: "Har TimeTrack enterprise-funktioner?",
          answer:
            "TimeTrack er bygget til freelancere og små teams. Hvis du har brug for enterprise-workflow med mange godkendere og komplekse rettigheder, er Intempus bedre. Til alt andet er TimeTrack enklere og billigere.",
        },
        {
          question: "Hvad er klippekort?",
          answer:
            "Klippekort er forudbetalte timer, som din kunde køber på forhånd. TimeTrack trækker automatisk timerne fra saldoen, når du registrerer tid. Det har Intempus ikke.",
        },
        {
          question: "Kan jeg importere data fra Intempus?",
          answer:
            "Ja. Kontakt Intempus support for en data-eksport, og brug TimeTracks CSV-importer til at indlæse den.",
        },
      ]}
      relatedComparisons={[
        { name: "TimeOps alternativ", href: "/timeops-alternativ" },
        { name: "Timelog alternativ", href: "/timelog-alternativ" },
        { name: "Effihub alternativ", href: "/effihub-alternativ" },
      ]}
    />
  );
}
