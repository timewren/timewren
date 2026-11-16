import { describe, expect, it } from "vitest";
import {
  buildInvoicePreview,
  DIRECT_TIME_LABEL,
  previewPeriodRange,
} from "./invoice-preview";

describe("buildInvoicePreview", () => {
  it("grupperer pr. projekt og samler poster uden projekt i Direkte tid", () => {
    const preview = buildInvoicePreview([
      {
        id: "a",
        hours: "2.5",
        billableRate: "800",
        projectId: "p1",
        projectName: "Hjemmeside",
        date: "2026-09-03",
      },
      {
        id: "b",
        hours: "1.5",
        billableRate: "800",
        projectId: "p1",
        projectName: "Hjemmeside",
        date: "2026-09-10",
      },
      {
        id: "c",
        hours: "1",
        billableRate: "600",
        projectId: null,
        projectName: null,
        date: "2026-08-28",
      },
    ]);

    expect(preview.entryIds).toEqual(["a", "b", "c"]);
    expect(preview.totalHours).toBe(5);
    expect(preview.totalAmount).toBe(3800);
    expect(preview.firstDate).toBe("2026-08-28");
    expect(preview.lastDate).toBe("2026-09-10");
    expect(preview.groups).toEqual([
      {
        key: "p1",
        label: "Hjemmeside",
        entryCount: 2,
        hours: 4,
        amount: 3200,
        hoursWithoutRate: 0,
      },
      {
        key: "direct",
        label: DIRECT_TIME_LABEL,
        entryCount: 1,
        hours: 1,
        amount: 600,
        hoursWithoutRate: 0,
      },
    ]);
  });

  it("tæller timer uden sats, så brugeren kan se 0 kr-linjer før kladden laves", () => {
    const preview = buildInvoicePreview([
      {
        id: "a",
        hours: 3,
        billableRate: null,
        projectId: null,
        projectName: null,
        date: "2026-09-01",
      },
    ]);
    expect(preview.totalAmount).toBe(0);
    expect(preview.hoursWithoutRate).toBe(3);
  });

  it("tom liste giver tom forhåndsvisning", () => {
    const preview = buildInvoicePreview([]);
    expect(preview.entryCount).toBe(0);
    expect(preview.firstDate).toBeNull();
    expect(preview.groups).toEqual([]);
  });
});

describe("buildInvoicePreview: øre som på fakturaen", () => {
  it("afrunder pr. post, som fakturalinjerne", () => {
    // 0,33 t × 799,99 kr = 263,9967 → linjen er 264,00 kr; tre linjer er
    // 792,00 kr (ikke 791,99 kr, som en afrunding af summen ville give).
    const preview = buildInvoicePreview(
      ["a", "b", "c"].map((id) => ({
        id,
        hours: "0.33",
        billableRate: "799.99",
        projectId: "p1",
        projectName: "Projekt",
        date: "2026-10-01",
      })),
    );
    expect(preview.totalAmount).toBe(792);
    expect(preview.groups[0].amount).toBe(792);
  });
});

describe("previewPeriodRange", () => {
  it("all har ingen grænser", () => {
    expect(previewPeriodRange("all", "2026-10-02")).toEqual({
      from: null,
      to: null,
    });
  });

  it("this_month går fra den 1. til i dag", () => {
    expect(previewPeriodRange("this_month", "2026-10-02")).toEqual({
      from: "2026-10-01",
      to: "2026-10-02",
    });
  });

  it("last_month er hele forrige måned, også hen over årsskiftet", () => {
    expect(previewPeriodRange("last_month", "2026-10-02")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(previewPeriodRange("last_month", "2027-01-15")).toEqual({
      from: "2026-12-01",
      to: "2026-12-31",
    });
    expect(previewPeriodRange("last_month", "2028-03-01")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });
});
