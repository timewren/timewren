import { describe, expect, it } from "vitest";
import { getUpcomingDeadlines } from "./dk-deadlines";

// Helper — build a local date
const d = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day);

describe("getUpcomingDeadlines", () => {
  // -------------------------------------------------------------------------
  // Sole proprietor with quarterly VAT
  // -------------------------------------------------------------------------
  describe("sole_prop + quarterly VAT", () => {
    it("returns Q1 and Q2 VAT deadlines within 180-day window from Apr 1", () => {
      // Ref: 1 April 2026 — cutoff is Sep 27 2026
      // Q1 = Apr 20 (in window), Q2 = Jul 20 (in window), Q3 = Oct 20 (OUTSIDE)
      const results = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 4, 1),
        lookAheadDays: 180,
      });

      const vatIds = results
        .filter((dl) => dl.category === "vat")
        .map((dl) => dl.id);

      expect(vatIds).toContain("vat-q1-2026");
      expect(vatIds).toContain("vat-q2-2026");
      // Q3 (Oct 20) is outside 180 days from Apr 1
      expect(vatIds).not.toContain("vat-q3-2026");
    });

    it("returns selvangivelse deadline", () => {
      const results = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 4, 1),
        lookAheadDays: 180,
      });

      const selvangivelse = results.find((dl) =>
        dl.id.startsWith("selvangivelse-"),
      );
      expect(selvangivelse).toBeDefined();
      expect(selvangivelse?.category).toBe("income_tax");
      // Jul 1 is within 180 days from Apr 1
      expect(selvangivelse?.date).toEqual(d(2026, 7, 1));
    });

    it("returns at least 2 VAT deadlines + income_tax within 180 days", () => {
      const results = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 4, 1),
        lookAheadDays: 180,
      });

      const vatCount = results.filter((dl) => dl.category === "vat").length;
      const taxCount = results.filter(
        (dl) => dl.category === "income_tax",
      ).length;

      expect(vatCount).toBeGreaterThanOrEqual(2);
      expect(taxCount).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // ApS with quarterly VAT + calendar fiscal year
  // -------------------------------------------------------------------------
  describe("aps + quarterly VAT + calendar fiscal year", () => {
    it("contains VAT, corp-tax and annual-report categories within 365 days", () => {
      const results = getUpcomingDeadlines({
        companyType: "aps",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const categories = new Set(results.map((dl) => dl.category));
      expect(categories.has("vat")).toBe(true);
      expect(categories.has("corp_tax")).toBe(true);
      expect(categories.has("annual_report")).toBe(true);
    });

    it("årsrapport for FY2025 (calendar year) is due 31 maj 2026", () => {
      // FY ending 31 Dec 2025 + 5 months = 31 May 2026
      const results = getUpcomingDeadlines({
        companyType: "aps",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const arsrapport = results.find((dl) => dl.id === "arsrapport-fy2025");
      expect(arsrapport).toBeDefined();
      // 31 dec 2025 + 5 months = 31 may 2026
      expect(arsrapport?.date.getFullYear()).toBe(2026);
      expect(arsrapport?.date.getMonth()).toBe(4); // May = index 4
      expect(arsrapport?.date.getDate()).toBe(31);
    });

    it("selvangivelse selskab for FY2025 is due ~6 months after fiscal year end", () => {
      // FY ending 31 Dec 2025 + 6 months: JS setMonth rolls Jun 31 → Jul 1
      const results = getUpcomingDeadlines({
        companyType: "aps",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const selvSelskab = results.find(
        (dl) => dl.id === "corp-selvangivelse-fy2025",
      );
      expect(selvSelskab).toBeDefined();
      expect(selvSelskab?.date.getFullYear()).toBe(2026);
      // Dec 31 + 6 months: JS Date.setMonth(+6) rolls Jun 31 → Jul 1 (index 6)
      expect(selvSelskab?.date.getMonth()).toBe(6); // July = index 6
    });
  });

  // -------------------------------------------------------------------------
  // hasEmployees adds A-skat monthly
  // -------------------------------------------------------------------------
  describe("hasEmployees", () => {
    it("adds A-skat monthly deadlines when hasEmployees=true", () => {
      const withEmployees = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "none",
        fiscalYearEnd: "12-31",
        hasEmployees: true,
        refDate: d(2026, 4, 1),
        lookAheadDays: 90,
      });

      const withoutEmployees = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "none",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 4, 1),
        lookAheadDays: 90,
      });

      const aSkatWith = withEmployees.filter((dl) =>
        dl.id.startsWith("a-skat-"),
      );
      const aSkatWithout = withoutEmployees.filter((dl) =>
        dl.id.startsWith("a-skat-"),
      );

      expect(aSkatWith.length).toBeGreaterThan(0);
      expect(aSkatWithout.length).toBe(0);
    });

    it("adds feriepenge quarterly deadlines when hasEmployees=true", () => {
      const results = getUpcomingDeadlines({
        companyType: "aps",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: true,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const feriepenge = results.filter((dl) =>
        dl.id.startsWith("feriepenge-"),
      );
      expect(feriepenge.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // vatPeriod='none' excludes VAT rows
  // -------------------------------------------------------------------------
  describe("vatPeriod=none", () => {
    it("returns zero VAT deadlines when vatPeriod is none", () => {
      const results = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "none",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const vatDeadlines = results.filter((dl) => dl.category === "vat");
      expect(vatDeadlines).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-year boundary: ref date Dec 20 → Q4 VAT in January
  // -------------------------------------------------------------------------
  describe("cross-year boundary", () => {
    it("shows Q4 VAT deadline in January when ref date is late December", () => {
      const results = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 12, 20),
        lookAheadDays: 60,
      });

      // Q4 VAT for 2026 is due 20 Jan 2027
      const q4Vat = results.find((dl) => dl.id === "vat-q4-2026");
      expect(q4Vat).toBeDefined();
      expect(q4Vat?.date).toEqual(d(2027, 1, 20));
    });
  });

  // -------------------------------------------------------------------------
  // Deadlines sorted ascending
  // -------------------------------------------------------------------------
  describe("sort order", () => {
    it("returns deadlines sorted ascending by date", () => {
      const results = getUpcomingDeadlines({
        companyType: "aps",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: true,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      for (let i = 1; i < results.length; i++) {
        expect(results[i].date.getTime()).toBeGreaterThanOrEqual(
          results[i - 1].date.getTime(),
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Semi-annual VAT
  // -------------------------------------------------------------------------
  describe("semi_annual VAT", () => {
    it("returns H1 (1 sep) deadline within 365 days from Jan 1", () => {
      const results = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "semi_annual",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const vatH1 = results.find((dl) => dl.id === "vat-h1-2026");
      expect(vatH1).toBeDefined();
      expect(vatH1?.date).toEqual(d(2026, 9, 1));
    });

    it("returns H2 (1 mar next year) deadline when look-ahead is 500 days", () => {
      const results = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "semi_annual",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 1, 1),
        lookAheadDays: 500,
      });

      // H2 2026 = 1 mar 2027 (= ~425 days from Jan 1 2026)
      const vatH2 = results.find((dl) => dl.id === "vat-h2-2026");
      expect(vatH2).toBeDefined();
      expect(vatH2?.date).toEqual(d(2027, 3, 1));
    });
  });

  // -------------------------------------------------------------------------
  // Monthly VAT
  // -------------------------------------------------------------------------
  describe("monthly VAT", () => {
    it("returns monthly VAT deadlines on 25th of following month", () => {
      const results = getUpcomingDeadlines({
        companyType: "aps",
        vatPeriod: "monthly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 4, 1),
        lookAheadDays: 60,
      });

      // April period → due 25 May
      const apr = results.find((dl) => dl.id === "vat-monthly-2026-04");
      expect(apr).toBeDefined();
      expect(apr?.date).toEqual(d(2026, 5, 25));
    });
  });

  // -------------------------------------------------------------------------
  // At least one deadline per category for a full aps config
  // -------------------------------------------------------------------------
  describe("category coverage for aps", () => {
    it("covers vat, corp_tax, annual_report, payroll categories within 365 days", () => {
      const results = getUpcomingDeadlines({
        companyType: "aps",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: true,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const categories = new Set(results.map((dl) => dl.category));
      expect(categories.has("vat")).toBe(true);
      expect(categories.has("corp_tax")).toBe(true);
      expect(categories.has("annual_report")).toBe(true);
      expect(categories.has("payroll")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Freelance company type
  // -------------------------------------------------------------------------
  describe("freelance company type", () => {
    it("freelance gets b-skat and selvangivelse but not corp-tax", () => {
      const results = getUpcomingDeadlines({
        companyType: "freelance",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const hasBSkat = results.some((dl) => dl.id.startsWith("b-skat-"));
      const hasSelvangivelse = results.some((dl) =>
        dl.id.startsWith("selvangivelse-"),
      );
      const hasCorpTax = results.some((dl) => dl.category === "corp_tax");

      expect(hasBSkat).toBe(true);
      expect(hasSelvangivelse).toBe(true);
      expect(hasCorpTax).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // No duplicates
  // -------------------------------------------------------------------------
  describe("no duplicate ids", () => {
    it("returns unique deadline ids", () => {
      const results = getUpcomingDeadlines({
        companyType: "aps",
        vatPeriod: "quarterly",
        fiscalYearEnd: "12-31",
        hasEmployees: true,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const ids = results.map((dl) => dl.id);
      const unique = new Set(ids);
      expect(ids.length).toBe(unique.size);
    });
  });

  // -------------------------------------------------------------------------
  // income_tax category shows up for sole proprietors
  // -------------------------------------------------------------------------
  describe("income_tax category", () => {
    it("sole_prop has income_tax deadlines (b-skat, selvangivelse, AM-bidrag)", () => {
      const results = getUpcomingDeadlines({
        companyType: "sole_prop",
        vatPeriod: "none",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
        refDate: d(2026, 1, 1),
        lookAheadDays: 365,
      });

      const incomeTax = results.filter((dl) => dl.category === "income_tax");
      expect(incomeTax.length).toBeGreaterThan(0);
    });
  });
});
