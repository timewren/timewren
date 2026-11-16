import {
  SCHIBSTED_BOLD_BASE64,
  SCHIBSTED_BOLD_WEIGHT,
  SCHIBSTED_REGULAR_BASE64,
  SCHIBSTED_REGULAR_WEIGHT,
  SCHIBSTED_SEMIBOLD_BASE64,
  SCHIBSTED_SEMIBOLD_WEIGHT,
} from "./fonts/schibsted-grotesk";

/** Brandets font (docs/BRAND.md → Typografi) i alle PDF'er. */
export const PDF_FONT_FAMILY = "Schibsted Grotesk";

export interface PdfFont {
  name: string;
  weight: number;
  data: Uint8Array;
}

const SOURCES = [
  { weight: SCHIBSTED_REGULAR_WEIGHT, base64: SCHIBSTED_REGULAR_BASE64 },
  { weight: SCHIBSTED_SEMIBOLD_WEIGHT, base64: SCHIBSTED_SEMIBOLD_BASE64 },
  { weight: SCHIBSTED_BOLD_WEIGHT, base64: SCHIBSTED_BOLD_BASE64 },
];

let cache: PdfFont[] | null = null;

/**
 * Fontene takumi-pdf skal indlejre. Dekodes én gang pr. proces; takumi
 * dedupliserer selv registrerede fonte på tværs af renders.
 */
export function pdfFonts(): PdfFont[] {
  if (cache) return cache;
  cache = SOURCES.map(({ weight, base64 }) => ({
    name: PDF_FONT_FAMILY,
    weight,
    data: new Uint8Array(Buffer.from(base64, "base64")),
  }));
  return cache;
}

/**
 * Samme fonte som data-URI'er til @react-pdf's Font.register. Virker både
 * på serveren og i browseren (rapport-eksport), uden netværk.
 *
 * Schibsted Grotesk har ingen kursiv-fil her, så hver vægt registreres også
 * som kursiv med samme fil. Ellers fejler hele PDF'en, når noget beder om
 * kursiv (fakturaens sidehovedtekst, <Text italic>); teksten står så opret.
 */
export function pdfFontSources(): {
  src: string;
  fontWeight: number;
  fontStyle: "normal" | "italic";
}[] {
  return SOURCES.flatMap(({ weight, base64 }) => {
    const src = `data:font/ttf;base64,${base64}`;
    return [
      { src, fontWeight: weight, fontStyle: "normal" as const },
      { src, fontWeight: weight, fontStyle: "italic" as const },
    ];
  });
}
