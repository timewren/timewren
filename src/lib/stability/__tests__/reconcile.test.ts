import { describe, expect, it } from "vitest";
import type { DetectedFinding, DetectorId } from "../detectors";
import {
  computeWindowStart,
  DISCORD_DESCRIPTION_LIMIT,
  formatAlertDescription,
  formatDanishTime,
  isHourlySlot,
  reconcileFindings,
  type StoredFinding,
  truncateForDiscord,
} from "../reconcile";

const now = new Date("2026-10-03T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

const detected = (over: Partial<DetectedFinding> = {}): DetectedFinding => ({
  detector: "duplicate_session",
  severity: "critical",
  fingerprint: "duplicate_session:u1",
  userId: "u1",
  organizationId: "o1",
  title: "1 dobbelt-gemt session",
  occurrenceKeys: ["e1|e2"],
  sample: {},
  ...over,
});

const stored = (over: Partial<StoredFinding> = {}): StoredFinding => ({
  id: "f1",
  detector: "duplicate_session",
  severity: "critical",
  fingerprint: "duplicate_session:u1",
  status: "open",
  firstSeen: minutesAgo(60),
  lastSeen: minutesAgo(15),
  count: 1,
  lastAlertedAt: minutesAgo(60),
  sample: { occurrenceKeys: ["e1|e2"] },
  ...over,
});

const all = new Set<DetectorId>([
  "duplicate_session",
  "stale_client",
  "realtime_down",
  "client_switch",
  "cron_stale",
]);

function run(
  s: StoredFinding[],
  d: DetectedFinding[],
  opts: { ran?: Set<DetectorId>; resolved?: Set<string> } = {},
) {
  return reconcileFindings({
    stored: s,
    detected: d,
    ranDetectors: opts.ran ?? all,
    previouslyResolved: opts.resolved ?? new Set(),
    now,
  });
}

describe("reconcileFindings", () => {
  it("nyt fingerprint → indsæt + alarm", () => {
    const plan = run([], [detected()]);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].alert).toBe("new");
    expect(plan.inserts[0].finding.sample.occurrenceKeys).toEqual(["e1|e2"]);
  });

  it("fingerprint der har været løst før → 'recurred'", () => {
    const plan = run([], [detected()], {
      resolved: new Set(["duplicate_session:u1"]),
    });
    expect(plan.inserts[0].alert).toBe("recurred");
  });

  it("info-fund alarmerer ikke", () => {
    const plan = run([], [detected({ severity: "info" })]);
    expect(plan.inserts[0].alert).toBeNull();
  });

  it("samme forekomst set igen (vindues-overlap) tæller ikke og rører ikke last_seen", () => {
    const plan = run([stored()], [detected()]);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].count).toBe(1);
    expect(plan.updates[0].touchLastSeen).toBe(false);
    expect(plan.updates[0].alert).toBeNull();
  });

  it("ny forekomst tæller op, men alarmerer ikke inden for 24 t", () => {
    const plan = run(
      [stored()],
      [detected({ occurrenceKeys: ["e1|e2", "e3|e4"] })],
    );
    expect(plan.updates[0].count).toBe(2);
    expect(plan.updates[0].touchLastSeen).toBe(true);
    expect(plan.updates[0].alert).toBeNull();
    expect(plan.updates[0].sample.occurrenceKeys).toEqual(["e1|e2", "e3|e4"]);
  });

  it("ny forekomst efter 24 t → påmindelse", () => {
    const plan = run(
      [stored({ lastAlertedAt: minutesAgo(25 * 60) })],
      [detected({ occurrenceKeys: ["e5|e6"] })],
    );
    expect(plan.updates[0].alert).toBe("reminder");
  });

  it("tilstands-fund tæller kørsler og påminder efter 24 t", () => {
    const s = stored({
      detector: "realtime_down",
      fingerprint: "realtime_down",
      severity: "warning",
      lastAlertedAt: minutesAgo(24 * 60),
      sample: null,
    });
    const plan = run(
      [s],
      [
        detected({
          detector: "realtime_down",
          fingerprint: "realtime_down",
          severity: "warning",
          occurrenceKeys: [],
        }),
      ],
    );
    expect(plan.updates[0].count).toBe(2);
    expect(plan.updates[0].alert).toBe("reminder");
  });

  it("info → advarsel eskalerer og alarmerer", () => {
    const s = stored({
      detector: "client_switch",
      fingerprint: "client_switch:u1",
      severity: "info",
      lastAlertedAt: null,
      sample: { occurrenceKeys: ["ev1"] },
    });
    const plan = run(
      [s],
      [
        detected({
          detector: "client_switch",
          fingerprint: "client_switch:u1",
          severity: "warning",
          occurrenceKeys: ["ev2"],
        }),
      ],
    );
    expect(plan.updates[0].severity).toBe("warning");
    expect(plan.updates[0].alert).toBe("new");
  });

  it("ignorerede fund opdateres stille", () => {
    const plan = run(
      [stored({ status: "ignored", lastAlertedAt: minutesAgo(48 * 60) })],
      [detected({ occurrenceKeys: ["e7|e8"] })],
    );
    expect(plan.updates[0].alert).toBeNull();
  });

  it("tilstands-fund løses når det har været væk længe nok, med 'løst'-besked", () => {
    const s = stored({
      detector: "realtime_down",
      fingerprint: "realtime_down",
      severity: "warning",
      lastSeen: minutesAgo(25),
    });
    const plan = run([s], []);
    expect(plan.resolves).toEqual([
      expect.objectContaining({ id: "f1", alert: "resolved" }),
    ]);
  });

  it("tilstands-fund løses ikke efter kun én stille kørsel", () => {
    const s = stored({
      detector: "realtime_down",
      fingerprint: "realtime_down",
      severity: "warning",
      lastSeen: minutesAgo(15),
    });
    expect(run([s], []).resolves).toEqual([]);
  });

  it("løses ikke hvis detektoren ikke kørte (fejl eller gate)", () => {
    const s = stored({
      detector: "realtime_down",
      fingerprint: "realtime_down",
      lastSeen: minutesAgo(600),
    });
    expect(run([s], [], { ran: new Set() }).resolves).toEqual([]);
  });

  it("event-fund løses først efter 24 t uden nye forekomster", () => {
    expect(
      run([stored({ lastSeen: minutesAgo(23 * 60) })], []).resolves,
    ).toEqual([]);
    expect(
      run([stored({ lastSeen: minutesAgo(25 * 60) })], []).resolves,
    ).toHaveLength(1);
  });

  it("event-fund set igen uden nye forekomster løses også efter 24 t", () => {
    const plan = run([stored({ lastSeen: minutesAgo(25 * 60) })], [detected()]);
    expect(plan.resolves).toHaveLength(1);
    expect(plan.updates).toHaveLength(0);
  });

  it("fund der aldrig blev alarmeret, løses uden besked", () => {
    const s = stored({ lastAlertedAt: null, lastSeen: minutesAgo(25 * 60) });
    expect(run([s], []).resolves[0].alert).toBeNull();
  });
});

