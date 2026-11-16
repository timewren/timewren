/**
 * CodeRabbit (PR #858): `findStoppingSessionForLegacySave` læser sessionen
 * FØR time.create's transaktion. Når en `cancelStop` når at genoptage
 * timeren i mellemtiden, må det sene legacy-gem ikke markere den genoptagne
 * session gemt — ellers kunne en kørende/pauset session blive stemplet
 * "saved" med en forældet post. `saveSessionEntry`s `requireStatus` er det
 * atomiske prædikat, der forhindrer det (ingen read-then-write).
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
  sessions: typeof import("@/lib/timer/sessions");
  stopProtocol: typeof import("@/lib/timer/stop-protocol");
  world: typeof import("./world");
};
let d: Deps;

describe.skipIf(!ENABLED)(
  "legacy-stop vs. cancelStop: race om samme session (PR #858)",
  () => {
    beforeAll(async () => {
      d = {
        db: (await import("@/lib/db")).db,
        schema: await import("@/lib/db/schema"),
        sessions: await import("@/lib/timer/sessions"),
        stopProtocol: await import("@/lib/timer/stop-protocol"),
        world: await import("./world"),
      };
    });

    it("cancelStop genoptager imellem claim og legacy-gemmet: sessionen markeres IKKE gemt, rækken rulles tilbage urørt", async () => {
      const fx = await d.world.seedFixture();
      const now = new Date();

      // En ældre apps kørende timer (ingen session endnu — tildeles dovent ved claim).
      await d.db.insert(d.schema.timerStates).values({
        userId: fx.userId,
        isRunning: true,
        startTime: now,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: fx.targets.A.projectId,
        clientId: fx.targets.A.clientId,
        description: "",
        lastSyncedFrom: "web",
        version: 1,
      } as never);

      // Legacy-appen claimer stoppet (timerSync.claimForStop) — sætter
      // intent='stopping' og udsteder sessionen.
      const claimed = await d.stopProtocol.claimStop(d.db, {
        userId: fx.userId,
        orgId: null,
        headers: null,
        source: "web",
        expectedVersion: 1,
      });
      if (!claimed.success) throw new Error("claim fejlede uventet");
      const sessionId = claimed.sessionId;
      if (!sessionId) throw new Error("intet sessionId efter claim");

      // RACEN: en cancelStop (fx gem-dialogen annulleret, eller appens egen
      // retry-logik) genoptager timeren, FØR legacy-gemmet når at skrive.
      const cancelled = await d.stopProtocol.cancelStop(d.db, {
        userId: fx.userId,
        orgId: null,
        headers: null,
        source: "web",
        version: claimed.version,
      });
      expect(cancelled.success).toBe(true);

      const rowAfterCancel = await d.world.readTimerRow(fx.userId);
      expect(rowAfterCancel?.isRunning).toBe(true);
      expect(rowAfterCancel?.currentSessionId).toBe(sessionId);

      // Legacy-gemmet ankommer med sit (nu forældede) øjebliksbillede og
      // forsøger at gemme en post for sessionen, der var ved at blive stoppet.
      const [entry] = await d.db
        .insert(d.schema.timeEntries)
        .values({
          userId: fx.userId,
          projectId: fx.targets.A.projectId,
          clientId: fx.targets.A.clientId,
          description: "legacy stop",
          hours: "0.50",
          date: now,
          startTime: now,
          endTime: new Date(now.getTime() + 30 * 60_000),
          source: "auto_track",
        } as never)
        .returning({ id: d.schema.timeEntries.id });

      let rejected = false;
      await d.db
        .transaction(async (tx) => {
          const won = await d.sessions.saveSessionEntry(tx, {
            userId: fx.userId,
            organizationId: null,
            sessionId,
            entryId: entry.id,
            requireStatus: "stopping",
          });
          if (!won) throw new d.sessions.SessionAlreadySavedError();
        })
        .catch((err) => {
          if (!(err instanceof d.sessions.SessionAlreadySavedError)) throw err;
          rejected = true;
        });

      expect(rejected).toBe(true);

      // Den genoptagne session er urørt af det afviste gem — hele
      // transaktionen (inkl. settleRowForSavedSession's skriv) er rullet tilbage.
      const rowAfter = await d.world.readTimerRow(fx.userId);
      expect(rowAfter?.isRunning).toBe(true);
      expect(rowAfter?.currentSessionId).toBe(sessionId);
      expect(rowAfter?.projectId).toBe(fx.targets.A.projectId);
      expect(rowAfter?.version).toBe(rowAfterCancel?.version);

      const sessionRow = (await d.world.readSessions(fx.userId)).find(
        (s) => s.id === sessionId,
      );
      expect(sessionRow?.status).toBe("running");
      expect(sessionRow?.savedEntryId).toBeNull();
    });

    it("uden race (sessionen står stadig i stopping): legacy-gemmet markerer den gemt som normalt", async () => {
      const fx = await d.world.seedFixture();
      const now = new Date();
      await d.db.insert(d.schema.timerStates).values({
        userId: fx.userId,
        isRunning: true,
        startTime: now,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: fx.targets.A.projectId,
        clientId: fx.targets.A.clientId,
        description: "",
        lastSyncedFrom: "web",
        version: 1,
      } as never);

      const claimed = await d.stopProtocol.claimStop(d.db, {
        userId: fx.userId,
        orgId: null,
        headers: null,
        source: "web",
        expectedVersion: 1,
      });
      if (!claimed.success) throw new Error("claim fejlede uventet");
      const sessionId = claimed.sessionId;
      if (!sessionId) throw new Error("intet sessionId efter claim");

      const [entry] = await d.db
        .insert(d.schema.timeEntries)
        .values({
          userId: fx.userId,
          projectId: fx.targets.A.projectId,
          clientId: fx.targets.A.clientId,
          description: "legacy stop",
          hours: "0.50",
          date: now,
          startTime: now,
          endTime: new Date(now.getTime() + 30 * 60_000),
          source: "auto_track",
        } as never)
        .returning({ id: d.schema.timeEntries.id });

      const won = await d.db.transaction((tx) =>
        d.sessions.saveSessionEntry(tx, {
          userId: fx.userId,
          organizationId: null,
          sessionId,
          entryId: entry.id,
          requireStatus: "stopping",
        }),
      );
      expect(won).toBe(true);

      const sessionRow = (await d.world.readSessions(fx.userId)).find(
        (s) => s.id === sessionId,
      );
      expect(sessionRow?.status).toBe("saved");
      expect(sessionRow?.savedEntryId).toBe(entry.id);
    });
  },
);
