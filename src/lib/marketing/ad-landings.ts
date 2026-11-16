import type { OnboardingPlanTier } from "@/lib/billing/signup-plan";
import {
  AFTER_TRIAL_SOLO_SHORT,
  AFTER_TRIAL_TEAM,
  PLAN_PRICES,
  type PlanKey,
  TRIAL_DAYS,
  VAT_NOTE,
} from "@/lib/marketing/pricing-copy";

/**
 * Landingssider til Google Ads (/lp/<slug>). Én side pr. annoncegruppe, så
 * overskriften matcher søgningen, og der kun er én handling: opret konto.
 * Siderne er noindex: den organiske trafik har sine egne sider
 * (/selvstaendig, /klippekort, /virksomheder), og LP'erne må ikke
 * konkurrere med dem i Google.
 *
 * Signup-linket bærer `plan` og `ref=lp-<slug>` (se resolveSignupPlanTier),
 * og knapperne sender Plausible-eventet "CTA Click". Begge dele skal bevares.
 */
export type AdLandingSlug =
  | "tidsregistrering"
  | "freelancer"
  | "klippekort"
  | "medarbejdere";

export interface AdLanding {
  slug: AdLandingSlug;
  /** Planen onboardingen forvælger (se resolveSignupPlanTier). */
  plan: OnboardingPlanTier;
  /** Planen, hvis pris siden viser (pricing-copy.ts). */
  pricePlan: PlanKey;
  meta: { title: string; description: string };
  hero: { title: string; subtitle: string };
  /** Hvad heroen viser til højre. */
  visual: "klippekort" | "uge" | "lovkrav";
  benefits: { title: string; text: string }[];
  /** En rigtig sekvens, så den må nummereres (uden cirkler). */
  steps: string[];
  /** Ekstra værktøj midt på siden. */
  extra?: "team-prisberegner";
  faq: { question: string; answer: string }[];
}

const TRIAL_FAQ = {
  question: "Skal jeg betale for at prøve?",
  answer: `Nej. Du prøver planen gratis i ${TRIAL_DAYS} dage uden betalingskort. ${AFTER_TRIAL_SOLO_SHORT} Du mister ingen data.`,
};

const TEAM_TRIAL_FAQ = {
  question: "Hvad sker der efter prøveperioden?",
  answer: `Der kræves intet betalingskort for at prøve. ${AFTER_TRIAL_TEAM}`,
};

const BINDING_FAQ = {
  question: "Er der binding eller oprettelsesgebyr?",
  answer:
    "Nej, ikke på månedsabonnementet. Du kan opsige, når du vil. Betaler du for et år ad gangen, svarer prisen til 10 måneder. Der er intet oprettelsesgebyr.",
};

const SOLO_STEPS = [
  "Opret en konto, uden betalingskort",
  "Tilføj dine kunder, eller slå dem op via CVR",
  "Start timeren, og send fakturagrundlaget, når måneden er slut",
];

