import { describe, expect, it } from "vitest";
import { entryDateForStart } from "../entry-date";

// Køres i CI både med TZ=UTC (prod) og TZ=Europe/Copenhagen.
const day = (iso: string) => entryDateForStart(new Date(iso)).toISOString();

describe("entryDateForStart (#650: timer-stop over midnat)", () => {
  it("timer 23:30–00:30 dansk sommertid dateres på startdagen", () => {
    // start 30/9 23:30 CEST = 21:30Z; stop 1/10 00:30 CEST = 22:30Z
    expect(day("2026-09-30T21:30:00Z")).toBe("2026-09-30T00:00:00.000Z");
  });

  it("timer startet 00:30 dansk tid dateres på den danske dag, ikke UTC-dagen", () => {
    // 1/10 00:30 CEST = 30/9 22:30Z — i UTC er det stadig den 30.
    expect(day("2026-09-30T22:30:00Z")).toBe("2026-10-01T00:00:00.000Z");
  });

  it("natten til sommertid (sidste søndag i marts)", () => {
    // start lør 28/3 23:30 CET = 22:30Z, stop søn 03:30 CEST — startdagen
    expect(day("2026-03-28T22:30:00Z")).toBe("2026-03-28T00:00:00.000Z");
    // start søn 29/3 00:15 CET = 28/3 23:15Z — søndag
    expect(day("2026-03-28T23:15:00Z")).toBe("2026-03-29T00:00:00.000Z");
    // start søn 29/3 03:10 CEST = 01:10Z (lige efter skiftet)
    expect(day("2026-03-29T01:10:00Z")).toBe("2026-03-29T00:00:00.000Z");
  });

  it("natten til vintertid (sidste søndag i oktober)", () => {
    // start lør 24/10 23:30 CEST = 21:30Z — lørdag
    expect(day("2026-10-24T21:30:00Z")).toBe("2026-10-24T00:00:00.000Z");
    // start søn 25/10 00:30 CEST = 24/10 22:30Z — søndag
    expect(day("2026-10-24T22:30:00Z")).toBe("2026-10-25T00:00:00.000Z");
    // 02:30 forekommer to gange; begge er søndag
    expect(day("2026-10-25T00:30:00Z")).toBe("2026-10-25T00:00:00.000Z");
    expect(day("2026-10-25T01:30:00Z")).toBe("2026-10-25T00:00:00.000Z");
    // søn 25/10 23:30 CET = 22:30Z — stadig søndag (25-timers døgn)
    expect(day("2026-10-25T22:30:00Z")).toBe("2026-10-25T00:00:00.000Z");
    expect(day("2026-10-25T23:00:00Z")).toBe("2026-10-26T00:00:00.000Z");
  });

  it("vintertid: dansk midnat er 23:00Z", () => {
    expect(day("2026-12-31T22:59:00Z")).toBe("2026-12-31T00:00:00.000Z");
    expect(day("2026-12-31T23:00:00Z")).toBe("2027-01-01T00:00:00.000Z");
  });
});
