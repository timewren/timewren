import { describe, expect, it } from "vitest";
import { buildDigest, type DigestSource, digestIsEmpty } from "../digest";
import { renderNotification } from "../events";

const today = new Date(2026, 7, 27, 7, 30); // torsdag 27/8-2026

function source(overrides: Partial<DigestSource> = {}): DigestSource {
  return {
    employees: [
      { userId: "u-mette", name: "Mette" },
      { userId: "u-rasmus", name: "Rasmus" },
      { userId: "u-lars", name: "Lars" },
    ],
    lastWeekStart: "2026-08-17",
    handledLastWeek: new Set(["u-rasmus"]),
    pendingTimesheets: [
      {
        userId: "u-rasmus",
        weekStart: "2026-08-17",
        submittedAt: new Date(2026, 7, 21),
      },
    ],
    pendingAbsence: [
      {
        userId: "u-lars",
        typeName: "Ferie",
        startDate: "2026-09-07",
        endDate: "2026-09-11",
        createdAt: new Date(2026, 7, 20),
      },
    ],
    today,
    ...overrides,
  };
}

describe("buildDigest", () => {
  it("samler manglende timesedler, afventende uger og anmodninger for hele org'en", () => {
    const d = buildDigest({
      source: source(),
      scopeUserIds: null,
      period: "daily",
      escalationDays: null,
    });
    expect(d.missingTimesheets.map((i) => i.employeeName)).toEqual([
      "Mette",
      "Lars",
    ]);
    expect(d.pendingTimesheets).toHaveLength(1);
    expect(d.pendingTimesheets[0]).toMatchObject({
      employeeName: "Rasmus",
      ageDays: 6,
    });
    expect(d.pendingAbsence[0]).toMatchObject({
      employeeName: "Lars",
      ageDays: 7,
    });
    expect(d.pendingAbsence[0].detail).toContain("ferie");
    expect(d.escalated).toBe(false);
  });

  it("filtrerer på leder-scope", () => {
    const d = buildDigest({
      source: source(),
      scopeUserIds: new Set(["u-mette"]),
      period: "weekly",
      escalationDays: null,
    });
    expect(d.missingTimesheets.map((i) => i.employeeName)).toEqual(["Mette"]);
    expect(d.pendingTimesheets).toEqual([]);
    expect(d.pendingAbsence).toEqual([]);
    expect(digestIsEmpty(d)).toBe(false);
  });

  it("eskalerer når noget har ventet mindst N dage", () => {
    const base = {
      source: source(),
      scopeUserIds: null,
      period: "daily" as const,
    };
    expect(buildDigest({ ...base, escalationDays: 7 }).escalated).toBe(true);
    expect(buildDigest({ ...base, escalationDays: 8 }).escalated).toBe(false);
  });

  it("er tom når alt er håndteret", () => {
    const d = buildDigest({
      source: source({
        handledLastWeek: new Set(["u-mette", "u-rasmus", "u-lars"]),
        pendingTimesheets: [],
        pendingAbsence: [],
      }),
      scopeUserIds: null,
      period: "daily",
      escalationDays: 3,
    });
    expect(digestIsEmpty(d)).toBe(true);
    expect(d.escalated).toBe(false);
  });

  it("rendres med sektioner og eskaleringsmarkering", () => {
    const d = buildDigest({
      source: source(),
      scopeUserIds: null,
      period: "daily",
      escalationDays: 5,
    });
    const r = renderNotification("digest.manager", d);
    expect(r.title).toBe("Dagligt leder-overblik (eskaleret)");
    expect(r.body).toContain("Manglende timesedler (2):");
    expect(r.body).toContain("• Rasmus — uge 34 afventer godkendelse (6 dage)");
    expect(r.facts?.[0]).toEqual({
      name: "Manglende timesedler",
      value: "2",
    });
  });
});
