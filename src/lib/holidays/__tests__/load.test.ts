import { describe, expect, it } from "vitest";
import { withDaysOff } from "@/lib/coverage/load";
import { createDayOffLookup, normalizeDayOffConfig } from "../danish";
import { legacyExtra, personalCalendarBlock, pickCalendarRow } from "../load";

type Row = Parameters<typeof pickCalendarRow>[0][number];

function row(over: Partial<Row>): Row {
  return {
    id: "x",
    organizationId: null,
    departmentId: null,
    userId: null,
    preset: "private",
    optionalDays: {},
    customDays: [],
    updatedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

describe("pickCalendarRow", () => {
  const rows = [
    row({ id: "org", organizationId: "o1" }),
    row({ id: "dept", organizationId: "o1", departmentId: "d1" }),
    row({ id: "own", userId: "u1" }),
  ];

  it("afdeling > org > egen > standard", () => {
    expect(pickCalendarRow(rows, "o1", "d1", "u1")).toMatchObject({
      source: "department",
      row: { id: "dept" },
    });
    expect(pickCalendarRow(rows, "o1", "d2", "u1")).toMatchObject({
      source: "org",
      row: { id: "org" },
    });
    expect(pickCalendarRow(rows.slice(2), "o1", null, "u1")).toMatchObject({
      source: "user",
      row: { id: "own" },
    });
    expect(pickCalendarRow([], "o1", null, "u1")).toEqual({
      source: "default",
      row: null,
    });
  });

  it("medarbejder (#742): egen kalender ignoreres, også uden org-kalender", () => {
    const own = rows.slice(2);
    expect(
      pickCalendarRow(own, "o1", null, "u1", { allowPersonal: false }),
    ).toEqual({ source: "default", row: null });
    expect(
      pickCalendarRow(rows, "o1", "d1", "u1", { allowPersonal: false }).source,
    ).toBe("department");
    expect(
      pickCalendarRow(rows, "o1", null, "u1", { allowPersonal: false }).source,
    ).toBe("org");
  });

  it("afdelingsrækken tæller ikke som org'ens kalender", () => {
    expect(pickCalendarRow([rows[1]], "o1", null, null).source).toBe("default");
  });
});

describe("personalCalendarBlock (#742)", () => {
  it("org- eller afdelingskalender bestemmer", () => {
    expect(personalCalendarBlock("department", false)).toBe("department");
    expect(personalCalendarBlock("org", false)).toBe("org");
    expect(personalCalendarBlock("org", true)).toBe("org");
  });

  it("medarbejder med HR-normtid kan ikke vælge egen kalender", () => {
    expect(personalCalendarBlock("default", true)).toBe("employee");
  });

  it("selvstændig uden org-kalender må gerne", () => {
    expect(personalCalendarBlock("default", false)).toBeNull();
    expect(personalCalendarBlock("user", false)).toBeNull();
  });
});

describe("legacyExtra", () => {
  const legacy = [
    {
      date: "2026-12-24",
      name: "Juleaftensdag",
      isHalfDay: false,
      isSystem: true,
    },
    {
      date: "2026-08-14",
      name: "Sommerfest",
      isHalfDay: false,
      isSystem: false,
    },
  ];

  it("genererede rækker gælder kun, til org'en har valgt en kalender", () => {
    expect(legacyExtra(legacy, "default")).toHaveLength(2);
    expect(legacyExtra(legacy, "user")).toHaveLength(1);
    expect(legacyExtra(legacy, "org").map((d) => d.name)).toEqual([
      "Sommerfest",
    ]);
    expect(legacyExtra(legacy, "department")).toHaveLength(1);
  });
});

describe("withDaysOff", () => {
  const lookup = createDayOffLookup(
    normalizeDayOffConfig({
      preset: "private",
      customDays: [{ date: "2026-08-14", name: "Fest", isHalfDay: true }],
    }),
  );
  const hoursFor = withDaysOff(lookup, () => 7.4);

  it("hel fridag = 0 t, halv = halvdelen, ellers uændret", () => {
    expect(hoursFor("2026-12-25")).toBe(0);
    expect(hoursFor("2026-08-14")).toBe(3.7);
    expect(hoursFor("2026-08-13")).toBe(7.4);
  });

  it("dag uden arbejdstid forbliver 0", () => {
    expect(withDaysOff(lookup, () => 0)("2026-08-14")).toBe(0);
  });
});
