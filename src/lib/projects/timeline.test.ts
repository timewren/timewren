import { describe, expect, it } from "vitest";
import {
  projectEndDateState,
  projectPaceWarning,
  shouldNotifyProjectEndDate,
} from "./timeline";

// Slutdatoer gemmes som UTC-midnat på datoen (new Date("yyyy-MM-dd"))
const end = (d: string) => new Date(d);

describe("projectEndDateState", () => {
  const today = "2026-10-02";

  it("intet for projekter uden slutdato eller som ikke er aktive", () => {
    expect(
      projectEndDateState({ status: "active", endDate: null }, today),
    ).toBe(null);
    expect(
      projectEndDateState(
        { status: "completed", endDate: end("2026-09-01") },
        today,
      ),
    ).toBe(null);
    expect(
      projectEndDateState(
        { status: "on_hold", endDate: end("2026-10-03") },
        today,
      ),
    ).toBe(null);
  });

  it("slutdato i dag er ikke overskredet endnu", () => {
    expect(
      projectEndDateState({ status: "active", endDate: end(today) }, today),
    ).toEqual({ kind: "soon", daysLeft: 0 });
  });

  it("overskredet fra dagen efter", () => {
    expect(
      projectEndDateState(
        { status: "active", endDate: end("2026-10-01") },
        today,
      ),
    ).toEqual({ kind: "overdue", daysOverdue: 1 });
  });

  it("snart inden for 7 dage, ellers intet", () => {
    expect(
      projectEndDateState(
        { status: "active", endDate: "2026-10-09T00:00:00.000Z" },
        today,
      ),
    ).toEqual({ kind: "soon", daysLeft: 7 });
    expect(
      projectEndDateState(
        { status: "active", endDate: end("2026-10-10") },
        today,
      ),
    ).toBe(null);
  });

  it("null-status behandles som aktiv", () => {
    expect(
      projectEndDateState({ status: null, endDate: end("2026-10-03") }, today),
    ).toEqual({ kind: "soon", daysLeft: 1 });
  });
});

describe("shouldNotifyProjectEndDate", () => {
  it.each([
    [{ kind: "soon", daysLeft: 7 } as const, true],
    [{ kind: "soon", daysLeft: 5 } as const, false],
    [{ kind: "soon", daysLeft: 0 } as const, true],
    [{ kind: "overdue", daysOverdue: 1 } as const, true],
    [{ kind: "overdue", daysOverdue: 2 } as const, false],
    [{ kind: "overdue", daysOverdue: 30 } as const, true],
    [null, false],
  ])("%j → %s", (state, expected) => {
    expect(shouldNotifyProjectEndDate(state)).toBe(expected);
  });
});

describe("projectPaceWarning", () => {
  const project = {
    status: "active",
    startDate: end("2026-10-01"),
    endDate: end("2026-10-10"), // 10 dage inkl. slutdatoen
  };

  it("advarer når budgettet løber ≥ 20 procentpoint foran tiden", () => {
    // 4 af 10 dage gået = 40 %
    expect(projectPaceWarning(project, 70, "2026-10-05")).toEqual({
      elapsedPercent: 40,
      budgetPercent: 70,
    });
  });

  it("ingen advarsel når forbruget følger tiden", () => {
    expect(projectPaceWarning(project, 55, "2026-10-05")).toBe(null);
  });

  it("ingen advarsel uden budget, datoer, eller med brugt-op budget", () => {
    expect(projectPaceWarning(project, null, "2026-10-05")).toBe(null);
    expect(projectPaceWarning(project, 120, "2026-10-05")).toBe(null);
    expect(
      projectPaceWarning({ ...project, startDate: null }, 70, "2026-10-05"),
    ).toBe(null);
    expect(
      projectPaceWarning({ ...project, status: "completed" }, 70, "2026-10-05"),
    ).toBe(null);
  });

  it("ingen advarsel før projektstart", () => {
    expect(projectPaceWarning(project, 50, "2026-09-20")).toBe(null);
  });
});
