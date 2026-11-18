import type forms from "@/i18n/messages/da/forms.json";
import type { Calculation } from "./seo-calculations";

type CalculatorMessages = typeof forms.calculator;

export type ToolField = {
  label: keyof CalculatorMessages["labels"];
  initial: number;
  min?: number;
  max?: number;
  whole?: boolean;
};

export type ToolResult = {
  label: keyof CalculatorMessages["labels"];
  unit: keyof CalculatorMessages["units"];
};

type SeoTool = {
  slug: string;
  calculation: Calculation;
  title: string;
  metaTitle: string;
  description: string;
  fields: ToolField[];
  results: ToolResult[];
  example: string;
  faq: { question: string; answer: string }[];
  related: { href: string; title: string; description: string };
  source?: { href: string; label: string };
};

export const seoTools = {
  overtime: {
    slug: "overarbejde-beregner",
    calculation: "overtime",
    title: "Beregn overarbejde og overtidstillæg",
    metaTitle: "Overarbejde beregner med overtidstillæg",
    description:
      "Beregn overarbejde ud fra dine arbejdstimer, normtimer, timeløn og aftalte tillæg. Se antal overtimer og den samlede betaling før skat.",
    fields: [
      { label: "workedAfterBreaks", initial: 42 },
      { label: "periodNorm", initial: 37 },
      { label: "hourlyWage", initial: 200 },
      { label: "overtimePremium", initial: 50 },
    ],
    results: [
      { label: "overtimeHours", unit: "hours" },
      { label: "grossOvertimePay", unit: "currency" },
    ],
    example:
      "Arbejder du 42 timer på en 37-timers uge, er forskellen 5 timer. Med 200 kr. i timen og 50 % tillæg er hver overarbejdstime 300 kr. værd. Det giver 1.500 kr. for overtimerne, inklusive deres grundløn.",
    faq: [
      {
        question: "Hvilken sats skal jeg bruge?",
        answer:
          "Find satsen og grænsen for overarbejde i din aftale. De 50 % i eksemplet er en valgt sats. Har du flere satser, så del overtimerne op og beregn betalingen for hver gruppe.",
      },
      {
        question: "Hvad hvis timerne skal afspadseres?",
        answer:
          "Brug timeforskellen som udgangspunkt. Hvis din aftale giver 1,5 times afspadsering pr. overarbejdstime, svarer 5 overtimer til 7,5 timer fri.",
      },
    ],
    related: {
      href: "/arbejdstimer-pr-maaned",
      title: "Find månedens normtimer",
      description: "Se normtimer ved fuldtid og deltid.",
    },
  },
  holiday: {
    slug: "feriepenge-beregner",
    calculation: "holiday",
    title: "Beregn feriepenge som timelønnet",
    metaTitle: "Feriepenge beregner for timelønnede",
    description:
      "Beregn 12,5 % feriepenge af din ferieberettigede løn. Indtast arbejdstimer, timeløn og tillæg, og se beløbet før skat.",
    fields: [
      { label: "periodHours", initial: 80 },
      { label: "hourlyWage", initial: 180 },
      { label: "holidayPaySupplements", initial: 400 },
    ],
    results: [
      { label: "holidayPayWages", unit: "currency" },
      { label: "grossHolidayPay", unit: "currency" },
    ],
    example:
      "80 timer til 180 kr. giver 14.400 kr. Med 400 kr. i ferieberettigede tillæg bliver grundlaget 14.800 kr. Gang det med 0,125 for at få 1.850 kr. i feriepenge før skat.",
    faq: [
      {
        question: "Hvilke tillæg skal jeg tage med?",
        answer:
          "Brug de ferieberettigede beløb fra lønsedlen. Faste tillæg og overarbejdsbetaling kan indgå. Har du arbejdet til flere satser, skal du beregne grundlaget for hver sats og lægge beløbene sammen.",
      },
      {
        question: "Hvorfor ser jeg et andet beløb på min ferieoversigt?",
        answer:
          "Beregneren viser optjeningen før skat. Beløbet på ferieoversigten kan være opgjort efter skat. Har du ferie med løn, gælder der særskilte regler om ferietillæg.",
      },
    ],
    related: {
      href: "/timeloen-beregner",
      title: "Beregn timeløn",
      description: "Regn mellem time-, måneds- og årsløn.",
    },
    source: {
      href: "https://www.borger.dk/arbejde-dagpenge-ferie/Oversigt-ferie/loenmodtager-og-ferie",
      label: "Borger.dk om feriepenge",
    },
  },
  flex: {
    slug: "flextid-beregner",
    calculation: "flex",
    title: "Beregn din flextid og flexsaldo",
    metaTitle: "Flextid beregner: se din flexsaldo",
    description:
      "Beregn flexsaldoen ved periodens slutning ud fra din startsaldo, arbejdstid, normtimer og afholdt flextid.",
    fields: [
      { label: "openingFlexBalance", initial: -2, min: -10000 },
      { label: "loggedAfterBreaks", initial: 40 },
      { label: "normBeforeTimeOff", initial: 37 },
      { label: "timeOffIncluded", initial: 0 },
    ],
    results: [
      { label: "hoursDifference", unit: "hours" },
      { label: "newFlexBalance", unit: "hours" },
    ],
    example:
      "Starter du på minus 2 timer og arbejder 40 timer mod en norm på 37, ender du på plus 1 time. Brug kun det sidste felt, hvis din rapport også har lagt afholdt flex ind som timer i totalen.",
    faq: [
      {
        question: "Hvordan undgår jeg at trække flextid fra to gange?",
        answer:
          "Bruger du kun faktisk arbejdstid i det første timefelt, skal afholdt flex stå på 0. Har rapporten fx 45 registrerede timer inklusive 5 timers flexfrihed, skal du skrive 45 og trække de 5 fra i sidste felt.",
      },
      {
        question: "Hvilken norm bruger jeg i en uge med helligdage?",
        answer:
          "Brug den norm, din arbejdsplads sætter for perioden. Find den almindelige kalenderberegning under arbejdstimer pr. måned, og tjek derefter eventuel ferie, fravær og lokale fridage mod din aftale.",
      },
    ],
    related: {
      href: "/arbejdstimer-pr-maaned",
      title: "Arbejdstimer pr. måned",
      description: "Find normtimer med danske helligdage.",
    },
  },
  rounding: {
    slug: "afrunding-af-timer",
    calculation: "rounding",
    title: "Afrund arbejdstimer til fakturaen",
    metaTitle: "Afrunding af timer til faktura: beregner",
    description:
      "Beregn, hvor mange minutter der kommer på fakturaen, når du runder en tidsregistrering op til fx 5, 10 eller 15 minutter.",
    fields: [
      { label: "wholeHours", initial: 1, whole: true },
      { label: "extraMinutes", initial: 7, max: 59, whole: true },
      {
        label: "roundingInterval",
        initial: 15,
        min: 1,
        max: 60,
        whole: true,
      },
    ],
    results: [
      { label: "roundedTime", unit: "minutes" },
      { label: "addedMinutes", unit: "minutes" },
    ],
    example:
      "En registrering på 1 time og 7 minutter er 67 minutter. Rundet op til nærmeste kvarter bliver det 75 minutter. En registrering på præcis 75 minutter bliver stående på 75.",
    faq: [
      {
        question: "Skal jeg runde hver registrering eller dagens sum?",
        answer:
          "Følg aftalen med kunden. To opgaver på 7 minutter giver 30 minutter, hvis du runder hver opgave op til et kvarter. Hvis du lægger de to opgaver sammen først, bliver det 15 minutter.",
      },
      {
        question: "Hvordan skriver jeg 75 minutter på fakturaen?",
        answer:
          "Divider minutterne med 60, hvis fakturafeltet bruger decimaltimer. Skriv 1,25 timer for 75 minutter. Gem gerne den faktiske tid i din registrering, så forskellen kan forklares.",
      },
    ],
    related: {
      href: "/minutter-til-timer",
      title: "Minutter til timer",
      description: "Omregn de afrundede minutter til decimaltimer.",
    },
  },
  budget: {
    slug: "projektbudget-beregner",
    calculation: "budget",
    title: "Beregn projektets timebudget",
    metaTitle: "Projektbudget beregner: timer og overskridelse",
    description:
      "Sammenhold budgetterede og brugte timer med det resterende arbejde. Se, hvor mange timer projektet ventes at ende på.",
    fields: [
      { label: "projectBudget", initial: 40 },
      { label: "hoursSpent", initial: 28 },
      { label: "remainingWork", initial: 18 },
    ],
    results: [
      { label: "budgetLeft", unit: "hours" },
      { label: "forecastHours", unit: "hours" },
      { label: "forecastBalance", unit: "hours" },
    ],
    example:
      "Har du brugt 28 af 40 timer, er der 12 timer tilbage i budgettet. Skønner du, at resten tager 18 timer, ender projektet på 46 timer. Saldoen på minus 6 viser overskridelsen.",
    faq: [
      {
        question: "Hvad tæller med i arbejdet tilbage?",
        answer:
          "Gå de åbne opgaver igennem og medregn de timer, der skal dækkes af budgettet. Det omfatter ofte møder, korrektur og levering, selv om selve produktionen næsten er færdig.",
      },
      {
        question: "Hvordan bruger jeg prognosen med en fast pris?",
        answer:
          "Behold det oprindelige budget som reference. Opdater skønnet for resten af arbejdet, når du får ny viden. Hvis prognosen viser en overskridelse, kan du se, hvor meget der skal spares, eller hvad en aftale om ekstraarbejde skal dække.",
      },
    ],
    related: {
      href: "/projekt-deadline-beregner",
      title: "Beregn projektets deadline",
      description: "Regn videre på kapacitet og tid frem til levering.",
    },
  },
  effective: {
    slug: "effektiv-timepris-beregner",
    calculation: "effective",
    title: "Beregn din effektive timepris",
    metaTitle: "Effektiv timepris beregner for freelancere",
    description:
      "Se hvad du reelt tjente pr. arbejdstime på et projekt, når du trækker direkte udgifter fra og regner alle timer med.",
    fields: [
      { label: "projectRevenue", initial: 12000 },
      { label: "directCosts", initial: 2000 },
      { label: "billableHours", initial: 25 },
      { label: "otherProjectHours", initial: 5 },
    ],
    results: [
      { label: "revenueAfterCosts", unit: "currency" },
      { label: "effectiveRate", unit: "hourlyRate" },
    ],
    example:
      "Et projekt indbragte 12.000 kr. og kostede 2.000 kr. i direkte udgifter. Du brugte 25 timer på leverancen og 5 på koordinering. Fordelt på alle 30 timer gav projektet 333,33 kr. pr. time før skat.",
    faq: [
      {
        question: "Hvilke timer skal jeg regne med?",
        answer:
          "Tag alt det arbejde med, der hører til projektet, også kundemøder, rettelser og administration, hvis du brugte tid på det. Ved fast pris kan du lægge alle timer i ét af timefelterne.",
      },
      {
        question: "Hvilke udgifter skal jeg trække fra?",
        answer:
          "Brug de direkte udgifter til projektet, fx underleverandører eller licenser købt til den opgave. Brug beløb ekskl. moms, hvis du kan trække købsmomsen fra. Den effektive timepris her er før skat og fælles omkostninger.",
      },
    ],
    related: {
      href: "/timepris-beregner",
      title: "Find din fremtidige timepris",
      description: "Beregn hvad du skal tage for næste opgave.",
    },
  },
} satisfies Record<Calculation, SeoTool>;
