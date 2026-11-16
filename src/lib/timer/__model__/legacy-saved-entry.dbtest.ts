/**
 * `findLegacySavedEntry` (review P1): en session som en ældre klient har
 * gemt uden id, må kun kobles til en post, der entydigt er dens — samme
 * org/projekt/kunde, fra en timer, uden session, sluttet ved stoppet og med
 * samme varighed. Hellere ingen match (mulig dublet, som stabilitetsvagten
 * fanger) end en forkert match (tabt tid).
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md).
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

const STOP = new Date(Date.UTC(2026, 9, 20, 12, 0, 0));
const START = new Date(STOP.getTime() - 3 * 3_600_000);

async function setup() {
  const fx = await d.world.seedFixture();
  const sessionId = randomUUID();
  await d.db.insert(d.schema.timerSessions).values({
    id: sessionId,
    userId: fx.userId,
    organizationId: null,
    status: "saved",
    startedAt: START,
    endedAt: new Date(STOP.getTime() + 5_000),
    projectId: fx.targets.A.projectId,
    clientId: fx.targets.A.clientId,
    description: "",
  } as never);
  const session = await d.sessions.findOwnSession(d.db, fx.userId, sessionId);
  if (!session) throw new Error("session mangler");
  return { fx, session };
}

async function entry(
  fx: Awaited<ReturnType<typeof setup>>["fx"],
  o: {
    key?: "A" | "B";
    hours?: number;
    end?: Date;
    source?: string;
    timerSessionId?: string | null;
  } = {},
) {
  const t = fx.targets[o.key ?? "A"];
  const end = o.end ?? new Date(STOP.getTime() - 20_000);
  const hours = o.hours ?? 3;
  const [row] = await d.db
    .insert(d.schema.timeEntries)
    .values({
      userId: fx.userId,
      projectId: t.projectId,
      clientId: t.clientId,
      description: "x",
      hours: hours.toFixed(2),
      date: new Date(end.getTime() - hours * 3_600_000),
      startTime: new Date(end.getTime() - hours * 3_600_000),
      endTime: end,
      source: o.source ?? "auto_track",
      timerSessionId: o.timerSessionId ?? null,
    } as never)
    .returning({ id: d.schema.timeEntries.id });
  return row.id;
}

describe.skipIf(!ENABLED)("findLegacySavedEntry — kun en entydig match", () => {
  beforeAll(async () => {
    d = {
      db: (await import("@/lib/db")).db,
      schema: await import("@/lib/db/schema"),
      sessions: await import("@/lib/timer/sessions"),
      world: await import("./world"),
    };
  });
  afterAll(() => {});

  const find = (s: Awaited<ReturnType<typeof setup>>, hours = 3) =>
    d.sessions.findLegacySavedEntry(d.db, s.fx.userId, s.session, { hours });

  it("finder den ældre klients post og kobler den til sessionen", async () => {
    const s = await setup();
    const id = await entry(s.fx);
    expect((await find(s))?.id).toBe(id);
    const linked = await d.sessions.findOwnSession(
      d.db,
      s.fx.userId,
      s.session.id,
    );
    expect(linked?.savedEntryId).toBe(id);
  });

  it("scenarie A: en manuel post på en anden kunde i sessionens levetid er ikke dens", async () => {
    const s = await setup();
    await entry(s.fx, {
      key: "B",
      hours: 0.25,
      end: new Date(START.getTime() + 75 * 60_000),
      source: "manual",
    });
    expect(await find(s)).toBeUndefined();
  });

  it("scenarie B: den forrige sessions post (med eget timer_session_id) er ikke dens", async () => {
    const s = await setup();
    await entry(s.fx, { timerSessionId: randomUUID() });
    expect(await find(s)).toBeUndefined();
  });

  it("anden kunde, manuel kilde, forkert varighed eller slut langt fra stoppet: ingen match", async () => {
    const s = await setup();
    await entry(s.fx, { key: "B" });
    await entry(s.fx, { source: "manual" });
    await entry(s.fx, { hours: 2.5 });
    await entry(s.fx, { end: new Date(STOP.getTime() - 10 * 60_000) });
    expect(await find(s)).toBeUndefined();
  });

  it("to mulige poster: ingen match (hellere en mulig dublet end tabt tid)", async () => {
    const s = await setup();
    await entry(s.fx);
    await entry(s.fx, { end: new Date(STOP.getTime() + 30_000) });
    expect(await find(s)).toBeUndefined();
  });
});
