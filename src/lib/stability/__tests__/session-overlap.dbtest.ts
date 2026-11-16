/**
 * Stabilitetsvagten: samme timer-session gemt to gange med forskudt start
 * (2.6.0 gemmer sessionen, en ældre klient gemmer en parkeret rest minutter
 * senere). Tjekker SQL'en i querySessionOverlapPairs mod rigtig Postgres —
 * begge grene (sessionens post ny / restens post ny) og tidszonen på
 * timer_sessions (timestamptz) mod posterne (UTC uden zone).
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureEvent: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

const ENABLED = process.env.TT_DB_TESTS === "1";

type Deps = {
  db: typeof import("@/lib/db").db;
  schema: typeof import("@/lib/db/schema");
  queries: typeof import("../queries");
  detectors: typeof import("../detectors");
  world: typeof import("@/lib/timer/__model__/world");
};
let d: Deps;

const MIN = 60_000;

async function seed(opts: {
  restCreatedFirst: boolean;
  restTarget: "A" | "B";
}) {
  const fx = await d.world.seedFixture();
  const A = fx.targets.A;
  const rest = fx.targets[opts.restTarget];
  const sessionId = randomUUID();
  const start = new Date(Date.now() - 3 * 60 * MIN);
  const end = new Date(start.getTime() + 2 * 60 * MIN);
  await d.db.insert(d.schema.timerSessions).values({
    id: sessionId,
    userId: fx.userId,
    status: "saved",
    startedAt: start,
    endedAt: end,
    projectId: A.projectId,
    clientId: A.clientId,
  } as never);
  const base = Date.now() - 10 * MIN;
  const sessionEntry = {
    userId: fx.userId,
    projectId: A.projectId,
    clientId: A.clientId,
    hours: "2.00",
    date: start,
    startTime: start,
    endTime: end,
    source: "extension",
    timerSessionId: sessionId,
    createdAt: new Date(base + (opts.restCreatedFirst ? 5 * MIN : 0)),
  };
  // Resten: 4 min forskudt, gemt som "manual" af en ældre web-fane
  const restEntry = {
    userId: fx.userId,
    projectId: rest.projectId,
    clientId: rest.clientId,
    hours: "2.03",
    date: start,
    startTime: new Date(start.getTime() + 4 * MIN),
    endTime: new Date(end.getTime() + 6 * MIN),
    source: "manual",
    createdAt: new Date(base + (opts.restCreatedFirst ? 0 : 5 * MIN)),
  };
  const [a] = await d.db
    .insert(d.schema.timeEntries)
    .values(sessionEntry as never)
    .returning({ id: d.schema.timeEntries.id });
  const [b] = await d.db
    .insert(d.schema.timeEntries)
    .values(restEntry as never)
    .returning({ id: d.schema.timeEntries.id });
  return { userId: fx.userId, sessionId, a: a.id, b: b.id, base };
}

describe.skipIf(!ENABLED)("stabilitetsvagten: samme timer-session", () => {
  beforeAll(async () => {
    d = {
      db: (await import("@/lib/db")).db,
      schema: await import("@/lib/db/schema"),
      queries: await import("../queries"),
      detectors: await import("../detectors"),
      world: await import("@/lib/timer/__model__/world"),
    };
  });

  for (const restCreatedFirst of [false, true]) {
    it(`finder resten (${restCreatedFirst ? "sessionens post" : "resten"} gemt sidst)`, async () => {
      const s = await seed({ restCreatedFirst, restTarget: "A" });
      // Vinduet dækker kun den SENESTE post — den anden gren skal finde parret
      const since = new Date(s.base + 4 * MIN);
      const rows = (
        await d.queries.querySessionOverlapPairs(d.db, since)
      ).filter((r) => r.userId === s.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        sessionId: s.sessionId,
        entryId: s.a,
        otherEntryId: s.b,
        sameAssignment: true,
      });
      expect(rows[0].sessionStartedAt.getTime()).toBe(
        rows[0].startTime.getTime(),
      );
      const [f] = d.detectors
        .detectDuplicateSessions([], rows)
        .filter((x) => x.userId === s.userId);
      expect(f.severity).toBe("critical");
    });
  }

  it("anden kunde i sessionens tidsrum: info", async () => {
    const s = await seed({ restCreatedFirst: false, restTarget: "B" });
    const rows = (
      await d.queries.querySessionOverlapPairs(d.db, new Date(s.base))
    ).filter((r) => r.userId === s.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].sameAssignment).toBe(false);
    expect(d.detectors.detectDuplicateSessions([], rows)[0].severity).toBe(
      "info",
    );
  });

  it("poster uden for vinduet ses ikke", async () => {
    const s = await seed({ restCreatedFirst: false, restTarget: "A" });
    const rows = (
      await d.queries.querySessionOverlapPairs(d.db, new Date(s.base + 6 * MIN))
    ).filter((r) => r.userId === s.userId);
    expect(rows).toEqual([]);
  });
});
