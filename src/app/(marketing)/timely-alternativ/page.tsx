import type { Metadata } from "next";
import { CompetitorComparisonPage } from "@/components/marketing/CompetitorComparisonPage";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-limits";
import {
  SUBSCRIPTION_PRICE_MONTHLY,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";
import { kr } from "@/lib/marketing/pricing-copy";

// Timelys egne sider (timely.com: /pricing, /timely-features) er gennemgået
// 1/10-2026. Siden handler om tidsregistreringen Timely fra Timely AS i Oslo
// – ikke bookingsystemet Timely (gettimely.com) eller time.ly. Opdatér datoen
// og tabellen, når siden revideres.
const COMPARED_AT =
  "Sammenligningen er lavet 1. oktober 2026 ud fra Timelys egne sider på timely.com. Priserne er Timelys listepriser i dollar ekskl. moms.";

const TITLE = "Timely alternativ på dansk med klippekort og Billy";
const DESCRIPTION =
  "Timely er automatisk tidsregistrering fra Norge med priser i dollar. TimeTrack er dansk, har en gratis plan, klippekort og fakturering via Billy eller Dinero samt integration med e-conomic. Ærlig sammenligning.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | TimeTrack` },
  description: DESCRIPTION,
  keywords: [
    "timely alternativ",
    "timely tidsregistrering",
    "timely vs timetrack",
    "automatisk tidsregistrering",
  ],
  alternates: { canonical: "/timely-alternativ" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/timely-alternativ",
    type: "article",
  },
};

