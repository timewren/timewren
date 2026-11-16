import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_CATEGORY,
  AUDIT_ACTION_LABELS,
  type AuditDb,
  actionsInCategory,
  auditDiff,
  formatUserLabel,
  logOrgAudit,
  type OrgAuditAction,
  pickAuditFields,
} from "@/lib/org-audit";

describe("auditDiff (#466)", () => {
  it("finder kun ændrede felter på en medarbejderprofil", () => {
    const before = {
      role: "member",
      weeklyHours: "37.0",
      departmentId: "d1",
      isActive: true,
    };
    const after = {
      role: "manager",
      weeklyHours: "37.0",
      departmentId: null,
      isActive: true,
    };
    expect(auditDiff(before, after)).toEqual({
      role: { from: "member", to: "manager" },
      departmentId: { from: "d1", to: null },
    });
  });

  it("sammenligner arrays (arbejdsdage) på indhold, ikke reference", () => {
    expect(
      auditDiff({ workingDays: ["1", "2"] }, { workingDays: ["1", "2"] }),
    ).toEqual({});
    expect(
      auditDiff({ workingDays: ["1", "2"] }, { workingDays: ["1", "2", "3"] }),
    ).toEqual({ workingDays: { from: ["1", "2"], to: ["1", "2", "3"] } });
  });

  it("normaliserer Date og undefined så fravær-perioder kan diffes", () => {
    const d = new Date("2026-08-03T00:00:00.000Z");
    expect(auditDiff({ endDate: undefined }, { endDate: null })).toEqual({});
    expect(auditDiff({ approvedAt: d }, { approvedAt: d })).toEqual({});
    expect(
      auditDiff({ startDate: "2026-08-03" }, { startDate: "2026-08-04" }),
    ).toEqual({ startDate: { from: "2026-08-03", to: "2026-08-04" } });
  });

  it("aktivitetstype: arkivering ses som isArchived false→true", () => {
    const diff = auditDiff(
      { name: "Møder", isArchived: false },
      { name: "Møder", isArchived: true },
    );
    expect(diff).toEqual({ isArchived: { from: false, to: true } });
    expect(diff.isArchived?.to).toBe(true);
  });
});

describe("pickAuditFields", () => {
  it("plukker kun de angivne felter og tåler null-række", () => {
    const row = { id: "x", name: "A", color: "#fff", updatedAt: new Date() };
    expect(pickAuditFields(row, ["name", "color"])).toEqual({
      name: "A",
      color: "#fff",
    });
    expect(pickAuditFields(null, ["name"])).toEqual({});
  });
});

describe("audit-kategorier", () => {
  it("hver action har både dansk label og kategori", () => {
    const actions = Object.keys(AUDIT_ACTION_LABELS) as OrgAuditAction[];
    for (const a of actions) {
      expect(AUDIT_ACTION_LABELS[a].length).toBeGreaterThan(0);
      expect(AUDIT_ACTION_CATEGORY[a]).toBeDefined();
    }
    expect(Object.keys(AUDIT_ACTION_CATEGORY)).toHaveLength(actions.length);
  });

  it("actionsInCategory dækker de nye enterprise-hændelser", () => {
    expect(actionsInCategory("timesheets")).toEqual([
      "timesheet_week_submitted",
      "timesheet_week_approved",
      "timesheet_week_rejected",
      "timesheet_week_reopened",
      "period_closing_generated",
      "period_closing_refreshed",
      "period_closing_approved",
      "period_closing_acknowledged",
      "period_closing_unlocked",
    ]);
    expect(actionsInCategory("absence")).toContain("vacation_balance_adjusted");
    expect(actionsInCategory("absence")).toContain("absence_reported_well");
    expect(actionsInCategory("security")).toEqual([
      "sso_settings_updated",
      "domain_added",
      "domain_verified",
      "domain_removed",
      "admin_impersonation_started",
      "mcp_app_connected",
      "mcp_app_revoked",
    ]);
    expect(actionsInCategory("members")).toContain("member_auto_joined");
    expect(actionsInCategory("settings")).toContain("dpa_accepted");
    expect(actionsInCategory("employees")).toContain(
      "department_managers_updated",
    );
  });
});

describe("formatUserLabel / logOrgAudit actor_label (#479)", () => {
  it("formaterer navn og e-mail som snapshot", () => {
    expect(formatUserLabel({ name: "Vera", email: "vera@example.dk" })).toBe(
      "Vera (vera@example.dk)",
    );
    expect(formatUserLabel({ name: "  ", email: "vera@example.dk" })).toBe(
      "vera@example.dk",
    );
    expect(formatUserLabel({ name: "Vera", email: null })).toBe("Vera");
    expect(formatUserLabel(null)).toBeNull();
    expect(formatUserLabel(undefined)).toBeNull();
  });

  function fakeDb(userRow: { name: string; email: string } | undefined) {
    const inserted: Record<string, unknown>[] = [];
    const selectChain = {
      from: () => selectChain,
      where: () => selectChain,
      limit: async () => (userRow ? [userRow] : []),
    };
    const db = {
      select: () => selectChain,
      insert: () => ({
        values: async (v: Record<string, unknown>) => {
          inserted.push(v);
        },
      }),
    } as unknown as AuditDb;
    return { db, inserted };
  }

  it("udfylder actorLabel fra user-tabellen når det ikke er angivet", async () => {
    const { db, inserted } = fakeDb({
      name: "Bo Boss",
      email: "bo@example.dk",
    });
    await logOrgAudit(db, "org1", "boss", "member_removed", {
      targetUserId: "victim",
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      organizationId: "org1",
      actorId: "boss",
      actorLabel: "Bo Boss (bo@example.dk)",
      action: "member_removed",
      targetUserId: "victim",
    });
  });

  it("bruger en eksplicit actorLabel uden opslag", async () => {
    const { db, inserted } = fakeDb(undefined);
    await logOrgAudit(db, "org1", "cron", "vacation_year_rolled_over", {
      actorLabel: "System (cron)",
    });
    expect(inserted[0]).toMatchObject({ actorLabel: "System (cron)" });
  });

  it("skriver null-label når aktøren ikke findes", async () => {
    const { db, inserted } = fakeDb(undefined);
    await logOrgAudit(db, "org1", "ghost", "org_updated");
    expect(inserted[0]).toMatchObject({ actorId: "ghost", actorLabel: null });
  });
});
