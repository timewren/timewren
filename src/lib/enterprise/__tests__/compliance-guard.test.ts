import { describe, expect, it } from "vitest";
import type { ComplianceEvaluation } from "../compliance";
import {
  checkEntryCompliance,
  downgradeBlocks,
  expandAbsenceDates,
  expandNeutralAbsenceDates,
  isEnterpriseModuleEnabled,
  referencePeriodStart,
  toComplianceSettings,
} from "../compliance-guard";

const blocked: ComplianceEvaluation = {
  allowed: false,
  blocked: ["11 timers hvile: 14,0 t …"],
  warnings: ["48 timers-reglen: …"],
  findings: [
    {
      rule: "daily_rest",
      severity: "violation",
      date: "2026-03-02",
      value: 14,
      limit: 13,
      message: "11 timers hvile: 14,0 t …",
    },
  ],
};

describe("downgradeBlocks — lock-in og faktum-registreringer", () => {
  it("block → advarsel når kandidaten ikke øger belastningen", () => {
    // 11 t → 2 t (erstatter en 11 t-post)
    const down = downgradeBlocks(blocked, {
      candidateHours: 2,
      replacedHours: 11,
    });
    expect(down.allowed).toBe(true);
    expect(down.blocked).toEqual([]);
    expect(down.warnings).toEqual([
      "11 timers hvile: 14,0 t …",
      "48 timers-reglen: …",
    ]);
    expect(down.findings).toHaveLength(1);
    // 0 timer (slet cellen) er altid tilladt
    expect(downgradeBlocks(blocked, { candidateHours: 0 }).allowed).toBe(true);
    // Uændret (11 → 11) må også gemmes
    expect(
      downgradeBlocks(blocked, { candidateHours: 11, replacedHours: 11 })
        .allowed,
    ).toBe(true);
  });

  it("block bevares når kandidaten øger belastningen", () => {
    expect(
      downgradeBlocks(blocked, { candidateHours: 12, replacedHours: 11 })
        .allowed,
    ).toBe(false);
    expect(downgradeBlocks(blocked, { candidateHours: 14 }).allowed).toBe(
      false,
    );
  });

  it("neverBlock (timer-stop, check-ud) nedgraderer altid", () => {
    const down = downgradeBlocks(blocked, {
      neverBlock: true,
      candidateHours: 14,
    });
    expect(down.allowed).toBe(true);
    expect(down.warnings).toHaveLength(2);
  });

  it("rører ikke et allerede tilladt resultat", () => {
    const ok: ComplianceEvaluation = {
      allowed: true,
      blocked: [],
      warnings: ["x"],
      findings: [],
    };
    expect(downgradeBlocks(ok, { neverBlock: true })).toBe(ok);
  });
});

describe("enterprise-modul-gate — loven gælder ikke freelancere", () => {
  type ModuleRow = { isAvailable: boolean; isEnabled: boolean };
  /** Minimal db-attrap: kun organization_modules — alt andet ville kaste */
  function fakeDb(rows: ModuleRow[]) {
    const boom = () => {
      throw new Error("må ikke ramme andre tabeller uden enterprise-modul");
    };
    return {
      query: {
        organizationModules: { findMany: async () => rows },
        organizations: { findFirst: boom },
        employeeProfiles: { findFirst: boom },
        timeEntries: { findMany: boom },
        absenceRequests: { findMany: boom },
      },
    } as unknown as Parameters<typeof checkEntryCompliance>[0];
  }

  it("isEnterpriseModuleEnabled kræver både available og enabled", async () => {
    expect(await isEnterpriseModuleEnabled(fakeDb([]), "org")).toBe(false);
    expect(
      await isEnterpriseModuleEnabled(
        fakeDb([{ isAvailable: true, isEnabled: false }]),
        "org",
      ),
    ).toBe(false);
    expect(
      await isEnterpriseModuleEnabled(
        fakeDb([{ isAvailable: true, isEnabled: true }]),
        "org",
      ),
    ).toBe(true);
  });

  it("org uden enterprise-modul (freelance-signup) får aldrig fund", async () => {
    const r = await checkEntryCompliance(fakeDb([]), {
      orgId: "org",
      userId: "u1",
      candidate: { date: "2026-03-02", hours: 20 },
    });
    expect(r).toEqual({
      allowed: true,
      blocked: [],
      warnings: [],
      findings: [],
    });
    // Eksplicit flag fra ctx.modules springer opslaget over
    const r2 = await checkEntryCompliance(fakeDb([]), {
      orgId: "org",
      userId: "u1",
      enterpriseEnabled: false,
      candidate: { date: "2026-03-02", hours: 20 },
    });
    expect(r2.findings).toEqual([]);
    // Solo-bruger uden org
    const r3 = await checkEntryCompliance(fakeDb([]), {
      orgId: null,
      userId: "u1",
      candidate: { date: "2026-03-02", hours: 20 },
    });
    expect(r3.allowed).toBe(true);
  });
});