describe("formatAlertDescription", () => {
  const params = {
    kind: "new" as const,
    detector: "duplicate_session" as const,
    severity: "critical" as const,
    title: "1 dobbelt-gemt session",
    who: "Bruger (Eksempel ApS)",
    count: 1,
    firstSeen: new Date("2026-10-03T07:00:00Z"),
    lastSeen: new Date("2026-10-03T07:15:00Z"),
    trail: [
      {
        createdAt: new Date("2026-10-03T07:00:00Z"),
        event: "confirm_stop",
        source: "extension",
        clientHint: "extension/chrome",
        startTime: new Date("2026-10-03T06:00:00Z"),
        versionAfter: 12,
        clientName: "Kunde A",
        clientId: "c-1234567890",
      },
    ],
    adminUrl: "https://app.timetrack.dk/admin/stabilitet",
    userUrl: "https://app.timetrack.dk/admin/users/u1?tab=timerlog",
    runbookUrl:
      "https://github.com/x/y/blob/main/docs/runbooks/timer-fejlsoegning.md#a",
    environment: "https://app.timetrack.dk",
  };

  it("viser tider i dansk tid", () => {
    // 07:00 UTC = 09:00 sommertid
    expect(formatDanishTime(params.firstSeen)).toContain("09.00");
  });

  it("indeholder detektor, hvem, spor og links", () => {
    const text = formatAlertDescription(params);
    expect(text).toContain("KRITISK");
    expect(text).toContain("Bruger (Eksempel ApS)");
    expect(text).toContain("confirm_stop");
    expect(text).toContain("extension/extension/chrome");
    // Review: kundens kunders navne hører ikke hjemme i Discord
    expect(text).not.toContain("Kunde A");
    expect(text).toContain("kunde c-123456");
    expect(text).toContain("tab=timerlog");
    expect(text).toContain("Runbook");
  });

  it("'løst' viser ikke sporet", () => {
    expect(
      formatAlertDescription({ ...params, kind: "resolved" }),
    ).not.toContain("confirm_stop");
  });

  it("holder sig under Discords grænse og beholder links", () => {
    const trail = Array.from({ length: 200 }, () => params.trail[0]);
    const text = formatAlertDescription({ ...params, trail });
    expect(text.length).toBeLessThanOrEqual(DISCORD_DESCRIPTION_LIMIT);
    expect(text).toContain("Runbook");
  });
});

describe("computeWindowStart", () => {
  it("første kørsel: 24 t tilbage", () => {
    expect(computeWindowStart(null, now).toISOString()).toBe(
      "2026-10-02T12:00:00.000Z",
    );
  });

  it("siden forrige kørsel minus 2 min overlap, men mindst 20 min", () => {
    expect(computeWindowStart(minutesAgo(15), now).toISOString()).toBe(
      minutesAgo(20).toISOString(),
    );
    expect(computeWindowStart(minutesAgo(90), now).toISOString()).toBe(
      minutesAgo(92).toISOString(),
    );
  });

  it("højst 24 t, selv efter et langt udfald", () => {
    expect(computeWindowStart(minutesAgo(5 * 24 * 60), now).toISOString()).toBe(
      minutesAgo(24 * 60).toISOString(),
    );
  });
});

describe("isHourlySlot", () => {
  it("kun første kvarter i timen", () => {
    expect(isHourlySlot(new Date("2026-10-03T12:00:30Z"))).toBe(true);
    expect(isHourlySlot(new Date("2026-10-03T12:15:00Z"))).toBe(false);
    expect(isHourlySlot(new Date("2026-10-03T12:45:00Z"))).toBe(false);
  });
});

describe("truncateForDiscord", () => {
  it("lader korte tekster være", () => {
    expect(truncateForDiscord("hej", 10)).toBe("hej");
  });

  it("klipper lange tekster under grænsen med en markør", () => {
    const out = truncateForDiscord("x".repeat(5000), 4000);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(out.endsWith("…")).toBe(true);
  });
});
