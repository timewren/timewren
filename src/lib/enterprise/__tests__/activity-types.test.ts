import { describe, expect, it } from "vitest";
import {
  allowedActivitiesForProject,
  buildTimesheetRows,
  DEFAULT_ACTIVITY_TYPES,
  EMPTY_ROW_STATE,
  type GridActivityType,
  type GridEntry,
  groupTimesheetRows,
  planDefaultActivityTypes,
  timesheetRowKey,
  timesheetRowStateKey,
} from "../activity-types";
import { buildPayrollDetailsCsv, buildPayrollSummaryCsv } from "../payroll-csv";
import {
  cellsFromTemplateData,
  cellsFromWeekEntries,
  planWeekFill,
  templateDataFromCells,
  weekCellKey,
} from "../timesheet";

const DAYS = [
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
  "2026-09-11",
  "2026-09-12",
  "2026-09-13",
];

const UNDERVISNING: GridActivityType = {
  id: "act-u",
  name: "Undervisning",
  color: "#3b82f6",
  sortOrder: 0,
  isArchived: false,
};
const FORBEREDELSE: GridActivityType = {
  id: "act-f",
  name: "Forberedelse",
  color: "#10b981",
  sortOrder: 1,
  isArchived: false,
};
const MOEDER: GridActivityType = {
  id: "act-m",
  name: "Møder",
  color: "#f59e0b",
  sortOrder: 2,
  isArchived: false,
};
const GAMMEL: GridActivityType = {
  id: "act-old",
  name: "Gammel",
  color: "#000000",
  sortOrder: 9,
  isArchived: true,
};
const ALL_TYPES = [UNDERVISNING, FORBEREDELSE, MOEDER, GAMMEL];

const PROJECTS = [
  { id: "p-dansk", name: "Dansk hold A", availableToAll: false },
  { id: "p-mat", name: "Matematik", availableToAll: true },
  { id: "p-loes", name: "Løst projekt", availableToAll: false },
];

function entry(
  overrides: Partial<GridEntry> & { projectId: string | null; hours: number },
): GridEntry {
  return {
    projectName:
      PROJECTS.find((p) => p.id === overrides.projectId)?.name ?? null,
    activityTypeId: null,
    date: DAYS[0],
    source: "timesheet",
    ...overrides,
  };
}

describe("planDefaultActivityTypes", () => {
  it("opretter alle fem for en tom org med Undervisning som standard", () => {
    const plan = planDefaultActivityTypes([]);
    expect(plan.map((t) => t.name)).toEqual(
      DEFAULT_ACTIVITY_TYPES.map((t) => t.name),
    );
    expect(plan.filter((t) => t.isDefault).map((t) => t.name)).toEqual([
      "Undervisning",
    ]);
    expect(plan.map((t) => t.sortOrder)).toEqual([0, 1, 2, 3, 4]);
  });

  it("springer eksisterende (også arkiverede, case-insensitivt) over og lægger nye sidst", () => {
    const plan = planDefaultActivityTypes([
      { name: "undervisning", isDefault: true, sortOrder: 0 },
      { name: "Møder", isDefault: false, sortOrder: 3 },
    ]);
    expect(plan.map((t) => t.name)).toEqual([
      "Forberedelse",
      "Administration",
      "Andet",
    ]);
    expect(plan.every((t) => !t.isDefault)).toBe(true);
    expect(plan.map((t) => t.sortOrder)).toEqual([4, 5, 6]);
  });
});

describe("allowedActivitiesForProject", () => {
  it("tom tilladt-liste = alle aktive typer i rækkefølge", () => {
    const allowed = allowedActivitiesForProject(
      "p-dansk",
      ALL_TYPES,
      new Map(),
    );
    expect(allowed.map((t) => t.id)).toEqual(["act-u", "act-f", "act-m"]);
  });

  it("indsnævret liste respekteres og arkiverede udelades", () => {
    const allowed = allowedActivitiesForProject(
      "p-dansk",
      ALL_TYPES,
      new Map([["p-dansk", new Set(["act-m", "act-u", "act-old"])]]),
    );
    expect(allowed.map((t) => t.id)).toEqual(["act-u", "act-m"]);
  });
});

