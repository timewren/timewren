// @vitest-environment node
import type { DocumentProps } from "@react-pdf/renderer";
import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { registerPdfFonts } from "@/lib/pdf/react-pdf-fonts";

describe("registerPdfFonts", () => {
  // Fakturaens sidehovedtekst (InvoicePDF headerText) og <Text italic> beder
  // om kursiv. Uden en registreret kursiv-variant fejler hele PDF'en.
  it("kan rendere kursiv tekst i brandets font", async () => {
    const family = registerPdfFonts();
    const element = createElement(
      Document,
      null,
      createElement(
        Page,
        null,
        createElement(
          Text,
          { style: { fontFamily: family, fontStyle: "italic" } },
          "Tak for samarbejdet",
        ),
        createElement(
          Text,
          {
            style: { fontFamily: family, fontStyle: "italic", fontWeight: 700 },
          },
          "Fed kursiv",
        ),
      ),
    ) as unknown as ReactElement<DocumentProps>;

    const buffer = await renderToBuffer(element);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
