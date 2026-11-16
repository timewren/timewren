import { describe, expect, it } from "vitest";
import {
  type ClientChangeRow,
  DETECTOR_IDS,
  DETECTORS,
  type DuplicatePairRow,
  detectClientSwitches,
  detectDateMismatch,
  detectDuplicateSessions,
  detectHoursMismatch,
  detectPrepaidInconsistency,
  detectRealtimeDown,
  detectRunawayTimers,
  detectStaleClients,
  detectStaleCrons,
  detectTimeJumps,
  detectZombieClears,
  elapsedJumpSeconds,
  isCurrentWebClient,
  overlapSeconds,
  type PrepaidPackageRow,
  type SessionOverlapRow,
  type TimeChangeRow,
  type ZombieClearRow,
} from "../detectors";

const T = (iso: string) => new Date(iso);

describe("DETECTORS-konfiguration", () => {
  it("har konfiguration og runbook-anker for hver detektor", () => {
    for (const id of DETECTOR_IDS) {
      expect(DETECTORS[id].label).toBeTruthy();
      expect(DETECTORS[id].runbookAnchor).toMatch(/^[a-j]-/);
      expect(DETECTORS[id].resolveAfterMinutes).toBeGreaterThan(0);
    }
  });

  it("klippekort-tjekket tåler en oversprunget timekørsel", () => {
    expect(DETECTORS.prepaid_inconsistency.resolveAfterMinutes).toBeGreaterThan(
      120,
    );
  });
});

describe("a. detectDuplicateSessions", () => {
  const pair = (over: Partial<DuplicatePairRow> = {}): DuplicatePairRow => ({
    userId: "u1",
    organizationId: "o1",
    entryId: "e2",
    startTime: T("2026-10-01T07:00:01Z"),
    source: "extension",
    hours: 1.5,
    otherEntryId: "e1",
    otherStartTime: T("2026-10-01T07:00:00Z"),
    otherSource: "web",
    otherHours: 1.5,
    timerOrigin: true,
    sameAssignment: true,
    ...over,
  });

  // Review (beta): manuelle poster med samme runde start (06:00) og
  // forskellige timer blev flaget som dubletter.
  it("manuelle poster med samme runde start er ikke en dublet", () => {
    expect(
      detectDuplicateSessions([
        pair({ source: "manual", otherSource: "manual", timerOrigin: false }),
      ]),
    ).toEqual([]);
  });

  it("to forskellige server-udstedte timer-sessioner er ikke en dublet", () => {
    expect(detectDuplicateSessions([pair({ distinctSessions: true })])).toEqual(
      [],
    );
    // Ukendt (ældre poster uden session) → stadig en mistanke
    expect(
      detectDuplicateSessions([pair({ distinctSessions: false })]),
    ).toHaveLength(1);
  });

  it("samme start men forskellig kunde/projekt er ikke en dublet", () => {
    expect(detectDuplicateSessions([pair({ sameAssignment: false })])).toEqual(
      [],
    );
  });

  it("finder to poster med samme start ±1 s (kunde-mønstret)", () => {
    const [f] = detectDuplicateSessions([pair()]);
    expect(f.detector).toBe("duplicate_session");
    expect(f.severity).toBe("critical");
    expect(f.fingerprint).toBe("duplicate_session:u1");
    expect(f.occurrenceKeys).toEqual(["e1|e2"]);
  });

  it("tæller samme par én gang uanset retning", () => {
    const fs = detectDuplicateSessions([
      pair(),
      pair({
        entryId: "e1",
        otherEntryId: "e2",
        startTime: T("2026-10-01T07:00:00Z"),
        otherStartTime: T("2026-10-01T07:00:01Z"),
      }),
    ]);
    expect(fs).toHaveLength(1);
    expect(fs[0].occurrenceKeys).toEqual(["e1|e2"]);
  });

  it("tæller tredobbelt gemt som to par", () => {
    const fs = detectDuplicateSessions([
      pair(),
      pair({ entryId: "e3", startTime: T("2026-10-01T07:00:02Z") }),
    ]);
    expect(fs[0].occurrenceKeys.sort()).toEqual(["e1|e2", "e1|e3"]);
  });

  it("ignorerer poster mere end 3 s fra hinanden", () => {
    expect(
      detectDuplicateSessions([pair({ startTime: T("2026-10-01T07:00:04Z") })]),
    ).toEqual([]);
  });

  it("laver ét fund pr. bruger", () => {
    const fs = detectDuplicateSessions([pair(), pair({ userId: "u2" })]);
    expect(fs.map((f) => f.userId).sort()).toEqual(["u1", "u2"]);
  });
});

