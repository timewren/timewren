import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

export const metadata: Metadata = {
  title: "Tidsmester alternativ: TimeTrack til selvstændige og små bureauer",
  description:
    "Tidsmester er til SMV-lønstyring og EU-compliance. TimeTrack er til selvstændige med klippekort, fakturering og kundeoverblik. Find ud af hvad du har brug for.",
  keywords: [
    "tidsmester alternativ",
    "tidsmester vs timetrack",
    "tidsregistrering freelancer",
    "klippekort system",
  ],
  alternates: { canonical: "/tidsmester-alternativ" },
};

export default function TidsmesterAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Tidsmester",
        description:
          "Dansk compliance-fokuseret tidsregistrering til SMV (2-200 medarbejdere). Specialiseret i EU-arbejdstidsdirektivet og lovpligtig 5-års backup.",
        pricing: [
          { plan: "Basis", price: 10, period: "bruger/md" },
          { plan: "Standard", price: 15, period: "bruger/md" },
          { plan: "Pro", price: 30, period: "bruger/md" },
        ],
        targetAudience:
          "Små danske virksomheder (2-200 ansatte) i byggeri, retail, kontor, fabrik og andre brancher",
        weaknesses: [
          "Ingen klippekort eller forudbetalte timepakker",
          "Ingen fakturering eller kundeoverblik",
          "Ingen Billy/Dinero/e-conomic integration (kun rå API)",
          "Ingen AI-features",
          "Ingen browser extension",
          "Ikke bygget til freelancere, mangler kunderelationer",
          "Fokus på compliance, ikke på at tjene penge",
        ],
      }}
      hero={{
        title: "Tidsmester eller TimeTrack: hvad har du brug for?",
        subtitle:
          "Tidsmester dækker lønstyring og EU-compliance for ansatte. TimeTrack dækker kundearbejde, klippekort og fakturering for freelancere. Det er to forskellige behov.",
      }}
      quickComparison={[
        {
          feature: "Primær målgruppe",
          us: "Freelancere & konsulenter",
          them: "SMV med ansatte",
        },
        { feature: "Klippekort", us: true, them: false },
        { feature: "Fakturering", us: true, them: false },
        { feature: "Kundeoverblik", us: true, them: false },
        {
          feature: "Billy/Dinero/e-conomic",
          us: true,
          them: "Kun rå API",
        },
        {
          feature: "EU-arbejdstidsdirektiv compliance",
          us: false,
          them: true,
        },
        { feature: "Lovpligtig 5-års backup", us: false, them: true },
        { feature: "AI email-to-task", us: true, them: false },
        { feature: "Browser extension", us: true, them: false },
      ]}
      features={[
        {
          category: "Freelancer-behov",
          items: [
            { name: "Klippekort (forudbetalte timer)", us: true, them: false },
            { name: "Fakturering", us: true, them: false },
            { name: "Kundeoverblik", us: true, them: false },
            { name: "Projektstyring", us: true, them: "Basis" },
            { name: "Klippekort-saldo til kunden", us: true, them: false },
          ],
        },
        {
          category: "SMV/compliance-behov",
          items: [
            {
              name: "EU-arbejdstidsdirektiv compliance",
              us: false,
              them: true,
            },
            { name: "Lovpligtig 5-års backup", us: false, them: true },
            {
              name: "Stempelur / kiosk-tilstand",
              us: false,
              them: true,
            },
            { name: "CSV-eksport til lønsystem", us: "Delvis", them: true },
            { name: "E-mail ved lovbrud", us: false, them: true },
          ],
        },
        {
          category: "Integrationer & AI",
          items: [
            { name: "Billy integration", us: true, them: false },
            { name: "Dinero integration", us: true, them: false },
            { name: "e-conomic integration", us: true, them: false },
            { name: "AI email-to-task", us: true, them: false },
            { name: "Browser extension", us: true, them: false },
            { name: "Webhooks & API", us: true, them: "Pro-plan" },
          ],
        },
      ]}
      pricingComparison={{
        scenario: "1 freelancer vs. 1 medarbejder",
        usPrice: PLAN_PRICES.selvstaendig.price,
        themPrice: "10–30 kr. pr. bruger/md.",
        savings:
          "Tidsmester er billigst pr. bruger, men mangler det, du har brug for som freelancer.",
      }}
      migrationSteps={[
        {
          title: "Eksportér dine tidsregistreringer fra Tidsmester",
          description:
            "Brug Tidsmester CSV-eksport til at hente dine tidsregistreringer og projekter.",
        },
        {
          title: "Importér til TimeTrack",
          description:
            "Upload CSV-filerne i TimeTracks importværktøj. Vælg de projekter og perioder du vil overføre.",
        },
        {
          title: "Opret kunder og sæt klippekort op",
          description:
            "Tilføj dine kunder, forbind Billy eller Dinero og opret klippekort for dine faste retainer-kunder.",
        },
      ]}
      faq={[
        {
          question: "Er Tidsmester og TimeTrack egentlig konkurrenter?",
          answer:
            "Kun delvist. Tidsmester er bygget til SMV-virksomheder med ansatte, der skal overholde EU-arbejdstidsdirektivet. TimeTrack er bygget til freelancere og konsulenter der sælger tid til kunder via klippekort og fakturering. Mange brugere har præcis ét behov, ikke begge.",
        },
        {
          question: "Tidsmester er meget billigere. Hvorfor vælge TimeTrack?",
          answer: `Tidsmester koster 10–30 kr. pr. bruger/md., men har ingen fakturering, ingen klippekort og intet kundeoverblik. Som freelancer er din forretning bygget på kundeforhold og fakturering, og det understøtter Tidsmester ikke. TimeTrack Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms og har klippekort og fakturagrundlag til Billy eller Dinero.`,
        },
        {
          question: "Hvad er klippekort, og har Tidsmester det?",
          answer:
            "Klippekort er forudbetalte timer, din kunde køber på forhånd. Når du registrerer tid, trækkes timerne automatisk fra saldoen. Det passer til kunder på retainer og faste månedspakker. Tidsmester har ikke denne funktion.",
        },
        {
          question: "Kan jeg overholde EU-arbejdstidsdirektivet med TimeTrack?",
          answer:
            "TimeTrack registrerer al arbejdstid og kan eksportere rapporter. Til specialiseret EU-compliance med juridisk backup og stempelursmodul er Tidsmester bedre egnet til virksomheder med mange ansatte. For freelancere er EU-direktivet sjældent relevant.",
        },
        {
          question: "Hvad hvis jeg er freelancer OG har ansatte?",
          answer:
            "Så har du brug for begge: TimeTrack til kunderelationer, klippekort og fakturering, og eventuelt Tidsmester eller et lønsystem til dine ansattes fremmøderegistrering.",
        },
      ]}
      ctaText="Start gratis med TimeTrack"
      relatedComparisons={[
        { name: "Timerr alternativ", href: "/timerr-alternativ" },
        { name: "Effihub alternativ", href: "/effihub-alternativ" },
        { name: "TimeOps alternativ", href: "/timeops-alternativ" },
      ]}
    />
  );
}
