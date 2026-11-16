/**
 * CodeRabbit (PR #858, withLegacyStopTarget): når sessionens række ikke har
 * sin egen `clientId` (kun et projekt), bypassede `sameTarget`-tjekket helt
 * — en ældre app kunne sende en helt anden kundes `clientId` og
 * `prepaidPackageId` sammen med stoppet, og de blev liggende, fordi koden
 * kun tjekkede "har sessionen en kunde" i stedet for at sammenligne mod
 * projektets EGEN kunde. Fixet ved at lade `withLegacyStopTarget` få
 * projektets effektive kunde og sammenligne `input.clientId` mod den.
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
  stopProtocol: typeof import("@/lib/timer/stop-protocol");
  world: typeof import("./world");
};
let d: Deps;

describe.skipIf(!ENABLED)(
  "legacy-stop uden kunde på rækken: projektets EGEN kunde afgør matchet (PR #858, withLegacyStopTarget)",
  () => {
    beforeAll(async () => {
      d = {
        db: (await import("@/lib/db")).db,
        schema: await import("@/lib/db/schema"),
        stopProtocol: await import("@/lib/timer/stop-protocol"),
        world: await import("./world"),
      };
    });

    it("rækken bærer kun projekt B; appens stop sender kunde A's stale sats — satsen droppes, intet klippekort er involveret", async () => {
      const fx = await d.world.seedFixture();
      const now = new Date();

      // Rækken har kun projektet (kunde B) — ingen egen clientId, som når
      // appen kun har valgt et projekt. Intet klippekort i spil her, så
      // `deductHoursCore`s kunde-tjek (en anden fejlklasse) kan ikke skjule
      // et hul i `withLegacyStopTarget` selv.
      await d.db.insert(d.schema.timerStates).values({
        userId: fx.userId,
        isRunning: true,
        startTime: now,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: fx.targets.B.projectId,
        clientId: null,
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

      const caller = d.world.sessionCaller(fx, {
        "x-timetrack-client": "mobile/5.0.0",
      });

      const entry = await caller.time.create({
        projectId: fx.targets.B.projectId,
        clientId: fx.targets.A.clientId,
        description: "Legacy-stop med forældet kunde og sats",
        hours: 0.5,
        date: "2026-10-20",
        startTime: now.toISOString(),
        fromTimer: true,
        billableRate: "999.99",
        isBillable: false,
      } as never);

      // Projekt og opgave følger sessionen; kundens (og dens satsvalg) er
      // IKKE kunde A's forældede kopi fra appen — den blev droppet.
      expect(entry.projectId).toBe(fx.targets.B.projectId);
      expect(entry.clientId).toBeNull();
      expect(entry.billableRate).not.toBe("999.99");
      expect(entry.isBillable).not.toBe(false);
    });
  },
);