describe("buildTimesheetRows uden aktivitetstyper (uændret adfærd)", () => {
  it("giver præcis én række pr. projekt og ignorerer posternes aktivitet", () => {
    const { rows, hiddenProjects } = buildTimesheetRows({
      entries: [
        entry({ projectId: "p-dansk", hours: 3, activityTypeId: "act-u" }),
        entry({ projectId: "p-dansk", hours: 2, source: "timer" }),
        entry({ projectId: null, hours: 1 }),
      ],
      days: DAYS,
      orgProjects: PROJECTS,
      assignedProjectIds: new Set(["p-loes"]),
      hiddenProjectIds: new Set(),
      activityTypes: [],
      allowedByProject: new Map(),
    });
    expect(hiddenProjects).toEqual([]);
    expect(
      rows.map((r) => [r.projectName, r.activityTypeId, r.source]),
    ).toEqual([
      ["Dansk hold A", null, "entries"],
      ["Løst projekt", null, "assigned"],
      ["Matematik", null, "all"],
      ["Uden projekt", null, "entries"],
    ]);
    expect(rows[0].activityName).toBeNull();
    expect(rows[0].days[DAYS[0]]).toEqual({
      total: 5,
      timesheetHours: 3,
      note: null,
    });
  });

  it("lægger skjulte faste projekter uden timer i hiddenProjects", () => {
    const { rows, hiddenProjects } = buildTimesheetRows({
      entries: [],
      days: DAYS,
      orgProjects: PROJECTS,
      assignedProjectIds: new Set(),
      hiddenProjectIds: new Set(["p-mat"]),
      activityTypes: [],
      allowedByProject: new Map(),
    });
    expect(rows).toEqual([]);
    expect(hiddenProjects).toEqual([{ id: "p-mat", name: "Matematik" }]);
  });
});

describe("buildTimesheetRows med aktivitetstyper", () => {
  it("giver projekt × tilladte aktiviteter, legacy-poster som '(uden aktivitet)' sidst", () => {
    const { rows } = buildTimesheetRows({
      entries: [
        entry({
          projectId: "p-dansk",
          hours: 4,
          activityTypeId: "act-u",
        }),
        entry({
          projectId: "p-dansk",
          hours: 1.5,
          activityTypeId: "act-u",
          date: DAYS[1],
          source: "timer",
        }),
        // legacy uden aktivitet
        entry({ projectId: "p-dansk", hours: 2, date: DAYS[2] }),
        // arkiveret type med post — vises, men er ikke standardrække
        entry({ projectId: "p-mat", hours: 1, activityTypeId: "act-old" }),
      ],
      days: DAYS,
      orgProjects: PROJECTS,
      assignedProjectIds: new Set(),
      hiddenProjectIds: new Set(),
      activityTypes: ALL_TYPES,
      allowedByProject: new Map([["p-dansk", new Set(["act-u", "act-f"])]]),
    });

    expect(rows.map((r) => `${r.projectName} / ${r.activityName}`)).toEqual([
      "Dansk hold A / Undervisning",
      "Dansk hold A / Forberedelse",
      "Dansk hold A / (uden aktivitet)",
      "Matematik / Undervisning",
      "Matematik / Forberedelse",
      "Matematik / Møder",
      "Matematik / Gammel",
    ]);
    const undervisning = rows[0];
    expect(undervisning.activityTypeId).toBe("act-u");
    expect(undervisning.activityColor).toBe("#3b82f6");
    expect(undervisning.days[DAYS[0]]).toEqual({
      total: 4,
      timesheetHours: 4,
      note: null,
    });
    expect(undervisning.days[DAYS[1]]).toEqual({
      total: 1.5,
      timesheetHours: 0,
      note: null,
    });
    // Legacy-rækken kan redigeres (activityTypeId null) og har sine egne timer
    expect(rows[2].activityTypeId).toBeNull();
    expect(rows[2].days[DAYS[2]]).toEqual({
      total: 2,
      timesheetHours: 2,
      note: null,
    });
    // Tomme standardrækker findes uden dage
    expect(rows[1].days).toEqual({});
  });

  it("faste projekter uden timer får tilladte aktiviteter som tomme rækker", () => {
    const { rows } = buildTimesheetRows({
      entries: [],
      days: DAYS,
      orgProjects: PROJECTS,
      assignedProjectIds: new Set(["p-loes"]),
      hiddenProjectIds: new Set(["p-mat"]),
      activityTypes: ALL_TYPES,
      allowedByProject: new Map([["p-loes", new Set(["act-m"])]]),
    });
    expect(rows.map((r) => [r.projectName, r.activityName, r.source])).toEqual([
      ["Løst projekt", "Møder", "assigned"],
    ]);
  });

  it("rækkenøglen er (projekt, aktivitet)", () => {
    expect(timesheetRowKey("p", "a")).toBe("p|a");
    expect(timesheetRowKey("p", null)).toBe("p|");
    expect(timesheetRowKey(null, null)).toBe("none|");
  });
});