describe("a2. detectDuplicateSessions — samme timer-session", () => {
  // 2.6.0 gemmer sessionen 07:00–09:00; en ældre klient gemmer en parkeret
  // rest af den 07:04–09:06 (som "manual") — starterne er minutter fra
  // hinanden, så ±3 s-reglen ser det ikke.
  const row = (over: Partial<SessionOverlapRow> = {}): SessionOverlapRow => ({
    userId: "u1",
    organizationId: "o1",
    sessionId: "s1",
    sessionStartedAt: T("2026-10-01T07:00:00Z"),
    sessionEndedAt: T("2026-10-01T09:00:00Z"),
    entryId: "e1",
    startTime: T("2026-10-01T07:00:00Z"),
    endTime: T("2026-10-01T09:00:00Z"),
    source: "extension",
    hours: 2,
    otherEntryId: "e2",
    otherStartTime: T("2026-10-01T07:04:00Z"),
    otherEndTime: T("2026-10-01T09:06:00Z"),
    otherSource: "manual",
    otherHours: 2.03,
    sameAssignment: true,
    ...over,
  });

  it("finder en rest gemt minutter senere af en ældre klient (kritisk)", () => {
    const [f] = detectDuplicateSessions([], [row()]);
    expect(f.detector).toBe("duplicate_session");
    expect(f.severity).toBe("critical");
    expect(f.fingerprint).toBe("duplicate_session:u1");
    expect(f.occurrenceKeys).toEqual(["e1|e2"]);
    expect(f.title).toContain("samme timer-session");
    expect(
      (f.sample.pairs as Array<Record<string, unknown>>)[0].sessionId,
    ).toBe("s1");
  });

  it("anden kunde/projekt i sessionens tidsrum er kun info", () => {
    const [f] = detectDuplicateSessions([], [row({ sameAssignment: false })]);
    expect(f.severity).toBe("info");
  });

  it("samme opgave, men posterne overlapper ikke hinanden: advarsel", () => {
    // Sessionen er længere end posten (fx forlænget via "Fortsæt")
    const [f] = detectDuplicateSessions(
      [],
      [
        row({
          sessionEndedAt: T("2026-10-01T11:00:00Z"),
          otherStartTime: T("2026-10-01T09:30:00Z"),
          otherEndTime: T("2026-10-01T10:30:00Z"),
        }),
      ],
    );
    expect(f.severity).toBe("warning");
  });

  it("under et minuts overlap med sessionen er ikke samme session", () => {
    expect(
      detectDuplicateSessions(
        [],
        [
          row({
            otherStartTime: T("2026-10-01T08:59:30Z"),
            otherEndTime: T("2026-10-01T10:00:00Z"),
          }),
        ],
      ),
    ).toEqual([]);
  });

  it("samme par fra begge regler tælles én gang med højeste alvor", () => {
    const fs = detectDuplicateSessions(
      [
        {
          userId: "u1",
          organizationId: "o1",
          entryId: "e2",
          startTime: T("2026-10-01T07:00:01Z"),
          source: "manual",
          hours: 2,
          otherEntryId: "e1",
          otherStartTime: T("2026-10-01T07:00:00Z"),
          otherSource: "extension",
          otherHours: 2,
          timerOrigin: true,
          sameAssignment: true,
        },
      ],
      [row({ sameAssignment: false })],
    );
    expect(fs).toHaveLength(1);
    expect(fs[0].severity).toBe("critical");
    expect(fs[0].occurrenceKeys).toEqual(["e1|e2"]);
  });

  it("brugerens fund får højeste alvor på tværs af par", () => {
    const [f] = detectDuplicateSessions(
      [],
      [row({ sameAssignment: false }), row({ otherEntryId: "e3" })],
    );
    expect(f.severity).toBe("critical");
    expect(f.occurrenceKeys.sort()).toEqual(["e1|e2", "e1|e3"]);
  });

  it("overlapSeconds", () => {
    expect(
      overlapSeconds(
        T("2026-10-01T07:00:00Z"),
        T("2026-10-01T08:00:00Z"),
        T("2026-10-01T07:30:00Z"),
        T("2026-10-01T09:00:00Z"),
      ),
    ).toBe(1800);
    expect(
      overlapSeconds(
        T("2026-10-01T07:00:00Z"),
        T("2026-10-01T08:00:00Z"),
        T("2026-10-01T08:00:00Z"),
        T("2026-10-01T09:00:00Z"),
      ),
    ).toBe(0);
    expect(
      overlapSeconds(
        new Date(Number.NaN),
        T("2026-10-01T08:00:00Z"),
        T("2026-10-01T07:00:00Z"),
        T("2026-10-01T09:00:00Z"),
      ),
    ).toBe(0);
  });
});

