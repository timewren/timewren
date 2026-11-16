import { describe, expect, it } from "vitest";
import { resolvePayrollPeriod } from "../period";

describe("resolvePayrollPeriod — måned", () => {
  const month = {
    payrollPeriodType: "month" as const,
    payrollPeriodStartDay: 1,
  };

  it("kalendermåned", () => {
    expect(resolvePayrollPeriod(month, "2026-08-27")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      label: "august 2026",
    });
  });

  it("forrige periode ruller over årsskiftet", () => {
    expect(resolvePayrollPeriod(month, "2026-01-05", -1)).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(resolvePayrollPeriod(month, "2026-12-05", 1)).toMatchObject({
      from: "2027-01-01",
      to: "2027-01-31",
    });
  });

  it("skæringsdag 16: perioden hører til måneden den slutter i", () => {
    const cut = {
      payrollPeriodType: "month" as const,
      payrollPeriodStartDay: 16,
    };
    expect(resolvePayrollPeriod(cut, "2026-08-10")).toEqual({
      from: "2026-07-16",
      to: "2026-08-15",
      label: "august 2026",
    });
    expect(resolvePayrollPeriod(cut, "2026-08-20")).toEqual({
      from: "2026-08-16",
      to: "2026-09-15",
      label: "september 2026",
    });
    expect(resolvePayrollPeriod(cut, "2026-08-20", -1)).toMatchObject({
      from: "2026-07-16",
      to: "2026-08-15",
    });
  });

  it("skæringsdag begrænses til 1–28", () => {
    const cut = {
      payrollPeriodType: "month" as const,
      payrollPeriodStartDay: 31,
    };
    expect(resolvePayrollPeriod(cut, "2026-02-27")).toMatchObject({
      from: "2026-01-28",
      to: "2026-02-27",
    });
  });
});

describe("resolvePayrollPeriod — 14 dage", () => {
  const bi = {
    payrollPeriodType: "biweekly" as const,
    payrollPeriodStartDay: 1,
  };

  it("forankres i mandag 2024-01-01 og dækker 14 dage", () => {
    const p = resolvePayrollPeriod(bi, "2024-01-01");
    expect(p).toMatchObject({ from: "2024-01-01", to: "2024-01-14" });
    expect(resolvePayrollPeriod(bi, "2024-01-14")).toMatchObject({
      from: "2024-01-01",
      to: "2024-01-14",
    });
    expect(resolvePayrollPeriod(bi, "2024-01-15")).toMatchObject({
      from: "2024-01-15",
      to: "2024-01-28",
    });
  });

  it("offset flytter hele perioder og starter altid på en mandag", () => {
    const p = resolvePayrollPeriod(bi, "2026-08-27", -1);
    const [y, m, d] = p.from.split("-").map(Number);
    expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(1);
    const next = resolvePayrollPeriod(bi, "2026-08-27", 0);
    expect(next.from > p.to).toBe(true);
  });
});
