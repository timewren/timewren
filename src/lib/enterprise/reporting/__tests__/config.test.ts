import { describe, expect, it } from "vitest";
import { canRunReportType, canShareTemplates } from "../access";
import {
  defaultConfigFor,
  ENTERPRISE_REPORT_TYPES,
  enterpriseReportConfigSchema,
  isEnterpriseReportType,
  REPORT_TYPE_DEFINITIONS,
  resolveReportPeriod,
} from "../config";
import { effectiveColumns } from "../run";

describe("enterpriseReportConfigSchema", () => {
  it("giver defaults for filtre og dimensioner", () => {
    const cfg = enterpriseReportConfigSchema.parse({
      reportType: "sickness",
      period: { kind: "preset", preset: "last_month" },
      columns: ["department", "sickDays"],
    });
    expect(cfg.filters.includeRejected).toBe(false);
    expect(cfg.filters.absenceStatuses).toEqual(["approved"]);
    expect(cfg.dimensions).toEqual([]);
    expect(cfg.includeDetails).toBe(false);
  });

  it("afviser ukendt type, ukendte kolonner, tom kolonneliste og ugyldig periode", () => {
    const base = {
      period: { kind: "preset", preset: "last_month" },
      columns: ["hours"],
    };
    expect(
      enterpriseReportConfigSchema.safeParse({ ...base, reportType: "time" })
        .success,
    ).toBe(false);
    expect(
      enterpriseReportConfigSchema.safeParse({
        ...base,
        reportType: "custom",
        columns: ["revenue"],
      }).success,
    ).toBe(false);
    expect(
      enterpriseReportConfigSchema.safeParse({
        ...base,
        reportType: "custom",
        columns: [],
      }).success,
    ).toBe(false);
    expect(
      enterpriseReportConfigSchema.safeParse({
        reportType: "custom",
        columns: ["hours"],
        period: { kind: "custom", from: "2026-1-1", to: "2026-01-31" },
      }).success,
    ).toBe(false);
    expect(
      enterpriseReportConfigSchema.safeParse({
        ...base,
        reportType: "custom",
        dimensions: ["a", "b", "c", "d", "e"],
      }).success,
    ).toBe(false);
  });

  it("defaultConfigFor giver gyldig config for alle typer", () => {
    for (const type of ENTERPRISE_REPORT_TYPES) {
      const cfg = defaultConfigFor(type);
      expect(cfg.reportType).toBe(type);
      expect(cfg.columns.length).toBeGreaterThan(0);
      expect(cfg.dimensions).toEqual(
        REPORT_TYPE_DEFINITIONS[type].defaultDimensions,
      );
    }
    expect(isEnterpriseReportType("payroll")).toBe(true);
    expect(isEnterpriseReportType("time")).toBe(false);
  });
});

describe("resolveReportPeriod", () => {
  const now = new Date(2026, 2, 15); // 15/3-2026
  it("presets, fri periode og ferieår", () => {
    expect(
      resolveReportPeriod({ kind: "preset", preset: "last_month" }, now),
    ).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(
      resolveReportPeriod(
        { kind: "custom", from: "2026-01-01", to: "2026-01-31" },
        now,
      ),
    ).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(
      resolveReportPeriod({ kind: "vacationYear", year: 2026 }, now),
    ).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

describe("effectiveColumns", () => {
  it("dropper dimensions- og attributkolonner uden deres dimension", () => {
    const cfg = enterpriseReportConfigSchema.parse({
      reportType: "custom",
      period: { kind: "preset", preset: "last_month" },
      dimensions: ["department"],
      columns: ["employee", "email", "department", "payrollCode", "hours"],
    });
    expect(effectiveColumns(cfg)).toEqual(["department", "hours"]);
  });
});

describe("adgang", () => {
  it("løn kun for HR/admin/owner; deling kun for HR/admin/owner", () => {
    expect(canRunReportType("manager", "payroll")).toBe(false);
    expect(canRunReportType("hr", "payroll")).toBe(true);
    expect(canRunReportType("admin", "payroll")).toBe(true);
    expect(canRunReportType("manager", "sickness")).toBe(true);
    expect(canShareTemplates("manager")).toBe(false);
    expect(canShareTemplates("owner")).toBe(true);
  });
});
