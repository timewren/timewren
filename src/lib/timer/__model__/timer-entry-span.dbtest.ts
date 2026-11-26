/**
 * Timer-poster gemmes med en start, der rummer deres timetal (prod
 * 10.-19/11-2026, stabilitetsvagtens `hours_mismatch`): en genoptaget timer
 * har `start_time` = seneste genoptagelse og den tidligere tid i
 * `base_seconds`. Web gemte posten med den start og hele sessionens timer —
 * fx 1,08 t på et tidsrum af 7 s. Serveren flytter nu starten til
 * slut − timer for timer-gemninger (lib/timer/entry-span.ts).
 *
 * Desuden: hver opdatering af en tidspost stempler `updated_at` (også de
 * stier, der ikke selv sætter den).
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

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
  drizzle: typeof import("drizzle-orm");
  stopProtocol: typeof import("@/lib/timer/stop-protocol");
  queries: typeof import("@/lib/stability/queries");
  detectors: typeof import("@/lib/stability/detectors");
  copenhagen: typeof import("@/lib/time/copenhagen");
  world: typeof import("./world");
};
let d: Deps;

const HOUR = 3_600_000;

async function findingsFor(userId: string, since: Date) {
  const rows = await d.queries.queryHoursMismatch(d.db, since);
  return d.detectors.detectHoursMismatch(
    rows.filter((r) => r.userId === userId),
  );
}

/** En kørende timer, genoptaget for 7 s siden, med 3.881 s fra før pausen. */
async function seedResumedTimer(
  fx: Awaited<ReturnType<Deps["world"]["seedFixture"]>>,
) {
  const resumedAt = new Date(Date.now() - 7_000);
  await d.db.insert(d.schema.timerStates).values({
    userId: fx.userId,
    isRunning: true,
    startTime: resumedAt,
    elapsedSeconds: 3_881,
    baseSeconds: 3_881,
    projectId: fx.targets.A.projectId,
    clientId: null,
    description: "",
    lastSyncedFrom: "web",
    version: 1,
  } as never);
  const claimed = await d.stopProtocol.claimStop(d.db, {
    userId: fx.userId,
    orgId: fx.orgId,
    headers: null,
    source: "web",
    expectedVersion: 1,
  });
  if (!claimed.success || !claimed.sessionId) {
    throw new Error("claim fejlede uventet");
  }
  return { resumedAt, sessionId: claimed.sessionId };
}

describe.skipIf(!ENABLED)("timer-poster: start = slut − timer", () => {
  beforeAll(async () => {
    d = {
      db: (await import("@/lib/db")).db,
      schema: await import("@/lib/db/schema"),
      drizzle: await import("drizzle-orm"),
      stopProtocol: await import("@/lib/timer/stop-protocol"),
      queries: await import("@/lib/stability/queries"),
      detectors: await import("@/lib/stability/detectors"),
      copenhagen: await import("@/lib/time/copenhagen"),
      world: await import("./world"),
    };
  });

  it("en genoptaget timer gemmes med start = slut − timer, og vagten finder intet", async () => {
    const since = new Date(Date.now() - 60_000);
    const fx = await d.world.seedFixture();
    const { resumedAt, sessionId } = await seedResumedTimer(fx);
    const end = new Date();

    // Som en web-fane før rettelsen: start = seneste genoptagelse
    const entry = await d.world.sessionCaller(fx).time.create({
      projectId: fx.targets.A.projectId,
      description: "Genoptaget timer",
      hours: 1.08,
      date: d.copenhagen.toCopenhagenDateStr(resumedAt),
      startTime: resumedAt.toISOString(),
      endTime: end.toISOString(),
      fromTimer: true,
      timerSessionId: sessionId,
    });

    const expectedStart = new Date(end.getTime() - 1.08 * HOUR);
    expect(entry.startTime?.getTime()).toBe(expectedStart.getTime());
    expect(entry.endTime?.getTime()).toBe(end.getTime());
    expect(entry.timerSessionId).toBe(sessionId);
    expect(entry.date.toISOString().slice(0, 10)).toBe(
      d.copenhagen.toCopenhagenDateStr(expectedStart),
    );
    expect(await findingsFor(fx.userId, since)).toEqual([]);
  });

  it("en gemning uden session (ældre klient) med flyttet start lægges sammen med samme sessions første post", async () => {
    const fx = await d.world.seedFixture();
    const caller = d.world.sessionCaller(fx);
    const resumedAt = new Date(Date.now() - 60_000);
    const firstEnd = new Date(Date.now() - 30_000);
    const save = (end: Date, hours: number) =>
      caller.time.create({
        projectId: fx.targets.A.projectId,
        description: "Gemt to gange",
        hours,
        date: d.copenhagen.toCopenhagenDateStr(resumedAt),
        startTime: resumedAt.toISOString(),
        endTime: end.toISOString(),
        fromTimer: true,
      });
    const first = await save(firstEnd, 1.5);
    // Samme session gemt igen 30 s senere (genopstanden timer)
    const second = await save(new Date(), 1.51);

    expect(second.id).toBe(first.id);
    const entries = await d.world.readEntries(fx.userId);
    expect(entries).toHaveLength(1);
    expect(Number(entries[0].hours)).toBe(1.51);
  });

  it("en manuel post med flere timer end tidsrummet røres ikke", async () => {
    const fx = await d.world.seedFixture();
    const start = new Date(Date.now() - 10 * 60_000);
    const end = new Date();
    const entry = await d.world.sessionCaller(fx).time.create({
      projectId: fx.targets.A.projectId,
      description: "Manuel post",
      hours: 2,
      date: d.copenhagen.toCopenhagenDateStr(start),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
    expect(entry.startTime?.getTime()).toBe(start.getTime());
  });

  it("opdateringer stempler updated_at, også fra stier der ikke selv sætter den", async () => {
    const fx = await d.world.seedFixture();
    const old = new Date(Date.now() - 2 * HOUR);
    const [row] = await d.db
      .insert(d.schema.timeEntries)
      .values({
        userId: fx.userId,
        organizationId: fx.orgId,
        projectId: fx.targets.A.projectId,
        description: "Før",
        hours: "1.00",
        date: d.copenhagen.entryDateFromStr(
          d.copenhagen.toCopenhagenDateStr(old),
        ),
        source: "manual",
        createdAt: old,
        updatedAt: old,
      } as never)
      .returning();
    const caller = d.world.sessionCaller(fx);
    const readUpdatedAt = async () =>
      (
        await d.db.query.timeEntries.findFirst({
          where: d.drizzle.eq(d.schema.timeEntries.id, row.id),
        })
      )?.updatedAt.getTime() ?? 0;

    await caller.time.quickUpdateDescription({
      id: row.id,
      description: "Efter",
    });
    const afterDescription = await readUpdatedAt();
    expect(afterDescription).toBeGreaterThan(old.getTime() + HOUR);

    // Nulstil og prøv en anden sti uden eget updatedAt
    await d.db.execute(
      d.drizzle
        .sql`UPDATE time_entries SET updated_at = ${old.toISOString()}::timestamp WHERE id = ${row.id}`,
    );
    await caller.time.toggleBillable({ id: row.id, isBillable: false });
    expect(await readUpdatedAt()).toBeGreaterThan(old.getTime() + HOUR);
  });
});
