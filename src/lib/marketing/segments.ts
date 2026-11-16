import {
  PLAN_PRICES,
  type PlanKey,
  TRIAL_DAYS,
} from "@/lib/marketing/pricing-copy";

/**
 * Målgruppe-segmenter på marketing-sitet (docs/BRAND.md §1 og §9: hvert
 * segment får sin egen hero). Selvstændige og små bureauer er tyngdepunktet;
 * Virksomhed (lovkrav) og Privat er egne spor.
 *
 * Priserne kommer fra src/lib/marketing/pricing-copy.ts (ét sted). Den
 * bindende pris og planlogik bor i billing-config og på /pricing.
 */

export type SegmentSlug =
  | "privat"
  | "selvstaendig"
  | "teams-og-bureauer"
  | "virksomheder";

/** En række i "Det får du": overskrift + én konkret sætning. */
export type SegmentPoint = { title: string; text: string };

export type Segment = {
  slug: SegmentSlug;
  path: `/${SegmentSlug}`;
  /** Kort navn til menu og links, fx "Privat". */
  label: string;
  /** Hvem det er til, én linje. */
  audience: string;
  /** Planen i prisstigen, segmentet lander på. */
  plan: PlanKey;
  hero: { title: string; subtitle: string };
  /**
   * Segmentets kerne-behov i egne ord (kunde B, 23/10-26: freelancere vil have
   * kontrol over fakturerbare timer uden bøvl og uden at tabe indtjening;
   * bureauer vil se timer pr. opgave og tabt fakturering). Vises som en kort
   * linje under hero-underoverskriften.
   */
  painPoint?: string;
  /** Hvad heroen viser til højre. */
  visual: "klippekort" | "extension" | "lovkrav" | "timer";
  /** "nedtonet" på /virksomheder, hvor trygheden leder (BRAND.md §9.3). */
  founder: "standard" | "nedtonet";
  /** Hvilken efter-prøven-tekst der gælder. */
  trial: "solo" | "team";
  points: SegmentPoint[];
  meta: { title: string; description: string };
};