describe("b. detectStaleClients", () => {
  const row = (event: string, n: number, hint = "extension/chrome") => ({
    userId: "u1",
    organizationId: "o1",
    event,
    source: "extension",
    clientHint: hint,
    n,
    lastAt: T("2026-10-01T07:00:00Z"),
  });

  it("under tærsklen er ikke et fund", () => {
    expect(
      detectStaleClients([
        row("blocked_resurrection", 2),
        row("heartbeat_rejected", 9),
      ]),
    ).toEqual([]);
  });

  it("genopstandelser over tærsklen er kritisk og navngiver klienten", () => {
    const [f] = detectStaleClients([row("blocked_resurrection", 3)]);
    expect(f.severity).toBe("critical");
    expect(f.fingerprint).toBe("stale_client:u1:extension:extension/chrome");
    expect(f.title).toContain("extension/chrome");
  });

  it("mange afviste heartbeats er en advarsel", () => {
    const [f] = detectStaleClients([row("heartbeat_rejected", 12)]);
    expect(f.severity).toBe("warning");
  });

  it("skelner klienter ad", () => {
    const fs = detectStaleClients([
      row("version_conflict", 10, "chrome/windows"),
      row("version_conflict", 10, "mobilapp/ios"),
    ]);
    expect(fs).toHaveLength(2);
  });

  it("ukendte hændelser tæller ikke", () => {
    expect(detectStaleClients([row("start", 100)])).toEqual([]);
  });

  // kunde A 5/10: en aktuel fane taber hvert heartbeat til en anden fane
  // der holder samme timer i live — ikke en forældet klient.
  describe("aktuel klient der taber til en anden aktiv skriver", () => {
    const BUILD = "c82dce405a85b1f0c0ffee";
    const hint = "web@c82dce405a85 chrome/mac";
    const webRow = (event: string, n: number, h = hint) => ({
      ...row(event, n, h),
      source: "web",
    });
    const ctx = {
      currentWebBuild: BUILD,
      writers: [
        {
          userId: "u1",
          event: "start",
          source: "extension",
          clientHint: "extension/chrome",
          n: 1,
        },
        { userId: "u1", event: "adopt", source: "web", clientHint: hint, n: 2 },
        {
          userId: "u2",
          event: "start",
          source: "web",
          clientHint: "andenbruger",
          n: 9,
        },
      ],
      owners: [
        {
          userId: "u1",
          lastSyncedFrom: "web",
          lastSyncedAt: T("2026-10-05T11:05:02Z"),
        },
      ],
    };

    it("er info og navngiver de konkurrerende skrivere", () => {
      const [f] = detectStaleClients([webRow("version_conflict", 14)], ctx);
      expect(f.severity).toBe("info");
      expect(f.fingerprint).toBe(`stale_client:u1:web:${hint}`);
      expect(f.title).toContain("taber til en anden aktiv skriver");
      expect(f.title).toContain("version_conflict 14×/t");
      expect(f.title).toContain("rækken sidst skrevet af web kl. 13.05.02");
      expect(f.title).toContain("web (web@c82dce405a85 chrome/mac) adopt 2×");
      expect(f.title).toContain("extension (extension/chrome) start 1×");
      expect(f.title).not.toContain("andenbruger");
      expect(f.sample).toMatchObject({ verdict: "losing_to_live_writer" });
    });

    it("en fane på en ældre build er stadig en advarsel", () => {
      const [f] = detectStaleClients(
        [webRow("version_conflict", 14, "web@0123456789ab chrome/mac")],
        ctx,
      );
      expect(f.severity).toBe("warning");
      expect(f.title).toContain("afvises gentagne gange");
    });

    it("andre afvisninger end versionskonflikter er stadig en advarsel", () => {
      const [f] = detectStaleClients(
        [webRow("version_conflict", 14), webRow("heartbeat_rejected", 12)],
        ctx,
      );
      expect(f.severity).toBe("warning");
    });

    it("andre afvisninger under deres egen tærskel holder den på advarsel", () => {
      const [f] = detectStaleClients(
        [webRow("version_conflict", 10), webRow("claim_rejected", 4)],
        ctx,
      );
      expect(f.severity).toBe("warning");
    });

    it("ukendt build (ingen kontekst) er som før en advarsel", () => {
      const [f] = detectStaleClients([webRow("version_conflict", 14)]);
      expect(f.severity).toBe("warning");
    });

    it("klienter uden build i hintet regnes ikke som aktuelle", () => {
      expect(isCurrentWebClient("chrome/mac", BUILD)).toBe(false);
      expect(
        isCurrentWebClient("extension@2.6.0 extension/chrome", BUILD),
      ).toBe(false);
      expect(isCurrentWebClient("pwa@c82dce405a85 chrome/mac", BUILD)).toBe(
        true,
      );
    });
  });
});

