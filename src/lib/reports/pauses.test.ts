import { describe, expect, it } from "vitest";
import type { ReportEntry } from "./columns";
import { computeReportPauses } from "./pauses";

/** Lokal tid — gap-kernen grupperer dage med toLocalDateStr. */
const at = (h: number, m = 0) => new Date(2026, 2, 16, h, m, 0, 0);

const mkEntry = (over: Partial<ReportEntry> = {}): ReportEntry => ({
  id: "e1",
  source: "manual",
  approvalStatus: null,
  segments: [],
  date: at(12),
  startTime: null,
  endTime: null,
  hours: "1.00",
  billableRate: "500",
  description: null,
  isBilled: false,
  isBillable: true,
  isPrepaid: false,
  clientDefaultBillable: true,
  isFromTemplate: false,
  _rounded: 1,
  _value: 500,
  client: null,
  project: null,
  prepaidPackage: null,
  tags: [],
  task: null,
  member: { userId: "u1", name: "Thomas" },
  ...over,
});

describe("computeReportPauses", () => {
  it("tæller et hul på 20 min mellem to poster samme dag", () => {
    const p = computeReportPauses([
      mkEntry({ id: "a", startTime: at(9), endTime: at(10), hours: "1.00" }),
      mkEntry({
        id: "b",
        startTime: at(10, 20),
        endTime: at(11),
        hours: "0.67",
      }),
    ]);
    expect(p.totalGapMinutes).toBe(20);
    expect(p.byDay).toEqual([{ date: "2026-03-16", gapMinutes: 20 }]);
    expect(p.byUser).toEqual([
      { userId: "u1", name: "Thomas", gapMinutes: 20 },
    ]);
    expect(p.untimedEntries).toBe(0);
  });

  it("ignorerer huller under tærsklen på 15 min", () => {
    const p = computeReportPauses([
      mkEntry({ id: "a", startTime: at(9), endTime: at(10) }),
      mkEntry({ id: "b", startTime: at(10, 5), endTime: at(11) }),
    ]);
    expect(p.totalGapMinutes).toBe(0);
    expect(p.byDay).toEqual([]);
    expect(p.byUser).toEqual([]);
  });

  it("tæller en manuel kun-varigheds-post som untimedEntries", () => {
    const p = computeReportPauses([
      mkEntry({ id: "a", startTime: null, endTime: null, hours: "3.00" }),
    ]);
    expect(p.untimedEntries).toBe(1);
    expect(p.totalGapMinutes).toBe(0);
  });

  it("holder to medarbejdere adskilt — ingen falske huller på tværs", () => {
    const p = computeReportPauses([
      mkEntry({
        id: "a",
        startTime: at(9),
        endTime: at(10),
        member: { userId: "u1", name: "Thomas" },
      }),
      mkEntry({
        id: "b",
        startTime: at(14),
        endTime: at(15),
        member: { userId: "u2", name: "Mette" },
      }),
    ]);
    // Havde de været samme person, ville der være 4 timers hul
    expect(p.totalGapMinutes).toBe(0);
  });

  it("summerer pauser pr. medarbejder og pr. dag", () => {
    const p = computeReportPauses([
      mkEntry({
        id: "a",
        startTime: at(9),
        endTime: at(10),
        member: { userId: "u1", name: "Thomas" },
      }),
      mkEntry({
        id: "b",
        startTime: at(10, 30),
        endTime: at(11),
        member: { userId: "u1", name: "Thomas" },
      }),
      mkEntry({
        id: "c",
        startTime: at(9),
        endTime: at(10),
        member: { userId: "u2", name: "Mette" },
      }),
      mkEntry({
        id: "d",
        startTime: at(11),
        endTime: at(12),
        member: { userId: "u2", name: "Mette" },
      }),
    ]);
    // Thomas 30 min, Mette 60 min — samme dag
    expect(p.totalGapMinutes).toBe(90);
    expect(p.byDay).toEqual([{ date: "2026-03-16", gapMinutes: 90 }]);
    expect(p.byUser).toEqual([
      { userId: "u2", name: "Mette", gapMinutes: 60 },
      { userId: "u1", name: "Thomas", gapMinutes: 30 },
    ]);
  });

  it("bruger segmenternes tidspunkter når en timer har været på pause", () => {
    const p = computeReportPauses([
      mkEntry({
        id: "a",
        source: "timer",
        startTime: at(9),
        endTime: at(12),
        hours: "2.00",
        segments: [
          { startTime: at(9), endTime: at(10), durationMinutes: 60 },
          { startTime: at(11), endTime: at(12), durationMinutes: 60 },
        ],
      }),
    ]);
    // Uden segmenter ville 09–12 se ud som ét sammenhængende stræk
    expect(p.totalGapMinutes).toBe(60);
    expect(p.syntheticEntries).toBe(0);
  });

  it("behandler afviste registreringer som rapportens tabel gør", () => {
    // Detaljetabellen viser afviste poster, så pauserne skal også regne dem
    // som arbejdstid. Ellers ville en afvist post stå i tabellen OG blive
    // vist som en pause af samme længde.
    const p = computeReportPauses([
      mkEntry({ id: "a", startTime: at(9), endTime: at(10) }),
      mkEntry({
        id: "b",
        startTime: at(10),
        endTime: at(14),
        hours: "4.00",
        approvalStatus: "rejected",
      }),
      mkEntry({ id: "c", startTime: at(14), endTime: at(15) }),
    ]);
    expect(p.totalGapMinutes).toBe(0);
  });

  it("den afviste posts tid bliver ikke til et hul", () => {
    const withRejected = computeReportPauses([
      mkEntry({ id: "a", startTime: at(9), endTime: at(10) }),
      mkEntry({
        id: "b",
        startTime: at(10),
        endTime: at(14),
        hours: "4.00",
        approvalStatus: "rejected",
      }),
    ]);
    const withoutIt = computeReportPauses([
      mkEntry({ id: "a", startTime: at(9), endTime: at(10) }),
    ]);
    expect(withRejected.totalGapMinutes).toBe(0);
    expect(withoutIt.totalGapMinutes).toBe(0);
  });

  it("giver nul på en tom rapport", () => {
    const p = computeReportPauses([]);
    expect(p.totalGapMinutes).toBe(0);
    expect(p.byDay).toEqual([]);
    expect(p.byUser).toEqual([]);
    expect(p.minGapMinutes).toBe(15);
  });
});