describe("groupTimesheetRows (#475): kollaps, kun-med-timer, tilføj aktivitet", () => {
  // kunde-scenariet: 3 aktiviteter × 2 projekter + legacy-række
  const { rows } = buildTimesheetRows({
    entries: [
      entry({ projectId: "p-dansk", hours: 4, activityTypeId: "act-u" }),
      entry({ projectId: "p-dansk", hours: 2, date: DAYS[2] }), // legacy
    ],
    days: DAYS,
    orgProjects: PROJECTS,
    assignedProjectIds: new Set(["p-dansk", "p-loes"]),
    hiddenProjectIds: new Set(),
    activityTypes: ALL_TYPES,
    allowedByProject: new Map(),
  });

  it("projekter uden timer er kollapset som standard; med timer ekspanderet", () => {
    const groups = groupTimesheetRows(rows, {
      days: DAYS,
      state: EMPTY_ROW_STATE,
    });
    expect(groups.map((g) => [g.projectName, g.expanded, g.total])).toEqual([
      ["Dansk hold A", true, 6],
      ["Løst projekt", false, 0],
      ["Matematik", false, 0],
    ]);
    expect(groups.map((g) => g.activityCount)).toEqual([4, 3, 3]);
  });

  it("en ekspanderet gruppe viser kun aktiviteter med timer — resten er addable", () => {
    const [dansk, loes] = groupTimesheetRows(rows, {
      days: DAYS,
      state: EMPTY_ROW_STATE,
    });
    expect(dansk.rows.map((r) => r.activityName)).toEqual([
      "Undervisning",
      "(uden aktivitet)",
    ]);
    expect(dansk.addable.map((a) => a.name)).toEqual(["Forberedelse", "Møder"]);
    // Projekt uden timer: ingen synlige rækker, alle tilladte kan tilføjes
    expect(loes.rows).toEqual([]);
    expect(loes.addable.map((a) => a.id)).toEqual(["act-u", "act-f", "act-m"]);
  });

  it("legacy-rækken '(uden aktivitet)' vises kun når den har timer", () => {
    const { rows: noLegacyHours } = buildTimesheetRows({
      entries: [
        entry({ projectId: "p-mat", hours: 1, activityTypeId: "act-m" }),
      ],
      days: DAYS,
      orgProjects: PROJECTS,
      assignedProjectIds: new Set(),
      hiddenProjectIds: new Set(),
      activityTypes: ALL_TYPES,
      allowedByProject: new Map(),
    });
    const [mat] = groupTimesheetRows(noLegacyHours, {
      days: DAYS,
      state: EMPTY_ROW_STATE,
    });
    expect(mat.rows.map((r) => r.activityName)).toEqual(["Møder"]);
    expect(mat.addable.map((a) => a.name)).not.toContain("(uden aktivitet)");
  });

  it("brugerens toggles overstyrer standarden og tilføjede rækker vises tomme", () => {
    const groups = groupTimesheetRows(rows, {
      days: DAYS,
      state: {
        toggles: { "p-dansk": "closed", "p-loes": "open" },
        added: [timesheetRowKey("p-loes", "act-m")],
      },
    });
    expect(groups.map((g) => [g.projectName, g.expanded])).toEqual([
      ["Dansk hold A", false],
      ["Løst projekt", true],
      ["Matematik", false],
    ]);
    const loes = groups[1];
    expect(loes.rows.map((r) => r.activityName)).toEqual(["Møder"]);
    expect(loes.rows[0].days).toEqual({});
    expect(loes.addable.map((a) => a.id)).toEqual(["act-u", "act-f"]);
  });

  it("uden aktivitetstyper vises alle projektrækker altid (uændret adfærd)", () => {
    const { rows: flat } = buildTimesheetRows({
      entries: [],
      days: DAYS,
      orgProjects: PROJECTS,
      assignedProjectIds: new Set(["p-loes"]),
      hiddenProjectIds: new Set(),
      activityTypes: [],
      allowedByProject: new Map(),
    });
    const groups = groupTimesheetRows(flat, {
      days: DAYS,
      state: EMPTY_ROW_STATE,
      activityMode: false,
    });
    expect(
      groups.map((g) => [g.projectName, g.expanded, g.rows.length]),
    ).toEqual([
      ["Løst projekt", true, 1],
      ["Matematik", true, 1],
    ]);
  });

  it("rækketilstanden gemmes pr. org og bruger", () => {
    expect(timesheetRowStateKey("org-1", "user-9")).toBe(
      "timesheet:rowState:org-1:user-9",
    );
  });
});