describe("c. detectRunawayTimers / detectTimeJumps", () => {
  const now = T("2026-10-01T20:00:00Z");

  it("finder en timer der har kørt over 10 t", () => {
    const [f] = detectRunawayTimers(
      [
        {
          userId: "u1",
          organizationId: null,
          startTime: T("2026-10-01T09:00:00Z"),
          baseSeconds: 0,
          lastSyncedFrom: "web",
          lastSyncedAt: null,
          autoPauseAfterMinutes: 120,
        },
      ],
      now,
    );
    // Review: start_time i fingerprint gav nyt fund ved pause/genoptag
    expect(f.fingerprint).toBe("runaway_timer:u1");
    // Auto-pause efter 120 min er sat og overskredet → advarsel
    expect(f.severity).toBe("warning");
  });

  it("uden auto-pause er en lang timer kun info (brugerens valg)", () => {
    const [f] = detectRunawayTimers(
      [
        {
          userId: "u1",
          organizationId: null,
          startTime: T("2026-10-01T09:00:00Z"),
          baseSeconds: 0,
          lastSyncedFrom: "web",
          lastSyncedAt: null,
          autoPauseAfterMinutes: null,
        },
      ],
      now,
    );
    expect(f.severity).toBe("info");
  });

  it("tæller basetid med", () => {
    const fs = detectRunawayTimers(
      [
        {
          userId: "u1",
          organizationId: null,
          startTime: T("2026-10-01T19:00:00Z"),
          baseSeconds: 9.5 * 3600,
          lastSyncedFrom: "web",
          lastSyncedAt: null,
          autoPauseAfterMinutes: null,
        },
      ],
      now,
    );
    expect(fs).toHaveLength(1);
  });

  it("en timer på 9 t er ikke et fund", () => {
    expect(
      detectRunawayTimers(
        [
          {
            userId: "u1",
            organizationId: null,
            startTime: T("2026-10-01T11:00:00Z"),
            baseSeconds: 0,
            lastSyncedFrom: "web",
            lastSyncedAt: null,
            autoPauseAfterMinutes: null,
          },
        ],
        now,
      ),
    ).toEqual([]);
  });

  const jump = (over: Partial<TimeChangeRow>): TimeChangeRow => ({
    eventId: "ev1",
    userId: "u1",
    organizationId: null,
    createdAt: T("2026-10-01T10:00:00Z"),
    source: "web",
    clientHint: "chrome/windows",
    startTime: T("2026-10-01T07:00:00Z"),
    baseSeconds: 0,
    prevStartTime: T("2026-10-01T09:00:00Z"),
    prevBaseSeconds: 0,
    ...over,
  });

  it("måler spring i vist tid, ikke rå starttid", () => {
    // Start flyttet 2 t tilbage → vist tid +2 t
    expect(elapsedJumpSeconds(jump({}))).toBe(7200);
    // Start +1 t og base +1 t (konsolidering) → vist tid uændret
    expect(
      elapsedJumpSeconds(
        jump({
          startTime: T("2026-10-01T10:00:00Z"),
          baseSeconds: 3600,
        }),
      ),
    ).toBe(0);
  });

  it("finder spring over 60 min og ignorerer mindre", () => {
    expect(detectTimeJumps([jump({})])).toHaveLength(1);
    expect(
      detectTimeJumps([jump({ startTime: T("2026-10-01T08:30:00Z") })]),
    ).toEqual([]);
  });

  // Review: "læg tid til" (AddTimeModal) på en kørende timer hæver kun
  // basetiden — det er brugerens eget valg, ikke et spring.
  it("ignorerer læg-tid-til: samme start, kun basetid op", () => {
    expect(
      detectTimeJumps([
        jump({
          startTime: T("2026-10-01T09:00:00Z"),
          baseSeconds: 2 * 3600,
          prevBaseSeconds: 0,
        }),
      ]),
    ).toEqual([]);
  });

  it("basetid NED med samme start er stadig et spring", () => {
    expect(
      detectTimeJumps([
        jump({
          startTime: T("2026-10-01T09:00:00Z"),
          baseSeconds: 0,
          prevBaseSeconds: 2 * 3600,
        }),
      ]),
    ).toHaveLength(1);
  });

  it("springer rækker uden tidligere starttid over", () => {
    expect(detectTimeJumps([jump({ prevStartTime: null })])).toEqual([]);
  });
});

