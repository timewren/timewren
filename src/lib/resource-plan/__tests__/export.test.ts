import { describe, expect, it } from "vitest";
import {
  csvCell,
  memberWeekTotals,
  type ResourcePlanGrid,
  resourcePlanCsv,
} from "../export";

const w1 = "2026-10-05";
const w2 = "2026-10-12";
const cap = (capacity: number, absenceHours = 0) => ({
  normHours: capacity + absenceHours,
  absenceHours,
  capacity,
});

const grid: ResourcePlanGrid = {
  weeks: [w1, w2],
  today: "2026-10-14",
  members: [
    {
      userId: "u1",
      name: "Anna",
      capacity: { [w1]: cap(37), [w2]: cap(29.6, 7.4) },
    },
  ],
  rows: [
    {
      key: "u1|p1|",
      userId: "u1",
      projectId: "p1",
      activityTypeId: null,
      unplanned: false,
      planned: { [w1]: 20, [w2]: 35 },
      registered: { [w1]: 18.5 },
      projectName: "Dansk 2.g",
      clientName: null,
      activityName: "Undervisning",
    },
    {
      key: "u1|p2|",
      userId: "u1",
      projectId: "p2",
      activityTypeId: null,
      unplanned: true,
      planned: {},
      registered: { [w1]: 2 },
      projectName: "=HYPERLINK()",
      clientName: "Kunde; A/S",
      activityName: null,
    },
  ],
};

describe("csvCell", () => {
  it("dansk tal, citering og formel-værn", () => {
    expect(csvCell(7.5)).toBe("7,5");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('sig "hej"')).toBe('"sig ""hej"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@x")).toBe("'@x");
  });
});

describe("memberWeekTotals", () => {
  it("summerer pr. uge på tværs af projekter", () => {
    expect(memberWeekTotals(grid.rows, "u1", grid.weeks)).toEqual({
      planned: { [w1]: 20, [w2]: 35 },
      registered: { [w1]: 20.5, [w2]: 0 },
    });
  });
});

describe("resourcePlanCsv", () => {
  it("uge-grid med kapacitet, booking og rækker", () => {
    const csv = resourcePlanCsv(grid, "grid");
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "Medarbejder;Projekt;Kunde;Aktivitet;Linje;Uge 41 (2026-10-05);Uge 42 (2026-10-12);I alt",
    );
    expect(lines).toContain("Anna;;;;Kapacitet;37;29,6;66,6");
    expect(lines).toContain("Anna;;;;Booking;Underbooket;Overbooket;");
    expect(lines).toContain("Anna;Dansk 2.g;;Undervisning;Planlagt;20;35;55");
    expect(lines).toContain(
      `Anna;'=HYPERLINK();"Kunde; A/S";;Registreret;2;0;2`,
    );
  });

  it("opgaveoversigt med sum og kapacitet", () => {
    const lines = resourcePlanCsv(grid, "opgaveoversigt")
      .slice(1)
      .trimEnd()
      .split("\r\n");
    expect(lines[0]).toBe("Opgaveoversigt 2026-10-05 – 2026-10-18");
    expect(lines).toContain("Anna;Dansk 2.g;;Undervisning;55;18,5;-36,5");
    expect(lines).toContain("Anna;I alt;;;55;20,5;-34,5");
    expect(lines.at(-1)).toBe(
      'Anna;"Normtid 74 t · fravær 7,4 t · kapacitet 66,6 t · ikke planlagt 11,6 t"',
    );
  });
});
