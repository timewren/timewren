import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import { SUBSCRIPTION_PRICE_MONTHLY } from "@/lib/config";
import { FREE_LIMITS, kr, PLAN_PRICES } from "@/lib/marketing/pricing-copy";

// Kundeskabs priser og funktioner er tjekket på kundeskab.dk 1. oktober 2026.
// Opdatér datoen i hero-teksten, når sammenligningen tjekkes igen.
export const metadata: Metadata = {
  title: "Kundeskab alternativ: TimeTrack vs. Kundeskab",
  description:
    "TimeTrack vs. Kundeskab: begge har klippekort og Billy, Dinero og e-conomic. Se forskellene på pris, gratis plan og tidsregistrering. Sammenlignet 1. oktober 2026.",
  keywords: [
    "kundeskab alternativ",
    "kundeskab vs timetrack",
    "kundeskab pris",
    "klippekort system",
  ],
  alternates: { canonical: "/kundeskab-alternativ" },
};

export default function KundeskabAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Kundeskab",
        description:
          "Dansk CRM til selvstændige og små virksomheder med kunder, leads, tilbud, klippekort, tidsregistrering og kundeportal.",
        pricing: [
          { plan: "Månedlig", price: 189, period: "md" },
          { plan: "Årlig", price: 1890, period: "år" },
        ],
        targetAudience:
          "Selvstændige, konsulenter, håndværkere og små servicevirksomheder",
        weaknesses: [
          "Ingen gratis plan, kun 14 dages prøveperiode",
          "189 kr./md. ekskl. moms (1.890 kr./år)",
          "Hjemmesiden oplyser ikke, om prisen er pr. bruger",
          "Ingen browserudvidelse eller desktop-app nævnt",
          "Ingen lovpligtig arbejdstidsregistrering (check ind/ud) nævnt",
        ],
      }}
      hero={{
        title: "Kundeskab alternativ: TimeTrack vs. Kundeskab",
        subtitle:
          "Begge er danske og har klippekort og Billy, Dinero og e-conomic. Kundeskab er et CRM med tid. TimeTrack er tidsregistrering med fakturering, og kan startes gratis.",
      }}
      comparedAt="Sammenligningen er lavet 1. oktober 2026 ud fra Kundeskabs egne sider på kundeskab.dk."
      quickComparison={[
        {
          feature: "Pris (én bruger)",
          us: PLAN_PRICES.selvstaendig.price,
          them: "189 kr./md.",
        },
        { feature: "Gratis plan", us: "Op til 3 brugere", them: false },
        { feature: "Prøveperiode", us: "30 dage", them: "14 dage" },
        { feature: "Klippekort", us: true, them: true },
        { feature: "Billy, Dinero og e-conomic", us: true, them: true },
        { feature: "Tilbud og lead-pipeline", us: false, them: true },
        {
          feature: "Browserudvidelse og desktop-app",
          us: true,
          them: "Ikke nævnt",
        },
      ]}
      features={[
        {
          category: "Tidsregistrering",
          items: [
            { name: "Timer og manuel registrering", us: true, them: true },
            {
              name: "Fritekst (“2 timer på hjemmeside til Jensen”)",
              us: true,
              them: "Ikke nævnt",
            },
            { name: "Browserudvidelse", us: true, them: "Ikke nævnt" },
            { name: "Desktop-app", us: true, them: "Ikke nævnt" },
            { name: "Pomodoro-timer", us: true, them: "Ikke nævnt" },
          ],
        },
        {
          category: "Fakturering og klippekort",
          items: [
            { name: "Klippekort (forudbetalte timer)", us: true, them: true },
            { name: "Fakturagrundlag fra timer", us: true, them: true },
            { name: "Billy, Dinero og e-conomic", us: true, them: true },
            {
              name: "Timepris pr. kunde, projekt og medarbejder",
              us: true,
              them: "Ikke nævnt",
            },
            {
              name: "Reel timepris pr. kunde (lønsomhed)",
              us: true,
              them: "Omsætningsoverblik",
            },
          ],
        },
        {
          category: "Kunder og salg",
          items: [
            { name: "Kundedatabase med CVR-opslag", us: true, them: true },
            { name: "Kundeportal", us: true, them: true },
            { name: "Tilbud", us: false, them: true },
            { name: "Leads og salgspipeline", us: false, them: true },
            {
              name: "Serviceaftaler",
              us: "Klippekort og timebudget",
              them: true,
            },
          ],
        },
        {
          category: "Teams og virksomheder",
          items: [
            {
              name: "Pris pr. ekstra bruger",
              us: `${PLAN_PRICES.team.amount}/md. (Team)`,
              them: "Ikke oplyst",
            },
            {
              name: "Check ind/ud, ferie og fravær",
              us: "Virksomhed",
              them: "Ikke nævnt",
            },
            { name: "API og AI-adgang (MCP)", us: true, them: "Ikke nævnt" },
          ],
        },
      ]}
      pricingComparison={{
        scenario: "Selvstændig med én bruger, et år",
        usPrice: `${kr(SUBSCRIPTION_PRICE_MONTHLY * 12)}/år`,
        themPrice: "1.890 kr./år",
        savings: `${FREE_LIMITS} Selvstændig koster ${PLAN_PRICES.selvstaendig.price} ekskl. moms. Kundeskabs årspris svarer til 157,50 kr./md.`,
      }}
      migrationSteps={[
        {
          title: "Opret dine aktive kunder",
          description:
            "Hent erhvervskunder med CVR-opslag, eller importér en kundeliste som CSV. Start med de kunder, du arbejder for nu.",
        },
        {
          title: "Overfør klippekortene",
          description:
            "Opret hvert klippekort med den resterende saldo, så kunden kan fortsætte uden afbrydelse.",
        },
        {
          title: "Forbind regnskabsprogrammet",
          description:
            "Forbind Billy eller Dinero, så fakturaerne lander samme sted som i dag. Bruger du e-conomic, kan du forbinde det og bruge rapport eller CSV som fakturagrundlag.",
        },
      ]}
      faq={[
        {
          question: "Hvad er den største forskel på Kundeskab og TimeTrack?",
          answer:
            "Kundeskab er bygget som et CRM med leads, tilbud og serviceaftaler, hvor tidsregistrering er én af funktionerne. TimeTrack er bygget omkring tiden: hurtig registrering fra browser, desktop og mobil, klippekort, timepriser pr. kunde, projekt og medarbejder, og fakturering. Har du brug for tilbud og salgspipeline, har Kundeskab det, og det har TimeTrack ikke.",
        },
        {
          question: "Har begge klippekort?",
          answer:
            "Ja. Både Kundeskab og TimeTrack har klippekort med forudbetalte timer, der trækkes, når du registrerer tid. I TimeTrack kan kunden også se saldoen i kundeportalen.",
        },
        {
          question: "Hvad koster Kundeskab?",
          answer:
            "Ifølge kundeskab.dk den 1. oktober 2026 koster Kundeskab 189 kr. om måneden ekskl. moms eller 1.890 kr. om året, med 14 dages gratis prøve. Siden oplyser ikke, om prisen er pr. bruger. TimeTrack Selvstændig koster 79 kr. om måneden ekskl. moms, og Gratis dækker op til 3 brugere og 3 aktive kunder, med fakturering og klippekort.",
        },
        {
          question: "Kan jeg bruge TimeTrack i et team?",
          answer:
            "Ja. Team koster 49 kr. pr. bruger om måneden ekskl. moms og uden oprettelsesgebyr, med fælles kunder og projekter, teamoverblik og timepriser pr. medlem. Har I ansatte, der skal registrere arbejdstid efter loven, har Virksomhed check ind og ud, ferie og fravær.",
        },
      ]}
      relatedComparisons={[
        { name: "TimeOps alternativ", href: "/timeops-alternativ" },
        { name: "Tidsmester alternativ", href: "/tidsmester-alternativ" },
        { name: "Effihub alternativ", href: "/effihub-alternativ" },
      ]}
    />
  );
}
