// src/lib/reports/generators/csv.test.ts
import { describe, expect, it } from "vitest";
import type { ReportEntry } from "../columns";
import { generateCSV } from "./csv";

const NEWLINE = String.fromCharCode(10);

const mk = (): ReportEntry => ({
  id: "e1",
  source: "manual",
  approvalStatus: null,
  segments: [],
  date: new Date(2026, 2, 15, 12, 0),
  startTime: null,
  endTime: null,
  hours: "2.50",
  billableRate: "500",
  description: "Arbejde, inkl. møde",
  isBilled: true,
  isBillable: true,
  isPrepaid: false,
  clientDefaultBillable: true,
  isFromTemplate: false,
  _rounded: 2.5,
  _value: 1250,
  client: { id: "c1", name: "Acme" },
  project: { id: "p1", name: "Web", client: null, monthlyBudgetHours: null },
  prepaidPackage: null,
  tags: [],
  task: null,
  member: null,
});

describe("generateCSV", () => {
  it("returns semicolon-delimited with Danish header and BOM", () => {
    const csv = generateCSV([mk()], {
      columns: ["date", "client", "project", "hours", "value"],
    });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const body = csv.slice(1);
    const [header, row] = body.split("\n");
    expect(header).toBe("Dato;Kunde;Projekt;Timer;Værdi");
    expect(row).toBe("2026-03-15;Acme;Web;2,50;1250,00");
  });

  it("escapes values containing delimiter in quotes", () => {
    const csv = generateCSV([mk()], { columns: ["description"] });
    expect(csv).toContain('"Arbejde, inkl. møde"');
  });

  it("holder header på række 1 selv med gruppe-blok", () => {
    // Gruppe-blokken må IKKE prependes: importer mapper efter række 1 (#593)
    const csv = generateCSV([mk()], {
      columns: ["date", "hours"],
      groups: [
        {
          key: "p1",
          label: "Web",
          hours: 2.5,
          revenue: 1250,
          entries: [],
          budget: {
            budgetHours: 50,
            usedHours: 17,
            percentage: 34,
            healthStatus: "green",
            month: "2026-03",
          },
        },
      ],
      groupingNote: null,
    });
    const lines = csv.slice(1).split(NEWLINE);
    expect(lines[0]).toBe("Dato;Timer");
    expect(lines[1]).toBe("2026-03-15;2,50");
    // Gruppe-blokken ligger efter posteringerne, adskilt af en tom linje
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe(
      "Gruppe;Timer;Omsætning;Månedsbudget;Brugt i måneden;Forbrugt %",
    );
    expect(lines[4]).toBe("Web;2,50;1250,00;50,00;17,00;34");
  });

  it("udelader gruppe-blokken helt når der ikke er grupper", () => {
    const csv = generateCSV([mk()], { columns: ["date", "hours"] });
    expect(csv.slice(1).split(NEWLINE)).toHaveLength(2);
  });
});
