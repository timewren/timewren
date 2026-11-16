/**
 * Review P3: quickStop nulstiller rækken via sessionen. Lander et quick-add
 * (+N min) mellem stoppet og nulstillingen, må de ekstra minutter ikke
 * forsvinde: kun en pauset række med præcis den stoppede tid ryddes; ellers
 * bliver resten (de tilføjede minutter) stående som en ny pauset session.
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
  sessions: typeof import("@/lib/timer/sessions");
  world: typeof import("./world");
};
let d: Deps;

/** Rækken som quickStop efterlader den: pauset med den stoppede tid. */
async function stoppedRow(stoppedSeconds: number, quickAddSeconds: number) {
  const fx = await d.world.seedFixture();
  const sessionId = randomUUID();
  const now = new Date();
  await d.db.insert(d.schema.timerSessions).values({
    id: sessionId,
    userId: fx.userId,
    organizationId: null,
    status: "paused",
    startedAt: new Date(now.getTime() - stoppedSeconds * 1000),
    projectId: fx.targets.A.projectId,
    clientId: fx.targets.A.clientId,
    description: "",
  } as never);
  const total = stoppedSeconds + quickAddSeconds;
  await d.db.insert(d.schema.timerStates).values({
    userId: fx.userId,
    isRunning: false,
    startTime: null,
    elapsedSeconds: total,
    baseSeconds: total,
    projectId: fx.targets.A.projectId,
    clientId: fx.targets.A.clientId,
    description: "",
    lastSyncedFrom: "extension",
    currentSessionId: sessionId,
    version: 3,
  } as never);
  const [entry] = await d.db
    .insert(d.schema.timeEntries)
    .values({
      userId: fx.userId,
      projectId: fx.targets.A.projectId,
      clientId: fx.targets.A.clientId,
      description: "quickStop",
      hours: (stoppedSeconds / 3600).toFixed(2),
      date: now,
      startTime: new Date(now.getTime() - stoppedSeconds * 1000),
      endTime: now,
      source: "timer",
      timerSessionId: sessionId,
    } as never)
    .returning({ id: d.schema.timeEntries.id });
  await d.db.transaction(async (tx) => {
    await d.sessions.saveSessionEntry(tx, {
      userId: fx.userId,
      organizationId: null,
      sessionId,
      entryId: entry.id,
      expectedElapsedSeconds: stoppedSeconds,
    });
  });
  const row = await d.world.readTimerRow(fx.userId);
  const sessions = await d.world.readSessions(fx.userId);
  return { row, sessions, sessionId };
}

describe.skipIf(!ENABLED)("quickStop: nulstilling via sessionen (P3)", () => {
  beforeAll(async () => {
    d = {
      db: (await import("@/lib/db")).db,
      schema: await import("@/lib/db/schema"),
      sessions: await import("@/lib/timer/sessions"),
      world: await import("./world"),
    };
  });

  it("uden quick-add: rækken ryddes, sessionen er gemt", async () => {
    const { row, sessions, sessionId } = await stoppedRow(600, 0);
    expect(row?.elapsedSeconds).toBe(0);
    expect(row?.currentSessionId).toBeNull();
    expect(sessions.find((s) => s.id === sessionId)?.status).toBe("saved");
  });

  it("quick-add mellem stop og nulstilling: de tilføjede minutter bliver stående som en ny pauset session", async () => {
    const { row, sessions, sessionId } = await stoppedRow(600, 300);
    expect(row?.isRunning).toBe(false);
    expect(row?.elapsedSeconds).toBe(300);
    expect(row?.baseSeconds).toBe(300);
    expect(row?.currentSessionId).not.toBeNull();
    expect(row?.currentSessionId).not.toBe(sessionId);
    expect(sessions.find((s) => s.id === sessionId)?.status).toBe("saved");
    expect(sessions.find((s) => s.id === row?.currentSessionId)?.status).toBe(
      "paused",
    );
  });

  it("tiden faldt under den stoppede tid: timer-cleanup rydder den tomme pausede rest", async () => {
    // Rækken nåede at falde til 500 s, mens 600 s blev gemt: nulstillingen
    // rammer ikke (≠ 600), og resten bliver GREATEST(500 − 600, 0) = 0 s
    // på en ny pauset session — ingen ugemt tid.
    const { row, sessionId } = await stoppedRow(600, -100);
    const userId = row?.userId ?? "";
    expect(row?.isRunning).toBe(false);
    expect(row?.elapsedSeconds).toBe(0);
    const restId = row?.currentSessionId;
    expect(restId).not.toBeNull();
    expect(restId).not.toBe(sessionId);

    // Inden for henstandsperioden røres den ikke
    await d.db.transaction((tx) => d.sessions.clearEmptyPausedRows(tx));
    expect((await d.world.readTimerRow(userId))?.currentSessionId).toBe(restId);

    const later = new Date(
      Date.now() + (d.sessions.EMPTY_PAUSED_ROW_GRACE_MINUTES + 1) * 60_000,
    );
    const cleared = await d.db.transaction((tx) =>
      d.sessions.clearEmptyPausedRows(tx, later),
    );
    expect(cleared.map((r) => r.userId)).toContain(userId);
    const after = await d.world.readTimerRow(userId);
    expect(after?.currentSessionId).toBeNull();
    expect(after?.projectId).toBeNull();
    expect(after?.version).toBe((row?.version ?? 0) + 1);
    const afterSessions = await d.world.readSessions(userId);
    expect(afterSessions.find((s) => s.id === restId)?.status).toBe(
      "discarded",
    );
    expect(afterSessions.find((s) => s.id === sessionId)?.status).toBe("saved");
  });

  it("timer-cleanup rører ikke en pauset række med ugemt tid", async () => {
    const { row } = await stoppedRow(600, 300);
    const userId = row?.userId;
    const later = new Date(
      Date.now() + (d.sessions.EMPTY_PAUSED_ROW_GRACE_MINUTES + 1) * 60_000,
    );
    const cleared = await d.db.transaction((tx) =>
      d.sessions.clearEmptyPausedRows(tx, later),
    );
    expect(cleared.map((r) => r.userId)).not.toContain(userId);
    const after = await d.world.readTimerRow(userId ?? "");
    expect(after?.elapsedSeconds).toBe(300);
    expect(after?.currentSessionId).toBe(row?.currentSessionId);
  });
});