describe("c. detectZombieClears", () => {
  const row = (over: Partial<ZombieClearRow>): ZombieClearRow => ({
    eventId: "e1",
    userId: "u1",
    organizationId: "o1",
    createdAt: T("2026-10-03T10:00:00Z"),
    discardedStartTime: "2026-05-01T08:00:00.000Z",
    discardedHours: 3700.4,
    lastSyncedFrom: "extension",
    ...over,
  });

  it("giver ét info-fund pr. bruger med hver rydning som forekomst", () => {
    const findings = detectZombieClears([
      row({}),
      row({ eventId: "e2", discardedHours: 1400 }),
      row({ eventId: "e3", userId: "u2", discardedHours: null }),
    ]);
    expect(findings).toHaveLength(2);
    const u1 = findings.find((f) => f.userId === "u1");
    expect(u1).toMatchObject({
      detector: "zombie_timer",
      severity: "info",
      fingerprint: "zombie_timer:u1",
      occurrenceKeys: ["e1", "e2"],
    });
    expect(u1?.title).toContain("5.100 t kasseret");
  });

  it("intet fund uden rydninger", () => {
    expect(detectZombieClears([])).toEqual([]);
  });
});

describe("d. detectClientSwitches", () => {
  const sw = (over: Partial<ClientChangeRow> = {}): ClientChangeRow => ({
    eventId: "ev1",
    userId: "u1",
    organizationId: "o1",
    createdAt: T("2026-10-01T10:00:00Z"),
    source: "extension",
    clientHint: "extension/chrome",
    startTime: T("2026-10-01T09:00:00Z"),
    clientId: "c2",
    prevClientId: "c1",
    originSource: "web",
    originHint: "chrome/windows",
    staleRejections: 2,
    ...over,
  });

  it("skift fra en anden overflade, mens sessionen også har afvisninger, er en advarsel", () => {
    const [f] = detectClientSwitches([sw()]);
    expect(f.severity).toBe("warning");
    expect(f.title).toContain("extension");
    expect(f.title).toContain("web");
  });

  it("anden overflade uden afvisninger er kun info", () => {
    const [f] = detectClientSwitches([sw({ staleRejections: 0 })]);
    expect(f.severity).toBe("info");
  });

  // Review: en anden fane har et andet client_hint, men er samme overflade
  it("samme source med andet client_hint (anden fane) er info", () => {
    const [f] = detectClientSwitches([
      sw({
        source: "web",
        clientHint: "firefox/windows",
        originSource: "web",
        originHint: "chrome/windows",
      }),
    ]);
    expect(f.severity).toBe("info");
  });

  it("skift fra samme overflade er info (typisk brugeren selv)", () => {
    const [f] = detectClientSwitches([
      sw({ originSource: "extension", originHint: "extension/chrome" }),
    ]);
    expect(f.severity).toBe("info");
  });

  it("første tildeling af kunde er ikke et skift", () => {
    expect(detectClientSwitches([sw({ prevClientId: null })])).toEqual([]);
  });

  it("samme kunde er ikke et skift", () => {
    expect(detectClientSwitches([sw({ clientId: "c1" })])).toEqual([]);
  });
});

