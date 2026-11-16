// @vitest-environment node
import type { DocumentProps } from "@react-pdf/renderer";
import { renderToBuffer } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { SYSTEM_TEMPLATES } from "@/lib/reports/defaults";
import { ReportPDF } from "@/lib/reports/generators/pdf/ReportPDF";
import type { ReportAggregates } from "@/lib/reports/query";

const aggregates: ReportAggregates = {
  summary: {
    totalHours: 0,
    totalRevenue: 0,
    billedHours: 0,
    billedRevenue: 0,
    unbilledHours: 0,
    unbilledRevenue: 0,
    entriesCount: 0,
  },
  groups: [],
  groupingNote: null,
  pauses: null,
};

describe("ReportPDF", () => {
  it("renderer uden at hente fonte fra nettet", async () => {
    // ReportPDF er typet på sine egne props, ikke på <Document>, den
    // returnerer — react-pdf's typer kender kun elementets rod.
    const element = createElement(ReportPDF, {
      config: SYSTEM_TEMPLATES[0].config,
      aggregates,
      entries: [],
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      logoUrl: null,
      companyName: "Bageriet på hjørnet",
    }) as ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(element);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30000);
});