export const AD_LANDINGS: AdLanding[] = [
  {
    slug: "tidsregistrering",
    plan: "solo",
    pricePlan: "selvstaendig",
    meta: {
      title: "Dansk tidsregistrering: prøv gratis i 30 dage",
      description:
        "Registrér tid pr. kunde og projekt, og send timerne videre til faktura. Dansk support, database og backup i EU, ingen binding.",
    },
    hero: {
      title: "Tidsregistrering fra første timer til faktura",
      subtitle:
        "Start timeren i browseren, i browserudvidelsen eller på computeren. TimeTrack holder styr på tid pr. kunde og projekt og laver fakturagrundlaget.",
    },
    visual: "uge",
    benefits: [
      {
        title: "Start og stop med ét klik",
        text: "Timer i browseren, i browserudvidelsen og i desktop-appen. Glemmer du at stoppe, retter du tiden bagefter.",
      },
      {
        title: "Tid pr. kunde og projekt",
        text: "Timepriser pr. kunde eller projekt, så beløbet regner sig selv ud.",
      },
      {
        title: "Fra timer til faktura",
        text: "Send fakturagrundlaget som en kladde til Billy eller Dinero, eller hent det som PDF og CSV.",
      },
      {
        title: "Klippekort",
        text: "Sælg timer på forhånd. Tiden trækkes automatisk, og kunden kan selv se saldoen.",
      },
    ],
    steps: SOLO_STEPS,
    faq: [
      TRIAL_FAQ,
      {
        question: "Hvad koster TimeTrack?",
        answer: `Gratis med ${PLAN_PRICES.gratis.includes}. Selvstændig koster ${PLAN_PRICES.selvstaendig.price} med fakturering og klippekort. Til teams koster Team ${PLAN_PRICES.team.price} og Virksomhed ${PLAN_PRICES.virksomhed.price}. ${VAT_NOTE}`,
      },
      {
        question: "Kan jeg flytte mine data fra et andet system?",
        answer:
          "Ja. Du kan importere tidsposteringer fra CSV, og der er færdige importer fra Toggl og TimeOps.",
      },
      BINDING_FAQ,
    ],
  },
  {
    slug: "freelancer",
    plan: "solo",
    pricePlan: "selvstaendig",
    meta: {
      title: "Tidsregistrering for selvstændige: fra timer til faktura",
      description: `Registrér tid pr. kunde, og send timerne til Billy eller Dinero. Selvstændig ${PLAN_PRICES.selvstaendig.price} ekskl. moms, prøv gratis i 30 dage.`,
    },
    hero: {
      title: "Fra timer til faktura uden at gætte",
      subtitle:
        "Registrér tiden, mens du arbejder, og send et fakturagrundlag, kunden kan forstå. Ingen regneark og ingen glemte timer ved månedens udgang.",
    },
    visual: "klippekort",
    benefits: [
      {
        title: "Tid pr. kunde og projekt",
        text: "Slå kunden op via CVR, og sæt timepris pr. kunde eller projekt.",
      },
      {
        title: "Billy eller Dinero",
        text: "Overfør timerne som fakturakladde, så du ikke taster dem igen.",
      },
      {
        title: "Rapporter, du kan forklare",
        text: "Send kunden en timerapport, der viser, hvad tiden gik til.",
      },
      {
        title: "Klippekort",
        text: "Sælg timer på forhånd, og se hvor mange der er tilbage, når du registrerer tid.",
      },
    ],
    steps: SOLO_STEPS,
    faq: [
      TRIAL_FAQ,
      {
        question: "Virker det med mit regnskabsprogram?",
        answer:
          "TimeTrack overfører fakturagrundlag som kladde til Billy og Dinero. Bruger du noget andet, kan du hente timerne som PDF eller CSV.",
      },
      {
        question: "Kan jeg bruge det på flere enheder?",
        answer:
          "Ja. Timeren kører i browseren, i browserudvidelsen og i desktop-appen, og den er synkroniseret mellem dem.",
      },
      BINDING_FAQ,
    ],
  },
  {
    slug: "klippekort",
    plan: "solo",
    pricePlan: "selvstaendig",
    meta: {
      title: "Digitalt klippekort til dine kunder",
      description:
        "Sælg forudbetalte timer, og lad tiden trække automatisk fra saldoen. Kunden ser selv forbruget. Prøv gratis i 30 dage.",
    },
    hero: {
      title: "Digitalt klippekort, der trækker timerne for dig",
      subtitle:
        "Sælg en pakke timer på forhånd. Når du registrerer tid, trækkes den fra klippekortet, kunden kan selv se saldoen, og du får besked, før pakken er brugt.",
    },
    visual: "klippekort",
    benefits: [
      {
        title: "Timer trækkes automatisk",
        text: "Registrér tid på projektet, så falder saldoen. Ingen regneark.",
      },
      {
        title: "Kunden ser selv saldoen",
        text: "Kundeportalen viser forbrug og historik, så du slipper for spørgsmålene.",
      },
      {
        title: "Besked før det løber tør",
        text: "Advarsel ved lav saldo og påmindelse, før klippekortet udløber.",
      },
      {
        title: "Faktura på ny pakke",
        text: "Sælg den næste pakke, og send fakturaen som kladde til Billy eller Dinero.",
      },
    ],
    steps: [
      "Opret en konto, uden betalingskort",
      "Opret kunden og et klippekort med antal timer og pris",
      "Registrér tid som normalt. Saldoen opdaterer sig selv",
    ],
    faq: [
      TRIAL_FAQ,
      {
        question: "Hvad sker der, når klippekortet er brugt?",
        answer:
          "Du får besked, når saldoen er lav, og du vælger selv pr. klippekort, hvad der sker med tid ud over pakken: stop, fakturér den (evt. til en anden timepris), eller lad den stå som overtræk på kortet.",
      },
      {
        question: "Kan kunden se sit forbrug?",
        answer:
          "Ja. Kunden får adgang til en kundeportal med saldo og historik, og du bestemmer selv, om beløb skal vises.",
      },
      BINDING_FAQ,
    ],
  },
  {
    slug: "medarbejdere",
    plan: "business",
    pricePlan: "virksomhed",
    extra: "team-prisberegner",
    meta: {
      title: "Tidsregistrering af medarbejdere efter arbejdstidsloven",
      description: `Registrér medarbejdernes daglige arbejdstid med check ind og ud, ferie, fravær og godkendelser. Virksomhed ${PLAN_PRICES.virksomhed.price} ekskl. moms, uden oprettelsesgebyr.`,
    },
    hero: {
      title: "Tidsregistrering af medarbejdere, som loven kræver",
      subtitle:
        "Siden 1. juli 2024 skal arbejdsgivere registrere medarbejdernes daglige arbejdstid. TimeTrack gør det med check ind og ud, ferie, fravær og godkendelser i ét dansk system.",
    },
    visual: "lovkrav",
    benefits: [
      {
        title: "Check ind og ud",
        text: "Den daglige arbejdstid registreres for hver medarbejder og gemmes, så den kan dokumenteres.",
      },
      {
        title: "Ferie, fravær og flex",
        text: "Medarbejderne søger selv, og saldi for ferie, flex og overtid opdateres løbende.",
      },
      {
        title: "Godkendelser",
        text: "Ledere godkender timesedler og fravær. Alt logges.",
      },
      {
        title: "Dansk, og databasen i EU",
        text: "Dansk support, database og backup i EU og login med Microsoft Entra.",
      },
    ],
    steps: [
      "Opret virksomheden, uden betalingskort",
      "Invitér medarbejderne via mail eller Microsoft Entra",
      "Medarbejderne checker ind og ud, og I godkender",
    ],
    faq: [
      {
        question: "Er det lovpligtigt at registrere arbejdstiden?",
        answer:
          "Ja. Siden 1. juli 2024 skal arbejdsgiveren have et objektivt, pålideligt og tilgængeligt system, der måler den daglige arbejdstid for hver medarbejder (§ 4 b i arbejdstidsloven). Registreringerne skal gemmes i 5 år.",
      },
      {
        question: "Kan medarbejderne se deres egne registreringer?",
        answer:
          "Ja. Hver medarbejder ser sin egen tid, ferie og saldi, som loven kræver.",
      },
      {
        question: "Hvad koster det til vores antal medarbejdere?",
        answer: `Virksomhed koster ${PLAN_PRICES.virksomhed.price}, ${PLAN_PRICES.virksomhed.extra}. ${VAT_NOTE} Brug beregneren på siden for jeres antal.`,
      },
      TEAM_TRIAL_FAQ,
    ],
  },
];

export function getAdLanding(slug: string): AdLanding | undefined {
  return AD_LANDINGS.find((l) => l.slug === slug);
}
