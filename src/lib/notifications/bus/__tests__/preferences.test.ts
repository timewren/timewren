import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DEFAULTS,
  effectiveUserMatrix,
  mergeMatrix,
  resolveUserChannels,
  sanitizeMatrix,
  teamsWanted,
} from "../preferences";

describe("mergeMatrix", () => {
  it("returnerer indbyggede defaults uden lag", () => {
    expect(mergeMatrix()).toEqual(BUILT_IN_DEFAULTS);
  });

  it("overskriver kun de kanaler laget nævner", () => {
    const m = mergeMatrix({ timesheet: { email: false } });
    expect(m.timesheet.email).toBe(false);
    expect(m.timesheet.in_app).toBe(true);
    expect(m.absence).toEqual(BUILT_IN_DEFAULTS.absence);
  });

  it("senere lag vinder over tidligere", () => {
    const m = mergeMatrix(
      { absence: { push: false } },
      { absence: { push: true } },
    );
    expect(m.absence.push).toBe(true);
  });

  it("ignorerer ukendte grupper, kanaler og ikke-boolske værdier", () => {
    const m = mergeMatrix({
      foo: { email: false },
      timesheet: { bar: false, email: "nej" },
    } as never);
    expect(m.timesheet.email).toBe(true);
  });
});

describe("resolveUserChannels", () => {
  it("uden præferencer: e-mail + in-app for timesedler (som før bussen)", () => {
    expect(resolveUserChannels({ event: "timesheet.submitted" })).toEqual([
      "in_app",
      "email",
    ]);
  });

  it("uden præferencer: push er med for fravær (som før bussen)", () => {
    expect(resolveUserChannels({ event: "absence.approved" })).toEqual([
      "in_app",
      "email",
      "push",
    ]);
  });

  it("org-default kan slå e-mail fra; bruger kan slå den til igen", () => {
    const orgDefaults = { timesheet: { email: false } };
    expect(
      resolveUserChannels({ event: "timesheet.approved", orgDefaults }),
    ).toEqual(["in_app"]);
    expect(
      resolveUserChannels({
        event: "timesheet.approved",
        orgDefaults,
        userPrefs: { timesheet: { email: true } },
      }),
    ).toEqual(["in_app", "email"]);
  });

  it("brugeren kan ikke styre Teams via egne præferencer", () => {
    const m = effectiveUserMatrix(null, { timesheet: { teams: false } });
    expect(m.timesheet.teams).toBe(BUILT_IN_DEFAULTS.timesheet.teams);
  });
});

describe("teamsWanted", () => {
  it("kræver at Teams er slået til på org'en", () => {
    expect(
      teamsWanted({ event: "timesheet.submitted", teamsEnabled: false }),
    ).toBe(false);
    expect(
      teamsWanted({ event: "timesheet.submitted", teamsEnabled: true }),
    ).toBe(true);
  });

  it("sender aldrig medarbejder-hændelser til Teams-kanalen", () => {
    expect(
      teamsWanted({ event: "timesheet.approved", teamsEnabled: true }),
    ).toBe(false);
    expect(teamsWanted({ event: "absence.rejected", teamsEnabled: true })).toBe(
      false,
    );
  });

  it("fravær er slået fra for Teams som default — org kan slå det til", () => {
    expect(
      teamsWanted({ event: "absence.requested", teamsEnabled: true }),
    ).toBe(false);
    expect(
      teamsWanted({
        event: "absence.sick_registered",
        teamsEnabled: true,
        orgDefaults: { absence: { teams: true } },
      }),
    ).toBe(true);
  });

  it("respekterer org-defaults pr. gruppe", () => {
    expect(
      teamsWanted({
        event: "timesheet.submitted",
        teamsEnabled: true,
        orgDefaults: { timesheet: { teams: false } },
      }),
    ).toBe(false);
  });
});

describe("sanitizeMatrix", () => {
  it("fjerner alt der ikke er kendt gruppe × kanal × boolean", () => {
    expect(
      sanitizeMatrix({
        timesheet: { email: false, teams: true, nope: true },
        junk: { email: true },
        absence: "x",
      }),
    ).toEqual({ timesheet: { email: false, teams: true } });
  });

  it("kan begrænses til bruger-kanaler", () => {
    expect(
      sanitizeMatrix({ timesheet: { email: false, teams: false } }, [
        "in_app",
        "email",
        "push",
      ]),
    ).toEqual({ timesheet: { email: false } });
  });
});
