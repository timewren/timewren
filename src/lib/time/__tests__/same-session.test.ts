import { describe, expect, it } from "vitest";
import {
  decideSameSessionMerge,
  isSameSessionStart,
  SAME_SESSION_START_TOLERANCE_MS,
} from "../same-session";

const start = new Date("2026-10-01T07:02:54Z");
const at = (iso: string) => new Date(iso);

const existing = {
  startTime: start,
  endTime: at("2026-10-01T07:34:00Z"),
  hours: "0.52",
  isBilled: false,
  invoiceId: null,
  projectId: "project-a",
  clientId: "client-a",
  source: "auto_track",
};

const sameOwner = { projectId: "project-a", clientId: "client-a" };

describe("isSameSessionStart", () => {
  it("matcher inden for ±2 s (kunde A: 07:02:54 / 07:02:55)", () => {
    expect(isSameSessionStart(start, at("2026-10-01T07:02:55Z"))).toBe(true);
    expect(isSameSessionStart(start, at("2026-10-01T07:02:52Z"))).toBe(true);
    expect(SAME_SESSION_START_TOLERANCE_MS).toBe(2000);
  });

  it("matcher ikke en anden session", () => {
    expect(isSameSessionStart(start, at("2026-10-01T07:02:57Z"))).toBe(false);
    expect(isSameSessionStart(start, null)).toBe(false);
  });
});

describe("decideSameSessionMerge", () => {
  it("ingen eksisterende post → indsæt", () => {
    expect(
      decideSameSessionMerge({
        existing: null,
        existingLocked: false,
        incoming: {
          ...sameOwner,
          startTime: start,
          endTime: at("2026-10-01T07:41:00Z"),
          hours: 0.64,
        },
      }),
    ).toEqual({ action: "insert" });
  });

  it("samme session gemt igen senere → forlæng den eksisterende post", () => {
    expect(
      decideSameSessionMerge({
        existing,
        existingLocked: false,
        incoming: {
          ...sameOwner,
          startTime: at("2026-10-01T07:02:55Z"),
          endTime: at("2026-10-01T07:43:00Z"),
          hours: 0.67,
        },
      }),
    ).toEqual({
      action: "merge",
      hours: 0.67,
      endTime: at("2026-10-01T07:43:00Z"),
      hoursChanged: true,
    });
  });

  it("web-gemte timer-poster (source manual) kan også forlænges", () => {
    expect(
      decideSameSessionMerge({
        existing: { ...existing, source: "manual" },
        existingLocked: false,
        incoming: {
          ...sameOwner,
          startTime: start,
          endTime: at("2026-10-01T07:43:00Z"),
          hours: 0.67,
        },
      }),
    ).toMatchObject({ action: "merge" });
  });

  it("en gentagelse med samme timer og slut ændrer intet", () => {
    const decision = decideSameSessionMerge({
      existing,
      existingLocked: false,
      incoming: {
        ...sameOwner,
        startTime: start,
        endTime: existing.endTime,
        hours: 0.52,
      },
    });
    expect(decision).toMatchObject({ action: "merge", hoursChanged: false });
  });

  it("afrunder til postens to decimaler (numeric(5,2))", () => {
    expect(
      decideSameSessionMerge({
        existing,
        existingLocked: false,
        incoming: {
          ...sameOwner,
          startTime: start,
          endTime: at("2026-10-01T07:45:00Z"),
          hours: 0.6666667,
        },
      }),
    ).toMatchObject({ action: "merge", hours: 0.67, hoursChanged: true });
  });

  it("anden kunde med samme start (kalender: 09–10 kunde A, 09–09:30 kunde B) → indsæt", () => {
    expect(
      decideSameSessionMerge({
        existing,
        existingLocked: false,
        incoming: {
          projectId: null,
          clientId: "client-b",
          startTime: start,
          endTime: at("2026-10-01T08:00:00Z"),
          hours: 1,
        },
      }),
    ).toEqual({ action: "insert" });
  });

  it("andet projekt på samme kunde → indsæt", () => {
    expect(
      decideSameSessionMerge({
        existing,
        existingLocked: false,
        incoming: {
          projectId: "project-a2",
          clientId: "client-a",
          startTime: start,
          endTime: at("2026-10-01T08:00:00Z"),
          hours: 1,
        },
      }),
    ).toEqual({ action: "insert" });
  });

  it("samme projekt: web gemmer uden kunde-id, extensionen med projektets kunde → samme ejer", () => {
    expect(
      decideSameSessionMerge({
        existing: { ...existing, source: "manual", clientId: null },
        existingLocked: false,
        incoming: {
          ...sameOwner,
          startTime: start,
          endTime: at("2026-10-01T08:00:00Z"),
          hours: 1,
        },
      }),
    ).toMatchObject({ action: "merge" });
  });

  it("projekt/kunde sammenlignes null-sikkert (intern tid uden kunde)", () => {
    expect(
      decideSameSessionMerge({
        existing: { ...existing, projectId: null, clientId: null },
        existingLocked: false,
        incoming: {
          projectId: undefined,
          clientId: null,
          startTime: start,
          endTime: at("2026-10-01T08:00:00Z"),
          hours: 1,
        },
      }),
    ).toMatchObject({ action: "merge" });
  });

  it("kalender-, import- og tilbagevendende poster opsluges aldrig af en timer", () => {
    for (const source of ["calendar", "import", "recurring", "api"]) {
      expect(
        decideSameSessionMerge({
          existing: { ...existing, source },
          existingLocked: false,
          incoming: {
            ...sameOwner,
            startTime: start,
            endTime: at("2026-10-01T08:00:00Z"),
            hours: 1,
          },
        }),
      ).toEqual({ action: "insert" });
    }
  });

  it("en gemning der slutter FØR den eksisterende post er ikke en gen-gemning → indsæt", () => {
    expect(
      decideSameSessionMerge({
        existing: {
          ...existing,
          hours: "4.50",
          endTime: at("2026-10-01T15:06:00Z"),
        },
        existingLocked: false,
        incoming: {
          ...sameOwner,
          startTime: start,
          endTime: at("2026-10-01T10:55:00Z"),
          hours: 0.32,
        },
      }),
    ).toEqual({ action: "insert" });
  });

  it("uden sluttid kan det ikke afgøres → indsæt", () => {
    expect(
      decideSameSessionMerge({
        existing,
        existingLocked: false,
        incoming: { ...sameOwner, startTime: start, endTime: null, hours: 1 },
      }),
    ).toEqual({ action: "insert" });
  });

  it("faktureret eller låst post → indsæt som hidtil", () => {
    const incoming = {
      ...sameOwner,
      startTime: start,
      endTime: at("2026-10-01T08:00:00Z"),
      hours: 1,
    };
    expect(
      decideSameSessionMerge({
        existing: { ...existing, isBilled: true },
        existingLocked: false,
        incoming,
      }),
    ).toEqual({ action: "insert" });
    expect(
      decideSameSessionMerge({
        existing: { ...existing, invoiceId: "inv-1" },
        existingLocked: false,
        incoming,
      }),
    ).toEqual({ action: "insert" });
    expect(
      decideSameSessionMerge({ existing, existingLocked: true, incoming }),
    ).toEqual({ action: "insert" });
  });

  it("starttid uden for tolerancen → indsæt", () => {
    expect(
      decideSameSessionMerge({
        existing,
        existingLocked: false,
        incoming: {
          ...sameOwner,
          startTime: at("2026-10-01T07:03:10Z"),
          endTime: at("2026-10-01T08:00:00Z"),
          hours: 1,
        },
      }),
    ).toEqual({ action: "insert" });
  });
});