describe("toComplianceSettings", () => {
  it("bruger kolonnerne og spejler 48 t-block i legacy-flaget", () => {
    const s = toComplianceSettings({
      enforceComplianceBlocking: false,
      complianceReferencePeriodMonths: 12,
      complianceRule48h: "block",
      complianceRuleDailyRest: "off",
      complianceRuleWeeklyRest: "warn",
    });
    expect(s.rules).toEqual({
      rule48h: "block",
      dailyRest: "off",
      weeklyRest: "warn",
    });
    expect(s.referencePeriodMonths).toBe(12);
    expect(s.enforceComplianceBlocking).toBe(true);
  });

  it("falder tilbage på legacy-flaget når kolonnerne mangler/er ugyldige", () => {
    const s = toComplianceSettings({
      enforceComplianceBlocking: true,
      complianceReferencePeriodMonths: 4,
      complianceRule48h: "" as string,
      complianceRuleDailyRest: undefined as unknown as string,
      complianceRuleWeeklyRest: "nonsense",
    });
    expect(s.rules).toEqual({
      rule48h: "block",
      dailyRest: "warn",
      weeklyRest: "warn",
    });
  });

  it("ingen org → defaults", () => {
    const s = toComplianceSettings(null);
    expect(s.rules.rule48h).toBe("warn");
    expect(s.referencePeriodMonths).toBe(4);
    expect(s.enforceComplianceBlocking).toBe(false);
  });
});

describe("expandAbsenceDates", () => {
  const base = {
    halfDayStart: false,
    halfDayEnd: false,
    hoursPerDay: null,
  };

  it("udfolder perioder, klipper til vinduet og lukker åbne perioder ved i dag", () => {
    const dates = expandAbsenceDates(
      [
        { ...base, startDate: "2026-02-27", endDate: "2026-03-03" },
        // Åben sygeperiode fra 10/3 — tæller til og med i dag (12/3)
        { ...base, startDate: "2026-03-10", endDate: null },
      ],
      "2026-03-01",
      "2026-03-31",
      "2026-03-12",
    );
    expect([...dates].sort()).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
    ]);
  });

  it("halve dage og timer-fravær tæller ikke som hviledag", () => {
    const dates = expandAbsenceDates(
      [
        {
          ...base,
          startDate: "2026-03-02",
          endDate: "2026-03-04",
          halfDayStart: true,
          halfDayEnd: true,
        },
        {
          ...base,
          startDate: "2026-03-09",
          endDate: "2026-03-09",
          hoursPerDay: "3.00",
        },
      ],
      "2026-03-01",
      "2026-03-31",
      "2026-03-31",
    );
    expect([...dates]).toEqual(["2026-03-03"]);
  });

  it("perioder helt uden for vinduet ignoreres", () => {
    const dates = expandAbsenceDates(
      [{ ...base, startDate: "2026-01-05", endDate: "2026-01-09" }],
      "2026-03-01",
      "2026-03-31",
      "2026-03-31",
    );
    expect(dates.size).toBe(0);
  });
});

describe("expandNeutralAbsenceDates (48 t, § 4)", () => {
  const base = {
    halfDayStart: false,
    halfDayEnd: false,
    hoursPerDay: null,
  };

  it("afspadsering er hvile men ikke neutral; øvrigt fravær er neutralt", () => {
    const rows = [
      // Ferie
      {
        ...base,
        startDate: "2026-03-02",
        endDate: "2026-03-03",
        deductsOvertime: false,
      },
      // Afspadsering (trækker fra overtidssaldoen)
      {
        ...base,
        startDate: "2026-03-05",
        endDate: "2026-03-05",
        deductsOvertime: true,
      },
    ];
    const window = ["2026-03-01", "2026-03-31", "2026-03-31"] as const;
    expect([...expandAbsenceDates(rows, ...window)].sort()).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-05",
    ]);
    expect([...expandNeutralAbsenceDates(rows, ...window)].sort()).toEqual([
      "2026-03-02",
      "2026-03-03",
    ]);
  });
});

describe("referencePeriodStart", () => {
  it("trækker N måneder fra i dag (lokal midnat)", () => {
    const start = referencePeriodStart(4, new Date(2026, 7, 27, 15, 30));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3);
    expect(start.getDate()).toBe(27);
    expect(start.getHours()).toBe(0);
  });
});