describe("skabeloner og kopiér uge bevarer aktivitet (#475)", () => {
  const weekStart = new Date(2026, 8, 7);
  const cells = cellsFromWeekEntries(
    [
      {
        projectId: "p",
        activityTypeId: "act-u",
        date: new Date(2026, 8, 7, 8),
        hours: 4,
      },
      {
        projectId: "p",
        activityTypeId: "act-f",
        date: new Date(2026, 8, 7, 13),
        hours: 2,
      },
      {
        projectId: "p",
        activityTypeId: null,
        date: new Date(2026, 8, 9),
        hours: 1,
      },
    ],
    weekStart,
  );

  it("skabelon: celler → templateData → celler er identitet inkl. aktivitet", () => {
    const templateData = templateDataFromCells(cells);
    expect(templateData).toEqual([
      { projectId: "p", activityTypeId: "act-u", dayOfWeek: 1, hours: 4 },
      { projectId: "p", activityTypeId: "act-f", dayOfWeek: 1, hours: 2 },
      { projectId: "p", activityTypeId: null, dayOfWeek: 3, hours: 1 },
    ]);
    expect(cellsFromTemplateData(templateData)).toEqual(cells);
  });

  it("skabeloner fra før #459 (uden activityTypeId) lander uden aktivitet", () => {
    expect(
      cellsFromTemplateData([{ projectId: "p", dayOfWeek: 2, hours: 3 }]),
    ).toEqual([
      { projectId: "p", activityTypeId: null, dayOffset: 1, hours: 3 },
    ]);
  });

  it("kopiér uge: aktiviteten følger med, og optagede (projekt, aktivitet, dag) springes over", () => {
    const { toInsert, skipped } = planWeekFill({
      cells,
      // Undervisning mandag er allerede udfyldt i målugen — Forberedelse samme dag er fri
      occupied: new Set([weekCellKey("p", "act-u", 0)]),
      knownProjectIds: new Set(["p"]),
      isActivityAllowed: () => true,
    });
    expect(toInsert).toEqual([
      { projectId: "p", activityTypeId: "act-f", dayOffset: 0, hours: 2 },
      { projectId: "p", activityTypeId: null, dayOffset: 2, hours: 1 },
    ]);
    expect(skipped).toBe(1);
  });

  it("aktivitet der ikke længere er tilladt, eller ukendt projekt, springes over", () => {
    const { toInsert, skipped } = planWeekFill({
      cells: [
        ...cells,
        {
          projectId: "ukendt",
          activityTypeId: "act-u",
          dayOffset: 4,
          hours: 1,
        },
        { projectId: "p", activityTypeId: "act-u", dayOffset: 9, hours: 1 },
      ],
      occupied: new Set(),
      knownProjectIds: new Set(["p"]),
      isActivityAllowed: (_p, a) => a !== "act-f",
    });
    expect(toInsert.map((c) => [c.activityTypeId, c.dayOffset])).toEqual([
      ["act-u", 0],
      [null, 2],
    ]);
    // Forberedelse (ikke tilladt) + ukendt projekt; dag 9 ignoreres stille
    expect(skipped).toBe(2);
  });
});

