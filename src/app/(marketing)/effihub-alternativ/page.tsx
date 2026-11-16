import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { PLAN_PRICES, VAT_NOTE } from "@/lib/marketing/pricing-copy";

/*
 * Fakta om Effihub (wiki entities/tools/effihub.md, verificeret på
 * effihub.com 6/9 og 11/10-2026): Effihub kører stadig, ejerskiftet til
 * Effi Tech ApS blev annonceret i september 2025, prisen er 149 kr./md.
 * (månedlig) eller 124 kr./md. (årlig), ekskl. moms. Browserudvidelse
 * nævnes ikke på effihub.com. Skriv kun det, der kan dokumenteres, og
 * skriv aldrig, at Effihub er lukket.
 */

const TITLE = `Effihub alternativ: TimeTrack med klippekort fra ${PLAN_PRICES.selvstaendig.price}`;
const DESCRIPTION =
  "Sammenlign Effihub og TimeTrack: klippekort, kundeportal, browserudvidelse og import af dine Effihub-data. Prøv TimeTrack gratis i 30 dage, uden binding på månedsabonnementet.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION },
  keywords: [
    "effihub alternativ",
    "effihub vs timetrack",
    "klippekort system",
    "dansk tidsregistrering freelancer",
  ],
  alternates: { canonical: "/effihub-alternativ" },
};

export default function EffihubAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Effihub",
        description:
          "Dansk system til projektstyring og tidsregistrering med klippekort, Kanban, kundeportal og fakturagrundlag. Effihub fortsætter med en ny ejer, Effi Tech ApS, efter et ejerskifte i september 2025.",
        pricing: [
          { plan: "Månedlig", price: 149, period: "md." },
          { plan: "Årlig", price: 124, period: "md. (faktureres årligt)" },
        ],
        targetAudience:
          "Konsulenter, webdesignere, tekstforfattere, grafikere og andre kreative fagfolk",
        weaknesses: [
          "Ingen browserudvidelse nævnt på effihub.com",
          "Ingen gratis plan efter prøveperioden",
          `149 kr./md. mod ${PLAN_PRICES.selvstaendig.price} for Selvstændig i TimeTrack (begge ekskl. moms)`,
        ],
      }}
      hero={{
        title: "Et alternativ til Effihub, med klippekort og browserudvidelse",
        subtitle:
          "Effihub og TimeTrack har meget til fælles: klippekort, kundeportal og Billy, Dinero og e-conomic. TimeTrack koster mindre for én bruger og har en browserudvidelse, så du kan starte timeren, hvor du arbejder.",
      }}
      quickComparison={[
        {
          feature: "Pris for én bruger (månedlig)",
          us: PLAN_PRICES.selvstaendig.price,
          them: "149 kr./md.",
        },
        { feature: "Klippekort", us: true, them: true },
        { feature: "Kundeportal med eget logo", us: true, them: true },
        { feature: "Billy, Dinero og e-conomic", us: true, them: true },
        { feature: "Kanban", us: true, them: true },
        { feature: "Browserudvidelse", us: true, them: "Ikke nævnt" },
        { feature: "Gratis plan efter prøven", us: true, them: false },
      ]}
      features={[
        {
          category: "Klippekort og fakturering",
          items: [
            { name: "Klippekort (forudbetalte timer)", us: true, them: true },
            { name: "Billy", us: true, them: true },
            { name: "Dinero", us: true, them: true },
            { name: "e-conomic", us: true, them: true },
          ],
        },
        {
          category: "Projekter og opgaver",
          items: [
            { name: "Opgaveliste", us: true, them: true },
            { name: "Kanban", us: true, them: true },
            { name: "CVR-opslag på kunder", us: true, them: "Ikke nævnt" },
            { name: "Historik over timepriser", us: true, them: "Ikke nævnt" },
          ],
        },
        {
          category: "Integrationer",
          items: [
            {
              name: "Browserudvidelse til Chrome og Edge",
              us: true,
              them: "Ikke nævnt",
            },
            { name: "Webhooks", us: true, them: "Ikke nævnt" },
            { name: "Zapier, Make og n8n", us: true, them: "Ikke nævnt" },
            { name: "Offentligt API", us: true, them: "Ikke nævnt" },
          ],
        },
      ]}
      pricingComparison={{
        scenario: "Én bruger, månedlig betaling, ekskl. moms",
        usPrice: PLAN_PRICES.selvstaendig.price,
        themPrice: "149 kr./md.",
        savings: `70 kr. mindre om måneden. ${VAT_NOTE}`,
      }}
      migrationSteps={[
        {
          title: "Eksportér dine data fra Effihub",
          description:
            "Hent dine kunder, brugere, opgaver og klippekort som filer fra Effihub.",
        },
        {
          title: "Importér dem i TimeTrack",
          description:
            "TimeTrack har en import til Effihub-filer under Integrationer. Den opretter kunder, klippekort og tidsregistreringer.",
        },
        {
          title: "Forbind dit regnskab",
          description:
            "Forbind Billy eller Dinero, så fakturagrundlaget kan sendes som en kladde.",
        },
      ]}
      faq={[
        {
          question: "Kan jeg importere mine klippekort fra Effihub?",
          answer:
            "Ja. Importen under Integrationer læser Effihubs eksportfiler og opretter kunder, klippekort og tidsregistreringer i TimeTrack.",
        },
        {
          question:
            "Effihub og TimeTrack har begge klippekort. Hvad er forskellen?",
          answer:
            "Begge holder styr på forudbetalte timer og viser dem i en kundeportal. TimeTrack har desuden en browserudvidelse, en gratis plan efter prøveperioden og en lavere pris for én bruger.",
        },
        {
          question: "Har TimeTrack Kanban?",
          answer:
            "Ja. Opgaver kan vises som liste eller som Kanban med træk og slip.",
        },
        {
          question: "Kører Effihub stadig?",
          answer:
            "Ja. Effihub fik en ny ejer, Effi Tech ApS, i september 2025 og fortsætter. Du behøver ikke skifte, men vil du prøve TimeTrack, kan du importere dine data og bruge begge i prøveperioden.",
        },
        {
          question: "Hvad koster TimeTrack?",
          answer: `Selvstændig koster ${PLAN_PRICES.selvstaendig.price} for én bruger, Team ${PLAN_PRICES.team.price}. ${VAT_NOTE} Du kan prøve alle funktioner i 30 dage uden betalingskort.`,
        },
      ]}
      ctaText="Prøv gratis i 30 dage"
      relatedComparisons={[
        { name: "Timerr alternativ", href: "/timerr-alternativ" },
        { name: "TimeOps alternativ", href: "/timeops-alternativ" },
        { name: "Clockify alternativ", href: "/clockify-alternativ" },
      ]}
    />
  );
}