describe("e. detectHoursMismatch", () => {
  const entry = (hours: number, hasSegments = false) => ({
    entryId: `e${hours}`,
    userId: "u1",
    organizationId: null,
    source: "timer",
    hours,
    startTime: T("2026-10-01T08:00:00Z"),
    endTime: T("2026-10-01T10:00:00Z"),
    hasSegments,
    timerOrigin: true,
  });

  it("flere timer end slut − start er en advarsel", () => {
    const [f] = detectHoursMismatch([entry(3)]);
    expect(f.severity).toBe("warning");
    expect(f.fingerprint).toBe("hours_mismatch:u1:timer");
  });

  // Review: manuelle/API/import-poster må gerne have timer ≠ spænd
  it("manuelle poster med flere timer end spænd er kun info", () => {
    const [f] = detectHoursMismatch([
      { ...entry(3), source: "manual", timerOrigin: false },
    ]);
    expect(f.severity).toBe("info");
  });

  it("færre timer uden segmenter er info (pause)", () => {
    const [f] = detectHoursMismatch([entry(1)]);
    expect(f.severity).toBe("info");
  });

  it("inden for 0,25 t er OK", () => {
    expect(detectHoursMismatch([entry(2.2)])).toEqual([]);
  });

  it("poster med segmenter springes over", () => {
    expect(detectHoursMismatch([entry(5, true)])).toEqual([]);
  });
});

describe("f. detectDateMismatch", () => {
  const row = (dateStr: string, start: string) => ({
    entryId: "e1",
    userId: "u1",
    organizationId: null,
    source: "web",
    dateStr,
    startTime: T(start),
  });

  it("start kl. 00:30 dansk tid hører til den danske dato", () => {
    // 22:30 UTC 30/9 = 00:30 1/10 sommertid
    expect(
      detectDateMismatch([row("2026-10-01", "2026-09-30T22:30:00Z")]),
    ).toEqual([]);
  });

  it("finder en post gemt på UTC-datoen i stedet for den danske", () => {
    const [f] = detectDateMismatch([row("2026-09-30", "2026-09-30T22:30:00Z")]);
    expect(f.severity).toBe("warning");
    expect(f.sample.entries).toEqual([
      expect.objectContaining({ expectedDate: "2026-10-01" }),
    ]);
  });
});