export default function TimelyAlternativPage() {
  return (
    <CompetitorComparisonPage
      competitor={{
        name: "Timely",
        description:
          "Automatisk tidsregistrering til konsulenthuse og bureauer fra Timely AS i Oslo (timely.com). Ikke at forveksle med bookingsystemet af samme navn. På engelsk med priser i dollar.",
        pricing: [
          {
            plan: "Starter",
            price: 9,
            period: "USD/bruger/md (årligt, maks. 5 brugere)",
          },
          {
            plan: "Premium",
            price: 16,
            period: "USD/bruger/md (årligt, maks. 50 brugere)",
          },
          { plan: "Unlimited", price: 22, period: "USD/bruger/md (årligt)" },
        ],
        targetAudience:
          "Konsulenthuse og bureauer, der vil have tiden registreret automatisk ud fra det arbejde, der sker på computeren",
        weaknesses: [
          "Ingen gratis plan, kun 14 dages prøveperiode",
          "Ingen integration med Billy, Dinero eller e-conomic",
          "Ingen klippekort eller forudbetalte timer",
          "Kun på engelsk og med priser i dollar",
        ],
      }}
      hero={{
        title: "Timely eller TimeTrack?",
        subtitle:
          "Timely er stærk til automatisk tidsregistrering og planlægning af kapacitet. TimeTrack er dansk, har en gratis plan og gør timerne til fakturaer i Billy eller Dinero, med fakturagrundlag til e-conomic og klippekort, der trækkes automatisk.",
      }}
      comparedAt={COMPARED_AT}
      quickComparison={[
        {
          feature: "Gratis plan",
          us: `Op til ${FREE_MAX_SEATS} brugere`,
          them: "Nej, 14 dages prøve",
        },
        {
          feature: "Automatisk tidsregistrering",
          us: "I desktop-appen",
          them: true,
        },
        { feature: "Fakturering", us: true, them: true },
        { feature: "Billy, Dinero og e-conomic", us: true, them: false },
        { feature: "Klippekort (forudbetalte timer)", us: true, them: false },
        { feature: "Dansk sprog og priser i kroner", us: true, them: false },
        { feature: "Kapacitetsplanlægning", us: false, them: "I Unlimited" },
      ]}
      features={[
        {
          category: "Fra timer til betaling",
          items: [
            { name: "Faktura ud fra registrerede timer", us: true, them: true },
            {
              name: "Integration med Billy, Dinero og e-conomic",
              us: true,
              them: false,
            },
            { name: "QuickBooks Online", us: false, them: "Premium og op" },
            { name: "Klippekort med automatisk træk", us: true, them: false },
            { name: "CVR-opslag på kunder", us: true, them: false },
            { name: "Kundeportal", us: true, them: false },
          ],
        },
        {
          category: "Tidsregistrering og team",
          items: [
            { name: "Timer og manuel registrering", us: true, them: true },
            {
              name: "Automatisk registrering ud fra aktivitet",
              us: "I desktop-appen",
              them: true,
            },
            { name: "Godkendelse af timer", us: true, them: true },
            { name: "Projektbudgetter", us: true, them: true },
            { name: "Kapacitetsplanlægning", us: false, them: "I Unlimited" },
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
            { name: "Mac og Windows", us: true, them: true },
            { name: "iPhone og iPad", us: true, them: true },
            { name: "Android", us: "Kommer snart", them: true },
            { name: "Browserudvidelse", us: true, them: "Chrome (via Memory)" },
          ],
        },
      ]}
      pricingTitle="Hvad koster det for et team på fem?"
      pricingComparison={{
        scenario: "Fem personer, der registrerer og fakturerer timer",
        usPrice: `${kr(TEAM_SEAT_PRICE_MONTHLY * 5)}/md. (Team)`,
        themPrice: "80 USD/md. (Premium, årlig betaling)",
        savings:
          "Sammenlign selv i dagens kurs. Timelys Starter er billigere, men har højst 20 projekter",
      }}
      migrationSteps={[
        {
          title: "Eksportér dine timer fra Timely",
          description:
            "Træk en rapport over dine registrerede timer ud som regneark.",
        },
        {
          title: "Opret kunder og importér timerne",
          description:
            "Opret dine kunder i TimeTrack (CVR-opslag udfylder oplysningerne), og importér timerne under Tidsregistrering, eller start forfra fra i dag.",
        },
        {
          title: "Forbind dit regnskabsprogram",
          description:
            "Forbind Billy eller Dinero, og lav din første faktura direkte ud fra de registrerede timer. Bruger du e-conomic, kan du forbinde det og bruge rapport eller CSV som fakturagrundlag.",
        },
      ]}
      faq={[
        {
          question: "Hvilket Timely handler siden om?",
          answer:
            "Tidsregistreringsprogrammet Timely fra Timely AS i Oslo (timely.com), som registrerer tid automatisk. Der findes også et bookingsystem til saloner og en eventplatform med samme navn. Dem er ikke med i sammenligningen.",
        },
        {
          question: "Kan TimeTrack registrere tid automatisk som Timely?",
          answer:
            "Delvist. TimeTracks desktop-app til Mac og Windows kan registrere, hvilke programmer du arbejder i. Timelys automatiske registrering er mere moden og er med i alle deres planer. Er automatisk registrering det vigtigste for jer, er Timely et godt valg.",
        },
        {
          question: "Hvad koster TimeTrack?",
          answer: `Gratis dækker op til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} aktive kunder. Selvstændig koster ${SUBSCRIPTION_PRICE_MONTHLY} kr. om måneden, og Team koster ${TEAM_SEAT_PRICE_MONTHLY} kr. pr. bruger om måneden ekskl. moms. Timely har ingen gratis plan og koster fra 9 dollar pr. bruger om måneden ved årlig betaling.`,
        },
        {
          question: "Kan Timely fakturere til Billy eller e-conomic?",
          answer:
            "Timely kan lave fakturaer og i Premium og Unlimited sende dem til QuickBooks Online, men nævner ikke danske regnskabsprogrammer. I TimeTrack bliver timerne til en faktura i Billy eller Dinero, og e-conomic kan forbindes og bruges til fakturagrundlag.",
        },
        {
          question: "Hvad er Timely bedre til?",
          answer:
            "Automatisk registrering ud fra aktivitet på computeren, modne apps på alle platforme og planlægning af kapacitet på tværs af et team. Er det jeres behov, og fakturerer I ikke via et dansk regnskabsprogram, kan Timely være det rigtige valg.",
        },
      ]}
      ctaText="Prøv dansk tidsregistrering gratis"
      relatedComparisons={[
        { name: "Toggl alternativ", href: "/toggl-alternativ" },
        { name: "Harvest alternativ", href: "/harvest-alternativ" },
        { name: "Clockify alternativ", href: "/clockify-alternativ" },
        { name: "Desktop-app", href: "/desktop" },
      ]}
    />
  );
}
