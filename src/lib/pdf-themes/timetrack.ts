import { BRAND_LIGHT, DEFAULT_INVOICE_PRIMARY_COLOR } from "@/lib/brand/tokens";
import { PDF_FONT_FAMILY } from "@/lib/pdf/fonts";
import type { PdfcnTheme } from "@/types/pdf-themes";

import { defaultPrimitives } from "./primitives";

/**
 * TimeTracks PDF-tema: Schibsted Grotesk til al tekst (indlejret, se
 * lib/pdf/fonts), neutrale farver og granskov fra brand-tokens.
 * `primary` er kundens egen farve fra faktura-skabelonen
 * (template.primaryColor), når den er sat; ellers brandets default.
 */
export function timetrackPdfTheme(
  primaryColor: string = DEFAULT_INVOICE_PRIMARY_COLOR,
): PdfcnTheme {
  return {
    colors: {
      accent: primaryColor,
      background: BRAND_LIGHT.papir,
      border: BRAND_LIGHT.streg,
      destructive: "#B42318",
      foreground: BRAND_LIGHT.blaek,
      info: BRAND_LIGHT.gran,
      muted: BRAND_LIGHT.flade,
      mutedForeground: BRAND_LIGHT.graa,
      primary: primaryColor,
      primaryForeground: BRAND_LIGHT.paaGran,
      success: "#059669",
      warning: "#d97706",
    },
    name: "timetrack",
    page: {
      orientation: "portrait",
      size: "A4",
    },
    primitives: defaultPrimitives,
    spacing: {
      componentGap: 12,
      page: {
        marginBottom: 48,
        marginLeft: 40,
        marginRight: 40,
        marginTop: 40,
      },
      paragraphGap: 8,
      sectionGap: 22,
    },
    typography: {
      body: {
        fontFamily: PDF_FONT_FAMILY,
        fontSize: 10,
        lineHeight: 1.5,
      },
      heading: {
        fontFamily: PDF_FONT_FAMILY,
        fontSize: {
          h1: 22,
          h2: 16,
          h3: 13,
          h4: 11,
          h5: 10,
          h6: 9,
        },
        fontWeight: 700,
        lineHeight: 1.25,
      },
    },
  };
}
