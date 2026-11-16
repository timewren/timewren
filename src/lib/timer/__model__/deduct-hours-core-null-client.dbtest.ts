/**
 * CodeRabbit (PR #858, opfølgning): `deductHoursCore`s kunde-tjek sprang
 * helt over når `options.clientId` var `null`/`undefined` — et klippekort
 * kunne trækkes for en tidspost uden kunde (eller for en post hvis
 * effektive kunde en kalder glemte at udlede). Feltet er nu obligatorisk
 * (`string | null`, ikke `?`), og for ethvert træk knyttet til en post
 * (`timeEntryId`) afvises et mismatch — `null` inklusive, da klippekortets
 * egen kunde (`prepaidPackages.clientId`) aldrig er null.
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
  prepaid: typeof import("@/lib/trpc/routers/prepaid");
  world: typeof import("./world");
};
let d: Deps;

describe.skipIf(!ENABLED)(
  "deductHoursCore afviser en post uden kunde mod et klippekort der HAR en kunde (PR #858)",
  () => {
    beforeAll(async () => {
      d = {
        db: (await import("@/lib/db")).db,
        schema: await import("@/lib/db/schema"),
        prepaid: await import("@/lib/trpc/routers/prepaid"),
        world: await import("./world"),
      };
    });

    it("posten har ingen kunde (clientId: null), klippekortet tilhører kunde A: afvises, intet trukket", async () => {
      const fx = await d.world.seedFixture();
      const now = new Date();

      const [entry] = await d.db
        .insert(d.schema.timeEntries)
        .values({
          userId: fx.userId,
          projectId: null,
          clientId: null,
          description: "Intern tid uden kunde",
          hours: "1.00",
          date: now,
          source: "manual",
        } as never)
        .returning({ id: d.schema.timeEntries.id });

      await expect(
        d.db.transaction((tx) =>
          d.prepaid.deductHoursCore(tx, fx.userId, null, {
            packageId: fx.packageId,
            hours: 1,
            timeEntryId: entry.id,
            clientId: null,
          }),
        ),
      ).rejects.toMatchObject({
        message: expect.stringContaining(
          "Klippekortet tilhører en anden kunde",
        ),
      });

      const pkg = await d.db.query.prepaidPackages.findFirst({
        where: (p, { eq }) => eq(p.id, fx.packageId),
      });
      expect(pkg?.remainingHours).toBe("1000.00");

      const usage = await d.db.query.prepaidUsage.findMany({
        where: (u, { eq }) => eq(u.timeEntryId, entry.id),
      });
      expect(usage).toHaveLength(0);
    });
  },
);
