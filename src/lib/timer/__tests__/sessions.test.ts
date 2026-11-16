import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  currentSessionSavedSql,
  NIL_SESSION_ID,
  sessionIdInsertValue,
  sessionIdSetSql,
  sessionMatchSql,
  sessionStartFromRow,
  sessionStatusForRow,
  timerSyncSessionMode,
  withLegacyStopTarget,
} from "../sessions";

const dialect = new PgDialect();
const render = (q: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  dialect.sqlToQuery(q);

const base = {
  isRunning: true,
  isPauseWrite: false,
  isQueuedStart: false,
  isFreshStart: false,
  isAdoption: false,
  baseSeconds: 0,
  hasSessionId: false,
};

describe("timerSyncSessionMode", () => {
  it("en ny start uden tidligere tid er en NY session", () => {
    expect(timerSyncSessionMode({ ...base, isFreshStart: true })).toBe("new");
    expect(timerSyncSessionMode({ ...base, isQueuedStart: true })).toBe("new");
  });

  it("en ældre klients genoptag (frisk start MED tid) beholder sessionen", () => {
    expect(
      timerSyncSessionMode({ ...base, isFreshStart: true, baseSeconds: 60 }),
    ).toBe("keep");
  });

  it("med sessionId er det altid samme session — prædikatet afgør", () => {
    expect(
      timerSyncSessionMode({ ...base, isFreshStart: true, hasSessionId: true }),
    ).toBe("keep");
    expect(
      timerSyncSessionMode({
        ...base,
        isQueuedStart: true,
        hasSessionId: true,
      }),
    ).toBe("keep");
  });

  it("heartbeat, adoption og pause beholder sessionen", () => {
    expect(timerSyncSessionMode(base)).toBe("keep");
    expect(
      timerSyncSessionMode({ ...base, isAdoption: true, isFreshStart: true }),
    ).toBe("keep");
    expect(
      timerSyncSessionMode({ ...base, isRunning: false, isPauseWrite: true }),
    ).toBe("keep");
  });

  it("en rydning (ingen tid, kører ikke) fjerner sessionen", () => {
    expect(timerSyncSessionMode({ ...base, isRunning: false })).toBe("clear");
    expect(
      timerSyncSessionMode({ ...base, isRunning: false, hasSessionId: true }),
    ).toBe("clear");
  });
});

describe("sessionIdSetSql / sessionIdInsertValue", () => {
  const cand = "11111111-1111-4111-8111-111111111111";

  it("new sætter kandidaten, clear sætter NULL", () => {
    const q = render(sessionIdSetSql("new", cand) as never);
    expect(q.sql).toBe("$1::uuid");
    expect(q.params).toEqual([cand]);
    expect(sessionIdSetSql("clear", cand)).toBeNull();
    expect(sessionIdInsertValue("clear", cand)).toBeNull();
    expect(sessionIdInsertValue("keep", cand)).toBe(cand);
  });

  it("keep tildeler dovent, aldrig nyt id midt i et stop — og et nyt id når sessionen er afsluttet", () => {
    const q = render(sessionIdSetSql("keep", cand) as never);
    expect(q.sql).toContain(
      `WHEN "timer_states"."current_session_id" IS NULL THEN`,
    );
    // Review P1: midt i et stop beholdes id'et (før tjekket for gemt)
    expect(q.sql.indexOf(`"timer_states"."intent" = 'stopping'`)).toBeLessThan(
      q.sql.indexOf("EXISTS"),
    );
    expect(q.sql).toContain(`'saved', 'discarded'`);
    expect(q.sql).toContain(`ELSE "timer_states"."current_session_id" END`);
    expect(q.params).toEqual([cand, cand]);
  });

  it("prædikaterne står i SQL'en (atomisk, ingen read-then-write)", () => {
    const m = render(sessionMatchSql(cand));
    expect(m.sql).toBe(`"timer_states"."current_session_id" = $1::uuid`);
    const saved = render(currentSessionSavedSql());
    expect(saved.sql).toContain(
      `"timer_sessions"."id" = "timer_states"."current_session_id"`,
    );
    expect(saved.sql).toContain(`= 'saved'`);
  });

  it("nil-id'et er et gyldigt uuid, der aldrig udstedes", () => {
    expect(NIL_SESSION_ID).toMatch(/^0{8}-0{4}-0{4}-0{4}-0{12}$/);
  });
});

describe("sessionStatusForRow / sessionStartFromRow", () => {
  it("status følger rækken", () => {
    const row = { isRunning: true, elapsedSeconds: 0, baseSeconds: 0 };
    expect(sessionStatusForRow(row)).toBe("running");
    expect(sessionStatusForRow({ ...row, isRunning: false })).toBe("paused");
    expect(sessionStatusForRow({ ...row, intent: "stopping" })).toBe(
      "stopping",
    );
  });

  it("sessionens start er segmentets start minus akkumuleret tid", () => {
    const now = new Date("2026-10-04T10:00:00Z");
    expect(
      sessionStartFromRow(
        { startTime: new Date("2026-10-04T09:30:00Z"), baseSeconds: 600 },
        now,
      ).toISOString(),
    ).toBe("2026-10-04T09:20:00.000Z");
    // En pauset række uden segmentstart: nu minus akkumuleret tid
    expect(
      sessionStartFromRow(
        { startTime: null, baseSeconds: 60 },
        now,
      ).toISOString(),
    ).toBe("2026-10-04T09:59:00.000Z");
    // Klientens egen sessionsstart vinder
    expect(
      sessionStartFromRow(
        { startTime: new Date("2026-10-04T09:30:00Z"), baseSeconds: 600 },
        now,
        Date.parse("2026-10-04T09:00:00Z"),
      ).toISOString(),
    ).toBe("2026-10-04T09:00:00.000Z");
  });
});

describe("withLegacyStopTarget (ældre app, #785)", () => {
  const session = {
    sessionId: "s1",
    projectId: "pB",
    clientId: "cB",
    taskId: "tB",
  };
  const stale = {
    projectId: "pA",
    clientId: "cA",
    taskId: "tA",
    prepaidPackageId: "kA",
    prepaidHoursOverride: 1,
    billableRate: "900",
    isBillable: false,
    hours: 1,
  };

  it("bruger sessionens projekt/kunde/opgave og dropper den gamle kundes klippekort, sats og fakturerbar", () => {
    expect(withLegacyStopTarget(stale, session)).toEqual({
      hours: 1,
      timerSessionId: "s1",
      projectId: "pB",
      clientId: "cB",
      taskId: "tB",
      prepaidPackageId: undefined,
      prepaidHoursOverride: undefined,
      billableRate: undefined,
      isBillable: undefined,
    });
  });

  it("samme projekt og kunde: opgaven følger sessionen, faktureringsvalgene bevares", () => {
    const input = { ...stale, projectId: "pB", clientId: "cB" };
    expect(withLegacyStopTarget(input, session)).toEqual({
      ...input,
      taskId: "tB",
      timerSessionId: "s1",
    });
  });

  it("samme projekt, men projektet er flyttet til en anden kunde: den gamle kundes klippekort, sats og fakturerbar droppes (CodeRabbit, PR #858)", () => {
    const input = { ...stale, projectId: "pB" };
    expect(withLegacyStopTarget(input, session)).toEqual({
      hours: 1,
      timerSessionId: "s1",
      projectId: "pB",
      clientId: "cB",
      taskId: "tB",
      prepaidPackageId: undefined,
      prepaidHoursOverride: undefined,
      billableRate: undefined,
      isBillable: undefined,
    });
  });

  it("samme projekt uden kunde på rækken: kunden ryddes (projektets kunde afgør matchet)", () => {
    const input = { ...stale, projectId: "pB", clientId: "cB" };
    expect(
      withLegacyStopTarget(input, {
        ...session,
        clientId: null,
        projectClientId: "cB",
      }),
    ).toEqual({
      ...input,
      clientId: undefined,
      taskId: "tB",
      timerSessionId: "s1",
    });
  });

  it("uden projekt afgør kunden — og opgaven følger stadig sessionen, ikke appens forældede", () => {
    const row = { ...session, projectId: null };
    const input = { ...stale, projectId: undefined, clientId: "cB" };
    expect(withLegacyStopTarget(input, row)).toEqual({
      ...input,
      taskId: "tB",
      timerSessionId: "s1",
    });
    expect(
      withLegacyStopTarget({ ...input, clientId: "cA" }, row).clientId,
    ).toBe("cB");
  });

  it("sessionens kunde er null, men projektets kunde (cA) matcher input: faktureringsvalgene bevares", () => {
    const row = { ...session, clientId: null, projectClientId: "cA" };
    const input = { ...stale, projectId: "pB", clientId: "cA" };
    expect(withLegacyStopTarget(input, row)).toEqual({
      ...input,
      clientId: undefined,
      taskId: "tB",
      timerSessionId: "s1",
    });
  });

  it("sessionens kunde er null, projektets kunde er cA, input-kunden er cB: faktureringsfelterne droppes (CodeRabbit, PR #858)", () => {
    const row = { ...session, clientId: null, projectClientId: "cA" };
    const input = { ...stale, projectId: "pB", clientId: "cB" };
    expect(withLegacyStopTarget(input, row)).toEqual({
      hours: 1,
      timerSessionId: "s1",
      projectId: "pB",
      clientId: undefined,
      taskId: "tB",
      prepaidPackageId: undefined,
      prepaidHoursOverride: undefined,
      billableRate: undefined,
      isBillable: undefined,
    });
  });
});
