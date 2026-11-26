import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-limits";
import { PLAN_PRICES } from "@/lib/marketing/pricing-copy";

// Hourticks egne sider (hourtick.com: /pricing, /platforms,
// /features/invoiced-tracking, /compare/hourtick-vs-harvest, /company) er
// gennemgået 1/10-2026. Produktet er nyt og ændrer sig ofte, så opdatér
// datoen og tabellen, når siden revideres.
const COMPARED_AT =
  "Sammenligningen er lavet 1. oktober 2026 ud fra Hourticks egne sider på hourtick.com.";

const TITLE = "Hourtick alternativ med fakturering og klippekort";
const DESCRIPTION =
  "Hourtick er gratis tidsregistrering for ubegrænset antal brugere, men laver ikke fakturaer. TimeTrack gør timerne til fakturaer i Billy eller Dinero og har klippekort. Ærlig sammenligning.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | TimeTrack` },
  description: DESCRIPTION,
  keywords: [
    "hourtick alternativ",
    "hourtick vs timetrack",
    "gratis tidsregistrering",
    "tidsregistrering med fakturering",
  ],
  alternates: { canonical: "/hourtick-alternativ" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/hourtick-alternativ",
    type: "article",
  },
};

export default function HourtickAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Hourtick",
        description:
          "Tidsregistrering, opgaver og teamchat bygget omkring AI-agenter. Drives af WeCode A/S i København og er på engelsk med priser i dollar.",
        pricing: [
          { plan: "Free", price: 0, period: "md (500 MB forbrug)" },
          { plan: "Pro", price: 29, period: "USD/md (5 GB forbrug)" },
        ],
        targetAudience:
          "Teams og bureauer, der vil registrere tid, styre opgaver og chatte ét sted, og som fakturerer i et andet program",
        weaknesses: [
          "Laver ikke fakturaer (kun markering af tid som faktureret)",
          "Ingen klippekort eller forudbetalte timer",
          "Ingen integration med Billy eller Dinero",
          "Kun på engelsk",
          "Ingen Windows-app, ingen Android-app og ingen browserudvidelse",
        ],
      }}
      hero={{
        title: "Hourtick eller TimeTrack?",
        subtitle:
          "Hourtick er gratis for et helt team og stærk til opgaver, chat og AI-agenter. Men den laver ikke fakturaer. TimeTrack gør dine timer til fakturaer i Billy eller Dinero og trækker automatisk fra kundens klippekort.",
      }}
      comparedAt={COMPARED_AT}
      quickComparison={[
        {
          feature: "Pris for et team",
          us: `Gratis op til ${FREE_MAX_SEATS} brugere`,
          them: "Gratis for ubegrænset antal brugere",
        },
        { feature: "Fakturering", us: true, them: false },
        { feature: "Klippekort (forudbetalte timer)", us: true, them: false },
        { feature: "Billy og Dinero", us: true, them: false },
        { feature: "Dansk sprog", us: true, them: false },
        { feature: "Teamchat", us: false, them: true },
        { feature: "AI-agenter som teammedlemmer", us: false, them: true },
        { feature: "MCP og REST API", us: true, them: true },
      ]}
      features={[
        {
          category: "Fra timer til betaling",
          items: [
            {
              name: "Faktura ud fra registrerede timer",
              us: true,
              them: false,
            },
            { name: "Markér tid som faktureret", us: true, them: true },
            { name: "Klippekort med automatisk træk", us: true, them: false },
            {
              name: "Fakturaer til Billy eller Dinero",
              us: true,
              them: false,
            },
            { name: "CVR-opslag på kunder", us: true, them: false },
            { name: "Kundeportal", us: true, them: false },
          ],
        },
        {
          category: "Tidsregistrering og team",
          items: [
            { name: "Timer og manuel registrering", us: true, them: true },
            { name: "Timepriser pr. kunde og projekt", us: true, them: true },
            { name: "Godkendelse af timesedler", us: true, them: true },
            { name: "Opgaver og kanban", us: true, them: true },
            { name: "Teamchat med kanaler og tråde", us: false, them: true },
            {
              name: "Ferie, fravær og flex (Virksomhed)",
              us: true,
              them: false,
            },
          ],
        },
        {
          category: "Platforme",
          items: [
            { name: "Web", us: true, them: true },
            { name: "Mac", us: true, them: true },
            { name: "Windows-app", us: true, them: "Kun browser" },
            { name: "iPhone", us: true, them: "På vej" },
            { name: "Android", us: "Kommer snart", them: false },
            { name: "Browserudvidelse", us: true, them: false },
          ],
        },
        {
          category: "AI og API",
          items: [
            { name: "MCP-server til din AI-assistent", us: true, them: true },
            { name: "REST API med OpenAPI", us: true, them: true },
            { name: "Webhooks", us: true, them: "Ikke nævnt" },
            {
              name: "AI-agenter tildeles opgaver og logger egen tid",
              us: false,
              them: true,
            },
          ],
        },
      ]}
      pricingTitle="Hvad koster det?"
      pricingComparison={{
        scenario: "Selvstændig, der fakturerer sine timer",
        usPrice: PLAN_PRICES.selvstaendig.price,
        themPrice: "0 kr.",
        savings:
          "Hourtick er billigst, men fakturaen skal laves i et andet program",
      }}
      migrationSteps={[
        {
          title: "Eksportér dine timer fra Hourtick",
          description:
            "Hourtick kan eksportere tidsregistreringer som CSV-fil.",
        },
        {
          title: "Opret kunder og importér timerne",
          description:
            "Opret dine kunder i TimeTrack (CVR-opslag udfylder oplysningerne), og importér CSV-filen under Tidsregistrering, eller start forfra i dag.",
        },
        {
          title: "Forbind dit regnskabsprogram",
          description:
            "Forbind Billy eller Dinero, og lav din første faktura direkte ud fra de registrerede timer.",
        },
      ]}
      faq={[
        {
          question:
            "Hourtick er gratis for hele teamet. Hvorfor betale for TimeTrack?",
          answer: `Hvis I kun skal registrere tid, er Hourtick et godt gratis valg, og TimeTracks Gratis-plan dækker også op til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} kunder. Forskellen kommer, når timerne skal faktureres. Hourtick skriver selv, at den ikke laver fakturaer. I TimeTrack bliver timerne til en faktura i Billy eller Dinero, og klippekort trækkes automatisk.`,
        },
        {
          question: "Hvad koster TimeTrack for et team?",
          answer: `Team koster ${PLAN_PRICES.team.price} ekskl. moms. Hourtick koster 0 kr. eller 29 dollar om måneden uanset antal brugere. På ren tidsregistrering til et stort team er Hourtick billigere, og det skal du vide.`,
        },
        {
          question: "Har Hourtick klippekort?",
          answer:
            "Nej, ikke ifølge deres egne sider. I TimeTrack køber kunden en pakke timer på forhånd, og hver registrering trækker fra saldoen, så både du og kunden kan se, hvad der er tilbage.",
        },
        {
          question: "Hvad er Hourtick bedre til?",
          answer:
            "Teamchat, opgaver og AI-agenter, der kan få tildelt opgaver og logge deres egen tid. Har I brug for chat og opgaver ét sted og fakturerer i forvejen et andet sted, kan Hourtick være det rigtige valg.",
        },
        {
          question: "Kan jeg bruge min AI-assistent med TimeTrack?",
          answer:
            "Ja. TimeTrack har en MCP-server og et REST API, så din AI-assistent kan registrere tid og lave fakturakladder ud fra timerne. Læs mere på siden om AI-assistenter.",
        },
      ]}
      ctaText="Lad dine timer blive til fakturaer"
      relatedComparisons={[
        { name: "Gratis tidsregistrering", href: "/gratis-tidsregistrering" },
        { name: "Harvest alternativ", href: "/harvest-alternativ" },
        { name: "Toggl alternativ", href: "/toggl-alternativ" },
        { name: "Clockify alternativ", href: "/clockify-alternativ" },
      ]}
    />
  );
}
