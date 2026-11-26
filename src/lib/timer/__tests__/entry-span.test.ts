import { describe, expect, it } from "vitest";
import {
  detectHoursMismatch,
  type EntrySpanRow,
} from "@/lib/stability/detectors";
import {
  normalizeTimerEntryInput,
  stoppedTimerStart,
  TIMER_SPAN_TOLERANCE_HOURS,
  timerEntryStart,
} from "../entry-span";

const at = (iso: string) => new Date(iso);
const HOUR = 3_600_000;

/** Stabilitetsvagtens række for en gemt timer-post. */
function spanRow(entry: {
  startTime: Date;
  endTime: Date;
  hours: number;
}): EntrySpanRow {
  return {
    entryId: "e1",
    userId: "u1",
    organizationId: null,
    source: "manual",
    hasSegments: false,
    timerOrigin: true,
    ...entry,
  };
}

// Prod 10.-19/11-2026 (kun tekniske felter): web/PWA, source "manual",
// med timer_session_id og client_entry_id.
const exampleA = {
  // 12:16:26 dansk tid; time_change satte base_seconds = 1800 uden at flytte
  // start_time ("startede tidligere"), stoppet 12:17:03
  startTime: at("2026-11-12T11:16:26Z"),
  endTime: at("2026-11-12T11:17:03Z"),
  hours: 0.51,
};
const exampleB = {
  // Flere pauser/genoptagelser: start = seneste genoptagelse, 7 s før stop
  startTime: at("2026-11-17T13:42:10Z"),
  endTime: at("2026-11-17T13:42:17Z"),
  hours: 1.08,
};

describe("timerEntryStart", () => {
  it("eksempel A (tid lagt til): starten flyttes til slut − timer", () => {
    const start = timerEntryStart(exampleA);
    expect(start?.toISOString()).toBe("2026-11-12T10:46:27.000Z");
    expect(detectHoursMismatch([spanRow(exampleA)])).toHaveLength(1);
    expect(
      detectHoursMismatch([spanRow({ ...exampleA, startTime: start as Date })]),
    ).toEqual([]);
  });

  it("eksempel B (genoptaget): starten flyttes til slut − timer", () => {
    const start = timerEntryStart(exampleB);
    expect(start?.toISOString()).toBe("2026-11-17T12:37:29.000Z");
    expect(detectHoursMismatch([spanRow(exampleB)])[0]?.severity).toBe(
      "warning",
    );
    expect(
      detectHoursMismatch([spanRow({ ...exampleB, startTime: start as Date })]),
    ).toEqual([]);
  });

  it("en pause (timer < tidsrum) røres ikke", () => {
    const paused = {
      startTime: at("2026-11-12T08:00:00Z"),
      endTime: at("2026-11-12T10:00:00Z"),
      hours: 1.5,
    };
    expect(timerEntryStart(paused)).toBe(paused.startTime);
  });

  it("afrunding inden for tolerancen flytter ikke starten", () => {
    const end = at("2026-11-12T10:00:00Z");
    const startTime = new Date(
      end.getTime() - (1 - TIMER_SPAN_TOLERANCE_HOURS) * HOUR,
    );
    expect(timerEntryStart({ startTime, endTime: end, hours: 1 })).toBe(
      startTime,
    );
    // Lige over tolerancen flyttes den
    expect(
      timerEntryStart({ startTime, endTime: end, hours: 1.01 })?.toISOString(),
    ).toBe("2026-11-12T08:59:24.000Z");
  });

  it("slut før start flyttes også", () => {
    const start = timerEntryStart({
      startTime: at("2026-11-12T10:05:00Z"),
      endTime: at("2026-11-12T10:00:00Z"),
      hours: 0.5,
    });
    expect(start?.toISOString()).toBe("2026-11-12T09:30:00.000Z");
  });

  it("uden tidsrum eller med ugyldige tidspunkter røres intet", () => {
    expect(
      timerEntryStart({ startTime: null, endTime: exampleA.endTime, hours: 1 }),
    ).toBeNull();
    const invalid = new Date("ikke en dato");
    expect(
      timerEntryStart({
        startTime: invalid,
        endTime: exampleA.endTime,
        hours: 1,
      }),
    ).toBe(invalid);
  });
});

describe("normalizeTimerEntryInput", () => {
  const input = {
    description: "x",
    hours: exampleA.hours,
    date: "2026-11-12",
    startTime: exampleA.startTime.toISOString(),
    endTime: exampleA.endTime.toISOString(),
  };

  it("flytter starten og beholder resten af inputtet", () => {
    expect(normalizeTimerEntryInput(input)).toEqual({
      ...input,
      startTime: "2026-11-12T10:46:27.000Z",
    });
  });

  it("datoen følger en start, der flyttes over midnat (dansk tid)", () => {
    const out = normalizeTimerEntryInput({
      hours: 0.5,
      date: "2026-11-13",
      // 00:10 dansk tid, 30 min lagt til
      startTime: "2026-11-12T23:10:00.000Z",
      endTime: "2026-11-12T23:11:00.000Z",
    });
    expect(out.startTime).toBe("2026-11-12T22:41:00.000Z");
    expect(out.date).toBe("2026-11-12");
  });

  it("en dato brugeren selv har valgt (anden dag end starten) røres ikke", () => {
    const out = normalizeTimerEntryInput({ ...input, date: "2026-11-10" });
    expect(out.startTime).toBe("2026-11-12T10:46:27.000Z");
    expect(out.date).toBe("2026-11-10");
  });

  it("returnerer samme objekt, når intet skal rettes", () => {
    const ok = { ...input, hours: 0.01 };
    expect(normalizeTimerEntryInput(ok)).toBe(ok);
    const noEnd = { ...input, endTime: undefined };
    expect(normalizeTimerEntryInput(noEnd)).toBe(noEnd);
    const badStart = { ...input, startTime: "ikke en dato" };
    expect(normalizeTimerEntryInput(badStart)).toBe(badStart);
  });
});

describe("stoppedTimerStart", () => {
  const end = at("2026-11-12T11:17:03Z");

  it("tid lagt til: slut − sporet tid er tidligere end sessionens start", () => {
    expect(stoppedTimerStart(exampleA.startTime, end, 1837).toISOString()).toBe(
      "2026-11-12T10:46:26.000Z",
    );
  });

  it("pauser: sessionens første start beholdes", () => {
    const first = at("2026-11-12T09:00:00Z");
    expect(stoppedTimerStart(first, end, 600)).toEqual(first);
  });
});
