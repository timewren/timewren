// src/lib/reports/generators/json.test.ts
import { describe, expect, it } from "vitest";
import type { ReportEntry } from "../columns";
import { generateJSON } from "./json";

const mk = (): ReportEntry => ({
  id: "e1",
  source: "manual",
  approvalStatus: null,
  segments: [],
  date: new Date(2026, 2, 15, 12, 0),
  startTime: null,
  endTime: null,
  hours: "2.00",
  billableRate: "500",
  description: "Work",
  isBilled: false,
  isBillable: true,
  isPrepaid: false,
  clientDefaultBillable: true,
  isFromTemplate: false,
  _rounded: 2,
  _value: 1000,
  client: { id: "c1", name: "Acme" },
  project: { id: "p1", name: "Web", client: null, monthlyBudgetHours: null },
  prepaidPackage: null,
  tags: [],
  task: null,
  member: null,
});

describe("generateJSON", () => {
  it("returns parseable JSON with selected columns", () => {
    const json = generateJSON([mk()], {
      columns: ["date", "client", "hours", "value"],
    });
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([
      {
        date: "2026-03-15",
        client: "Acme",
        hours: 2,
        value: 1000,
      },
    ]);
  });
});
