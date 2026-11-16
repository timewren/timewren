/**
 * CodeRabbit (PR #858, opfølgning på withLegacyStopTarget): selve
 * legacy-stop-huller er lukket (klient/opgave følger altid sessionen), men
 * `time.create` kaldte `deductHoursCore` uden at tjekke, at klippekortets
 * kunde er postens egen — en fjern/forældet `prepaidPackageId` fra en helt
 * anden klient kunne trækkes og gemmes på posten. `time.update` har allerede
 * dette tjek; `deductHoursCore` har det nu selv, så hele fejlklassen (alle
 * kaldere, ikke kun legacy-stop) er lukket ét sted.
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
  world: typeof import("./world");
};
let d: Deps;

describe.skipIf(!ENABLED)(
  "time.create afviser et klippekort fra en anden kunde (PR #858, deductHoursCore)",
  () => {
    beforeAll(async () => {
      d = {
        db: (await import("@/lib/db")).db,
        schema: await import("@/lib/db/schema"),
        world: await import("./world"),
      };
    });

    it("projektet hører til kunde B, klippekortet til kunde A: afvises, intet trukket, ingen post gemt", async () => {
      const fx = await d.world.seedFixture();
      const caller = d.world.sessionCaller(fx);

      await expect(
        caller.time.create({
          projectId: fx.targets.B.projectId,
          description: "Fremmed klippekort",
          hours: 1,
          date: "2026-10-20",
          prepaidPackageId: fx.packageId,
        } as never),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "Klippekortet tilhører en anden kunde",
        ),
      });

      const entries = await d.db.query.timeEntries.findMany({
        where: (t, { eq }) => eq(t.userId, fx.userId),
      });
      expect(entries).toHaveLength(0);

      const pkg = await d.db.query.prepaidPackages.findFirst({
        where: (p, { eq }) => eq(p.id, fx.packageId),
      });
      expect(pkg?.remainingHours).toBe("1000.00");
    });
  },
);