describe("g. detectPrepaidInconsistency", () => {
  const pkg = (over: Partial<PrepaidPackageRow> = {}): PrepaidPackageRow => ({
    packageId: "p1",
    userId: "u1",
    organizationId: null,
    name: "10 timer",
    totalHours: 10,
    usedHours: 4,
    remainingHours: 6,
    usageRows: 2,
    usageNetHours: 4,
    entriesWithoutUsage: 0,
    sampleEntryIds: [],
    ...over,
  });

  it("konsistent kort er ikke et fund", () => {
    expect(detectPrepaidInconsistency([pkg()])).toEqual([]);
  });

  it("brugt ≠ sum af træk", () => {
    const [f] = detectPrepaidInconsistency([pkg({ usageNetHours: 5.5 })]);
    expect(f.title).toContain("sum af træk");
  });

  it("brugt + rest ≠ total", () => {
    const [f] = detectPrepaidInconsistency([pkg({ remainingHours: 7 })]);
    expect(f.title).toContain("≠ total");
  });

  it("post på kortet uden træk", () => {
    const [f] = detectPrepaidInconsistency([
      pkg({ entriesWithoutUsage: 1, sampleEntryIds: ["e9"] }),
    ]);
    expect(f.title).toContain("uden træk");
  });

  it("importerede kort uden usage-rækker afstemmes ikke mod træk", () => {
    expect(
      detectPrepaidInconsistency([pkg({ usageRows: 0, usageNetHours: 0 })]),
    ).toEqual([]);
  });

  it("tolererer øre-afrunding", () => {
    expect(detectPrepaidInconsistency([pkg({ usageNetHours: 4.01 })])).toEqual(
      [],
    );
  });
});

describe("h. detectRealtimeDown", () => {
  const base = {
    enabled: true,
    configured: true,
    subscribed: true,
    probeOk: true,
    probeMs: 4,
    lastError: null,
  };

  it("sundt realtime er ikke et fund", () => {
    expect(detectRealtimeDown(base)).toEqual([]);
  });

  it("ikke abonneret er et fund", () => {
    expect(detectRealtimeDown({ ...base, subscribed: false })).toHaveLength(1);
  });

  it("prøvebesked der ikke kommer frem er et fund", () => {
    expect(detectRealtimeDown({ ...base, probeOk: false })).toHaveLength(1);
  });

  it("slået fra er ikke et fund", () => {
    expect(
      detectRealtimeDown({ ...base, enabled: false, subscribed: false }),
    ).toEqual([]);
  });
});

describe("i. detectStaleCrons", () => {
  const now = T("2026-10-01T12:00:00Z");
  const expected = { "timer-cleanup": 5, "daily-digest": 24 * 60 };

  it("job der har kørt inden for 2× interval er OK", () => {
    expect(
      detectStaleCrons(
        [
          { jobName: "timer-cleanup", lastRunAt: T("2026-10-01T11:52:00Z") },
          { jobName: "daily-digest", lastRunAt: T("2026-09-30T08:00:00Z") },
        ],
        expected,
        now,
      ),
    ).toEqual([]);
  });

  it("job der er gået i stå er en advarsel", () => {
    const fs = detectStaleCrons(
      [
        { jobName: "timer-cleanup", lastRunAt: T("2026-10-01T11:30:00Z") },
        { jobName: "daily-digest", lastRunAt: T("2026-09-30T08:00:00Z") },
      ],
      expected,
      now,
    );
    expect(fs).toHaveLength(1);
    expect(fs[0].fingerprint).toBe("cron_stale:timer-cleanup");
    expect(fs[0].severity).toBe("warning");
  });

  it("job der aldrig er set er kun info", () => {
    const fs = detectStaleCrons(
      [{ jobName: "timer-cleanup", lastRunAt: T("2026-10-01T11:58:00Z") }],
      expected,
      now,
    );
    expect(fs).toHaveLength(1);
    expect(fs[0].severity).toBe("info");
  });

  it("ai-suggestions (man–fre) alarmerer ikke over weekenden", () => {
    const monday = T("2026-10-05T08:00:00Z");
    expect(
      detectStaleCrons(
        [{ jobName: "ai-suggestions", lastRunAt: T("2026-10-02T08:30:00Z") }],
        { "ai-suggestions": 24 * 60 },
        monday,
      ),
    ).toEqual([]);
  });
});