describe("cellsFromWeekEntries konsoliderer pr. (projekt, aktivitet, dag)", () => {
  const weekStart = new Date(2026, 8, 7);
  const day = (offset: number, hour = 8) => new Date(2026, 8, 7 + offset, hour);

  it("holder aktiviteter adskilt og summer inden for samme nøgle", () => {
    const cells = cellsFromWeekEntries(
      [
        { projectId: "p", activityTypeId: "a", date: day(0), hours: "2.00" },
        { projectId: "p", activityTypeId: "a", date: day(0, 13), hours: "1.5" },
        { projectId: "p", activityTypeId: "b", date: day(0), hours: 3 },
        { projectId: "p", activityTypeId: null, date: day(0), hours: 0.5 },
        { projectId: "p", date: day(1), hours: 4 },
        { projectId: null, activityTypeId: "a", date: day(1), hours: 9 },
      ],
      weekStart,
    ).sort(
      (x, y) =>
        x.dayOffset - y.dayOffset ||
        (x.activityTypeId ?? "").localeCompare(y.activityTypeId ?? ""),
    );
    expect(cells).toEqual([
      { projectId: "p", activityTypeId: null, dayOffset: 0, hours: 0.5 },
      { projectId: "p", activityTypeId: "a", dayOffset: 0, hours: 3.5 },
      { projectId: "p", activityTypeId: "b", dayOffset: 0, hours: 3 },
      { projectId: "p", activityTypeId: null, dayOffset: 1, hours: 4 },
    ]);
  });
});

describe("lønrapport-CSV med aktivitet", () => {
  const employee = {
    name: "Anne Hansen",
    email: "anne@example.dk",
    department: "Almen",
    weeklyHours: 37,
    totalHours: 10,
    breakDeductedHours: 0,
    flexDelta: -1.5,
    absences: { Sygdom: 1 },
    absenceHours: { Sygdom: 7.4 },
    activityHours: { Undervisning: 6, Forberedelse: 4 },
  };

  it("oversigten får én timer-kolonne pr. aktivitetstype", () => {
    const csv = buildPayrollSummaryCsv({
      employees: [employee],
      absenceTypes: ["Sygdom"],
      activityTypes: ["Undervisning", "Forberedelse", "Møder"],
      showBreak: false,
    });
    const [header, row] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toBe(
      "Medarbejder;Email;Afdeling;Timer/uge;Registrerede timer;Undervisning (timer);Forberedelse (timer);Møder (timer);Flex (+/-);Sygdom (dage);Sygdom (timer)",
    );
    expect(row).toBe(
      "Anne Hansen;anne@example.dk;Almen;37,00;10,00;6,00;4,00;0,00;-1,50;1,00;7,40",
    );
  });

  it("uden aktivitetstyper er oversigten som før", () => {
    const csv = buildPayrollSummaryCsv({
      employees: [employee],
      absenceTypes: [],
      activityTypes: [],
      showBreak: false,
    });
    const [header] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toBe(
      "Medarbejder;Email;Afdeling;Timer/uge;Registrerede timer;Flex (+/-)",
    );
  });

  it("detaljerne får Aktivitet- og Lønart-kolonner", () => {
    const csv = buildPayrollDetailsCsv([
      {
        name: "Anne Hansen",
        email: "anne@example.dk",
        department: "Almen",
        date: "2026-09-07",
        hours: 4,
        project: "Dansk hold A",
        activity: "Undervisning",
        payrollCode: "1010",
        description: "Timeseddel",
        source: "timesheet",
      },
    ]);
    const [header, row] = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toBe(
      "Medarbejder;Email;Afdeling;Dato;Timer;Projekt;Aktivitet;Lønart;Beskrivelse;Kilde",
    );
    expect(row).toBe(
      "Anne Hansen;anne@example.dk;Almen;2026-09-07;4,00;Dansk hold A;Undervisning;1010;Timeseddel;timesheet",
    );
  });
});
