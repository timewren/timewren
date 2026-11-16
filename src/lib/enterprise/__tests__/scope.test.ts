import { describe, expect, it } from "vitest";
import {
  isManagershipActive,
  type Managership,
  resolveVisibleProfileIds,
  type ScopeProfile,
} from "../scope";

// Org med to afdelinger. Anna er profil-leder (managerId) for Bo; Carl er i
// afdeling X uden managerId; Dorte i afdeling Y; Erik er inaktiv i X.
const P = (
  id: string,
  departmentId: string | null,
  managerId: string | null = null,
  isActive = true,
): ScopeProfile => ({
  id,
  userId: `u-${id}`,
  departmentId,
  managerId,
  isActive,
});

const profiles: ScopeProfile[] = [
  P("anna", "X"),
  P("bo", "Y", "anna"),
  P("carl", "X"),
  P("dorte", "Y"),
  P("erik", "X", null, false),
];

const TODAY = "2026-08-27";

function ids(role: string, managerships: Managership[] = []) {
  return Array.from(
    resolveVisibleProfileIds({
      role,
      selfProfileId: "anna",
      profiles,
      managerships,
      today: TODAY,
    }).profileIds,
  ).sort();
}

describe("resolveVisibleProfileIds", () => {
  it("owner/admin/hr ser hele organisationen", () => {
    for (const role of ["owner", "admin", "hr"]) {
      const r = resolveVisibleProfileIds({
        role,
        selfProfileId: "anna",
        profiles,
        managerships: [],
        today: TODAY,
      });
      expect(r.all).toBe(true);
      expect(r.profileIds.size).toBe(profiles.length);
    }
  });

  it("member ser kun sig selv", () => {
    expect(ids("member")).toEqual(["anna"]);
  });

  it("manager uden afdelingsansvar ser sig selv + direkte reports", () => {
    expect(ids("manager")).toEqual(["anna", "bo"]);
  });

  it("manager som lead for X ser alle i X (også uden managerId) ∪ reports", () => {
    expect(
      ids("manager", [
        { departmentId: "X", role: "lead", validFrom: null, validTo: null },
      ]),
    ).toEqual(["anna", "bo", "carl", "erik"]);
  });

  it("deputy med gyldig periode giver adgang til afdelingen", () => {
    expect(
      ids("manager", [
        {
          departmentId: "Y",
          role: "deputy",
          validFrom: "2026-08-01",
          validTo: "2026-08-31",
        },
      ]),
    ).toEqual(["anna", "bo", "dorte"]);
  });

  it("deputy uden for perioden giver INGEN adgang", () => {
    expect(
      ids("manager", [
        {
          departmentId: "Y",
          role: "deputy",
          validFrom: "2026-09-01",
          validTo: null,
        },
      ]),
    ).toEqual(["anna", "bo"]);
    expect(
      ids("manager", [
        {
          departmentId: "Y",
          role: "deputy",
          validFrom: null,
          validTo: "2026-08-26",
        },
      ]),
    ).toEqual(["anna", "bo"]);
  });

  it("all-flaget er false for manager selv med mange afdelinger", () => {
    const r = resolveVisibleProfileIds({
      role: "manager",
      selfProfileId: "anna",
      profiles,
      managerships: [
        { departmentId: "X", role: "lead", validFrom: null, validTo: null },
        { departmentId: "Y", role: "lead", validFrom: null, validTo: null },
      ],
      today: TODAY,
    });
    expect(r.all).toBe(false);
    expect(r.profileIds.size).toBe(profiles.length);
  });
});

describe("isManagershipActive", () => {
  const m = (
    validFrom: string | null,
    validTo: string | null,
  ): Managership => ({
    departmentId: "X",
    role: "deputy",
    validFrom,
    validTo,
  });
  it("åbne ender = ubegrænset", () => {
    expect(isManagershipActive(m(null, null), TODAY)).toBe(true);
  });
  it("grænsedatoer er inklusive", () => {
    expect(isManagershipActive(m(TODAY, TODAY), TODAY)).toBe(true);
  });
  it("før/efter perioden er inaktiv", () => {
    expect(isManagershipActive(m("2026-08-28", null), TODAY)).toBe(false);
    expect(isManagershipActive(m(null, "2026-08-26"), TODAY)).toBe(false);
  });
});
