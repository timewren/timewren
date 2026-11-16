import { Font } from "@react-pdf/renderer";
import { PDF_FONT_FAMILY, pdfFontSources } from "./fonts";

let registered = false;

/**
 * Registrerer Schibsted Grotesk hos @react-pdf én gang. Fontene er
 * indlejret som base64, så render aldrig henter fra fonts.gstatic.com
 * (de gamle Inter-URL'er i ReportPDF gav 404, og rapport-PDF'en fejlede).
 */
export function registerPdfFonts(): string {
  if (!registered) {
    Font.register({ family: PDF_FONT_FAMILY, fonts: pdfFontSources() });
    registered = true;
  }
  return PDF_FONT_FAMILY;
}
