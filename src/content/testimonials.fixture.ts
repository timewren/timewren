import type { Testimonial } from "./testimonials";

/**
 * Opdigtet citat til snapshot-tests, så de ikke afhænger af rigtige kunders
 * navne i src/content/testimonials.ts (som erstattes i det offentlige træ).
 * Citatet indeholder uddraget, som /register viser.
 */
export const FIXTURE_TESTIMONIALS: Testimonial[] = [
  {
    id: "kundecitat-hoved",
    name: "Anna Testsen",
    role: "Designer",
    company: "Testkunde ApS",
    quote:
      "Timetrack.dk gør en ellers kedelig administrativ opgave både enkel og overskuelig. Det er nemt at registrere sin tid og bevare overblikket, så man kan bruge energien på det arbejde, der faktisk skaber værdi. Ikke alene er systemet nemt og overskueligt at bruge, men servicen er også i top. Man oplever en virksomhed, der går op i sine kunder og i at skabe en løsning, der fungerer i praksis. Stor anbefaling herfra!",
    image: "/testimonials/anna-testsen.jpg",
    imageIsLogo: false,
    logoImage: "/testimonials/testkunde.jpg",
  },
];