export const SEGMENTS: Segment[] = [
  {
    slug: "selvstaendig",
    path: "/selvstaendig",
    label: "Selvstændige",
    audience: "Freelancere og konsulenter med kunder, klippekort og fakturaer.",
    plan: "selvstaendig",
    hero: {
      title: "Fra timer til faktura uden at gætte",
      subtitle:
        "Registrér tid pr. kunde og projekt. TimeTrack trækker timerne fra kundens klippekort og sender fakturagrundlaget som en kladde til Billy eller Dinero.",
    },
    painPoint:
      "Du vil vide, hvad du kan fakturere, uden bøvl med sedler og regneark, og uden at tabe timer, du har glemt at skrive op. Helst vil du slippe for selv at tænke på registreringen.",
    visual: "klippekort",
    founder: "standard",
    trial: "solo",
    points: [
      {
        title: "Tid pr. kunde og projekt",
        text: "Start timeren, eller skriv tiden ind bagefter. Timeprisen står på projektet eller kunden, så beløbet regner sig selv ud.",
      },
      {
        title: "Klippekort, som kunden selv kan se",
        text: "Saldo og forbrug pr. kunde, som du deler med kunden i kundeportalen.",
      },
      {
        title: "Fakturagrundlag til Billy eller Dinero",
        text: "Saml den ufakturerede tid pr. kunde, og send den som en kladde, eller hent den som PDF og CSV.",
      },
      {
        title: "Fakturerede timer låses",
        text: "Når timerne er faktureret, kan de ikke ændres bag om fakturaen.",
      },
    ],
    meta: {
      title: "Tidsregistrering til selvstændige: klippekort og faktura",
      description: `Tidsregistrering til freelancere og selvstændige: tid pr. kunde, klippekort, kundeportal og fakturagrundlag til Billy og Dinero. Selvstændig ${PLAN_PRICES.selvstaendig.price} ekskl. moms, prøv gratis i ${TRIAL_DAYS} dage.`,
    },
  },
  {
    slug: "teams-og-bureauer",
    path: "/teams-og-bureauer",
    label: "Teams og bureauer",
    audience: "Bureauer og små teams, der deler kunder og projekter.",
    plan: "team",
    hero: {
      title: "Hele holdets timer, ét sted",
      subtitle:
        "Del kunder og projekter, se hvem der har registreret hvad, og fakturér ud fra de samme tal. Folk registrerer i browseren, hvor de arbejder.",
    },
    painPoint:
      "Du vil se, hvor mange timer der går til hver opgave, og om der er fakturering, der er gledet ud mellem fingrene. Det er det, teamoverblikket er bygget til.",
    visual: "extension",
    founder: "standard",
    trial: "team",
    points: [
      {
        title: "Fælles kunder og projekter",
        text: "Alle registrerer på de samme projekter, så intet skal samles i hånden sidst på måneden.",
      },
      {
        title: "Teamoverblik pr. dag og uge",
        text: "Se hvem der har registreret hvad, og hvor der mangler tid, før det bliver et problem.",
      },
      {
        title: "Timer i browseren",
        text: "Browserudvidelsen til Chrome og Edge starter timeren fra den fane, folk arbejder i.",
      },
      {
        title: "Klippekort på tværs af holdet",
        text: "Alle trækker fra den samme saldo, og kunden ser forbruget i kundeportalen.",
      },
      {
        title: "Timepriser pr. medlem",
        text: "Forskellige satser for forskellige folk. Fakturagrundlaget bruger den rigtige pris.",
      },
      {
        title: "Faste aftaler og retainere",
        text: "Opret en fast aftale pr. kunde, og lad TimeTrack generere fakturakladden hver måned, hvert kvartal eller hvert år, automatisk.",
      },
    ],
    meta: {
      title: "Tidsregistrering til teams og bureauer",
      description: `Tidsregistrering til bureauer og små teams: fælles kunder og projekter, teamoverblik, browserudvidelse, klippekort og kundeportal. Team ${PLAN_PRICES.team.price} ekskl. moms, ${PLAN_PRICES.team.extra}.`,
    },
  },
  {
    slug: "virksomheder",
    path: "/virksomheder",
    label: "Virksomheder",
    audience:
      "Videnvirksomheder med medarbejdere, der skal registrere arbejdstid.",
    plan: "virksomhed",
    hero: {
      title: "Lovkravet og fakturagrundlaget i én registrering",
      subtitle:
        "Siden 1. juli 2024 skal danske arbejdsgivere registrere medarbejdernes daglige arbejdstid. I TimeTrack tæller de timer, medarbejderne registrerer på kunder og projekter, også med i arbejdstid og flex.",
    },
    visual: "lovkrav",
    founder: "nedtonet",
    trial: "team",
    points: [
      {
        title: "Check ind og ud",
        text: "Den daglige arbejdstid registreres med ét klik om morgenen og ét om eftermiddagen.",
      },
      {
        title: "Ferie, fravær og flex",
        text: "Medarbejderne søger selv. Saldi for ferie, flex og overtid opdateres løbende.",
      },
      {
        title: "Godkendelser og løneksport",
        text: "Lederen godkender timesedler og fravær, og lønnen eksporteres som CSV eller Excel.",
      },
      {
        title: "Microsoft-login",
        text: "Medarbejderne logger ind med deres arbejdskonto via Microsoft Entra ID.",
      },
      {
        title: "Medarbejderne ser deres egne tal",
        text: "Alle kan altid se deres egne registreringer, saldi og godkendelser.",
      },
    ],
    meta: {
      title: "Tidsregistrering af medarbejdere: arbejdstid, ferie og fravær",
      description: `Registrering af arbejdstid efter loven, sammen med timerne på kunderne: check ind og ud, ferie, fravær, flex, godkendelser, løneksport og Microsoft-login. Virksomhed ${PLAN_PRICES.virksomhed.price} ekskl. moms.`,
    },
  },
  {
    slug: "privat",
    path: "/privat",
    label: "Privat",
    audience: "Studier, sideprojekter og frivilligt arbejde.",
    plan: "privat",
    hero: {
      title: "Se, hvor din tid går hen",
      subtitle:
        "Registrér tid på studier, sideprojekter og frivilligt arbejde. Prøv timeren her, uden konto. Vil du gemme timerne, er Gratis nok til de fleste.",
    },
    visual: "timer",
    founder: "standard",
    trial: "solo",
    points: [
      {
        title: "Studier og læsning",
        text: "Se hvor mange timer du bruger pr. fag eller opgave, og om planen holder.",
      },
      {
        title: "Sideprojekter",
        text: "Et projekt pr. ting du laver. Ugens og månedens tid står samlet ét sted.",
      },
      {
        title: "Frivilligt arbejde",
        text: "Dokumentér dine timer i foreningen, hvis nogen spørger.",
      },
      {
        title: "Start og stop med ét klik",
        text: "I browseren, i browserudvidelsen eller på computeren. Glemte du at starte, retter du tiden bagefter.",
      },
    ],
    meta: {
      title: "Tidsregistrering til privatpersoner: studier og sideprojekter",
      description: `Registrér tid på studier, sideprojekter og frivilligt arbejde. Prøv timeren uden konto. Gratis med 3 kunder, eller Privat ${PLAN_PRICES.privat.price} ekskl. moms.`,
    },
  },
];

export function getSegment(slug: SegmentSlug): Segment {
  const segment = SEGMENTS.find((s) => s.slug === slug);
  if (!segment) throw new Error(`Ukendt segment: ${slug}`);
  return segment;
}
