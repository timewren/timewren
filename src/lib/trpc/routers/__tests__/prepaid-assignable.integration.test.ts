import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import {
  clients,
  members,
  organizations,
  orgPeriodLocks,
  prepaidPackages,
  prepaidUsage,
  projects,
  subscriptions,
  tasks,
  timeEntries,
  timeEntrySegments,
  users,
} from "@/lib/db/schema";
import {
  connectTestDb,
  isolatedTestDatabase,
  testPostgres,
} from "@/test/test-db";
import { prepaidRouter } from "../prepaid";
import { timeRouter } from "../time";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));

vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));

const org = "assignable-org";
const user = "assignable-owner";
const date = (day: number) => new Date(Date.UTC(2026, 10, day));

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "prepaid.getAssignableEntries",
  () => {
    const database = isolatedTestDatabase();
    const orderedCardLocks: unknown[][] = [];
    const relatedWritesByConnection = new Map<number, number>();
    const relatedWritesBeforeCardLocks: number[] = [];
    const taskWriteIds: unknown[] = [];
    const pg = testPostgres({
      max: 2,
      database: database.name,
      debug: (connection, query, params) => {
        if (query.trim() === "begin") {
          relatedWritesByConnection.set(connection, 0);
        }
        if (query.startsWith('update "tasks"')) {
          taskWriteIds.push(params.at(-1));
        }
        if (
          query.startsWith('update "tasks"') ||
          query.startsWith('update "time_entry_segments"')
        ) {
          relatedWritesByConnection.set(
            connection,
            (relatedWritesByConnection.get(connection) ?? 0) + 1,
          );
        }
        if (
          query.includes('from "prepaid_packages"') &&
          query.includes('order by "prepaid_packages"."id" for no key update')
        ) {
          orderedCardLocks.push(params);
          relatedWritesBeforeCardLocks.push(
            relatedWritesByConnection.get(connection) ?? 0,
          );
        }
      },
    });
    const db = drizzle(pg, { schema });
    let caller: ReturnType<typeof prepaidRouter.createCaller>;
    let timeCaller: ReturnType<typeof timeRouter.createCaller>;
    let packageId: string;
    let projectId: string;
    let oldCardId: string;
    let internalProjectId: string;
    let clientId: string;

    beforeAll(async () => {
      await database.create();
      await connectTestDb(pg);
      await db.insert(users).values({
        id: user,
        name: "Test Owner",
        email: "owner@acme-studio.demo",
      });
      await db.insert(organizations).values([
        { id: org, name: "Test Studio", slug: org },
        { id: "other-org", name: "Other Studio", slug: "other-org" },
      ]);
      await db.insert(members).values({
        id: "assignable-membership",
        organizationId: org,
        userId: user,
        role: "owner",
      });

      const [client, other] = await db
        .insert(clients)
        .values([
          { name: "Acme Studio", userId: user, organizationId: org },
          { name: "Example Workshop", userId: user, organizationId: org },
        ])
        .returning({ id: clients.id });
      clientId = client.id;
      const [project, internal] = await db
        .insert(projects)
        .values([
          { name: "Website", userId: user, organizationId: org, clientId },
          { name: "Internal", userId: user, organizationId: org },
        ])
        .returning({ id: projects.id });
      projectId = project.id;
      internalProjectId = internal.id;
      const card = {
        userId: user,
        organizationId: org,
        clientId: client.id,
        totalHours: "10",
        remainingHours: "10",
        hourlyRate: "100",
        totalValue: "1000",
        purchaseDate: date(1),
      };
      const [target, old, otherClient, otherOrg] = await db
        .insert(prepaidPackages)
        .values([
          { ...card, name: "New card", isArchived: null },
          { ...card, name: "Old card", isActive: false, isArchived: true },
          { ...card, name: "Other client's card", clientId: other.id },
          { ...card, name: "Other org's card", organizationId: "other-org" },
          { ...card, name: "Archived active card", isArchived: true },
        ])
        .returning({ id: prepaidPackages.id });
      packageId = target.id;
      oldCardId = old.id;

      const entry = {
        userId: user,
        organizationId: org,
        hours: "1.25",
        projectId,
        date: date(18),
      };
      await db.insert(timeEntries).values([
        { ...entry, description: "Unlinked" },
        {
          ...entry,
          description: "On old card",
          prepaidPackageId: old.id,
          isPrepaid: true,
        },
        {
          ...entry,
          description: "Already on target",
          prepaidPackageId: target.id,
          isPrepaid: true,
        },
        {
          ...entry,
          description: "Billed",
          prepaidPackageId: old.id,
          isBilled: true,
        },
        { ...entry, description: "Overridden client", clientId: other.id },
        {
          ...entry,
          description: "Wrong card client",
          prepaidPackageId: otherClient.id,
        },
        {
          ...entry,
          description: "Wrong card organization",
          prepaidPackageId: otherOrg.id,
        },
        {
          ...entry,
          description: "Wrong entry organization",
          organizationId: "other-org",
        },
        {
          ...entry,
          description: "No project",
          projectId: null,
          clientId: client.id,
        },
        { ...entry, description: "Earlier", date: date(17) },
        { ...entry, description: "Later", date: date(19) },
      ]);
      await db.insert(subscriptions).values({
        userId: user,
        organizationId: org,
        status: "active",
        planTier: "team",
        billingCycle: "monthly",
        trialEndsAt: date(30),
      });
      const context = {
        db,
        headers: new Headers(),
        orgOverride: org,
        session: { user: { id: user } },
      } as never;
      caller = prepaidRouter.createCaller(context);
      timeCaller = timeRouter.createCaller(context);
    });

    afterAll(async () => {
      await pg.end();
      await database.drop();
    });

    it("previews only the selected entries, including entries already on the target", async () => {
      const selected = await db.query.timeEntries.findMany({
        where: inArray(timeEntries.description, [
          "On old card",
          "Already on target",
          "No project",
        ]),
      });
      expect(selected).toHaveLength(3);
      const timeEntryIds = selected.map(({ id }) => id);
      const cards = await caller.getPackagesForEntries({ timeEntryIds });
      expect(cards.packages.map(({ id }) => id)).toEqual([packageId]);
      const preview = await caller.getAssignableEntries({
        packageId,
        timeEntryIds,
        includeOtherCards: true,
      });
      expect(preview.map(({ id }) => id).sort()).toEqual(
        [...timeEntryIds].sort(),
      );
      expect(
        preview.find(({ description }) => description === "Already on target")
          ?.prepaidPackageId,
      ).toBe(packageId);
    });

    it("lists only unlinked entries by default", async () => {
      const rows = await caller.getAssignableEntries({ packageId });
      expect(rows.map((row) => row.description).sort()).toEqual([
        "Earlier",
        "Later",
        "No project",
        "Unlinked",
      ]);
    });

    it("includes entries on other cards of the same client and organization", async () => {
      const rows = await caller.getAssignableEntries({
        packageId,
        includeOtherCards: true,
      });
      expect(rows.map((row) => row.description).sort()).toEqual([
        "Earlier",
        "Later",
        "No project",
        "On old card",
        "Unlinked",
      ]);
      expect(
        rows.find((row) => row.description === "On old card"),
      ).toMatchObject({
        projectId,
        projectName: "Website",
        prepaidPackageId: oldCardId,
        prepaidPackageName: "Old card",
        hours: 1.25,
      });
    });

    it("filters by project and inclusive dates before limiting", async () => {
      const rows = await caller.getAssignableEntries({
        packageId,
        includeOtherCards: true,
        projectId,
        limit: 2,
        from: "2026-11-18",
        to: "2026-11-18",
      });
      expect(rows.map((row) => row.description).sort()).toEqual([
        "On old card",
        "Unlinked",
      ]);
    });
    it("finds internal projects and pages through entries on the same date", async () => {
      await db.insert(timeEntries).values(
        Array.from({ length: 201 }, (_, index) => ({
          userId: user,
          organizationId: org,
          clientId,
          projectId: internalProjectId,
          date: date(18),
          hours: "1.25",
          description: `Internal entry ${index}`,
        })),
      );
      expect(await caller.getAssignableProjects({ packageId })).toContainEqual({
        id: internalProjectId,
        name: "Internal",
      });
      const filters = {
        packageId,
        projectId: internalProjectId,
        from: "2026-11-18",
        to: "2026-11-18",
        limit: 200,
      };
      const first = await caller.getAssignableEntries(filters);
      const next = await caller.getAssignableEntries({
        ...filters,
        offset: 200,
      });
      expect(first).toHaveLength(200);
      expect(next).toHaveLength(1);
      expect(new Set([...first, ...next].map((row) => row.id)).size).toBe(201);
    });
    it("excludes locked months before pagination and project discovery", async () => {
      const [lockedProject] = await db
        .insert(projects)
        .values({
          name: "Locked project",
          userId: user,
          organizationId: org,
          clientId,
        })
        .returning({ id: projects.id });
      await db.insert(timeEntries).values({
        userId: user,
        organizationId: org,
        projectId: lockedProject.id,
        date: date(17),
        hours: "1",
        prepaidPackageId: oldCardId,
        isPrepaid: true,
      });
      const [lock] = await db
        .insert(orgPeriodLocks)
        .values({
          organizationId: org,
          lockedBefore: date(18),
          lockedByUserId: user,
        })
        .returning({ id: orgPeriodLocks.id });
      try {
        const filters = { packageId, includeOtherCards: true };
        const rows = await caller.getAssignableEntries({
          ...filters,
          projectId,
          limit: 10,
        });
        expect(rows.map((row) => row.date)).not.toContainEqual(date(17));
        expect(rows.map((row) => row.date)).toContainEqual(date(18));
        expect(await caller.getAssignableProjects(filters)).not.toContainEqual({
          id: lockedProject.id,
          name: "Locked project",
        });
      } finally {
        await db.delete(orgPeriodLocks).where(eq(orgPeriodLocks.id, lock.id));
      }
    });
    it("applies invoice overflow in the same order as the candidate list", async () => {
      const [target] = await db
        .insert(prepaidPackages)
        .values({
          userId: user,
          organizationId: org,
          clientId,
          name: "Invoice overflow card",
          totalHours: "10",
          usedHours: "9.50",
          remainingHours: "0.50",
          clipSizeMinutes: 30,
          hourlyRate: "100",
          totalValue: "1000",
          purchaseDate: date(1),
          lowBalanceAlertSentAt: date(1),
          overdraftPolicy: "invoice",
        })
        .returning({ id: prepaidPackages.id });
      const [older, newer, oversized] = await db
        .insert(timeEntries)
        .values(
          [
            { date: date(21), hours: "0.17" },
            { date: date(22), hours: "0.17" },
            { date: date(23), hours: "2" },
          ].map((entry) => ({
            ...entry,
            userId: user,
            organizationId: org,
            clientId,
            prepaidPackageId: oldCardId,
            isPrepaid: true,
            isBillable: false,
          })),
        )
        .returning({ id: timeEntries.id });
      await db
        .update(prepaidPackages)
        .set({
          clipSizeMinutes: 15,
          usedHours: "9.90",
          remainingHours: "0.10",
          overdraftHours: "0.10",
        })
        .where(eq(prepaidPackages.id, oldCardId));
      await db.insert(prepaidUsage).values(
        [
          [older.id, "0.25"],
          [newer.id, "0.25"],
          [oversized.id, "2"],
        ].map(([timeEntryId, hoursUsed]) => ({
          timeEntryId,
          prepaidPackageId: oldCardId,
          hoursUsed,
          overdraftHours: timeEntryId === older.id ? "0.10" : "0",
          valueUsed: String(Number(hoursUsed) * 100),
        })),
      );
      const candidates = await caller.getAssignableEntries({
        packageId: target.id,
        includeOtherCards: true,
        from: "2026-11-21",
      });
      expect(candidates.find((entry) => entry.id === newer.id)).toMatchObject({
        prepaidHoursRestored: 0.25,
      });
      expect(candidates.find((entry) => entry.id === older.id)).toMatchObject({
        prepaidHoursRestored: 0.15,
      });
      expect(candidates.map((entry) => entry.id)).toEqual([
        oversized.id,
        newer.id,
        older.id,
      ]);

      const timeEntryIds = [older.id, newer.id, oversized.id];
      expect(
        await caller.bulkAssignEntries({
          packageId: target.id,
          timeEntryIds,
        }),
      ).toMatchObject({
        assigned: 1,
        overflowed: 2,
        remainingHours: 0,
        hoursDeducted: 0.5,
      });
      const cards = await db.query.prepaidPackages.findMany({
        where: inArray(prepaidPackages.id, [oldCardId, target.id]),
      });
      expect(cards).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: oldCardId,
            usedHours: "7.50",
            remainingHours: "2.50",
            overdraftHours: "0.00",
          }),
          expect.objectContaining({
            id: target.id,
            usedHours: "10.00",
            remainingHours: "0.00",
          }),
        ]),
      );
      const usage = await db.query.prepaidUsage.findMany({
        where: inArray(prepaidUsage.timeEntryId, timeEntryIds),
      });
      expect(usage).toMatchObject([
        {
          timeEntryId: newer.id,
          prepaidPackageId: target.id,
          hoursUsed: "0.50",
        },
      ]);
      const saved = await db.query.timeEntries.findMany({
        where: inArray(timeEntries.id, timeEntryIds),
      });
      expect(saved).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: newer.id,
            prepaidPackageId: target.id,
            isPrepaid: true,
          }),
          expect.objectContaining({
            id: older.id,
            prepaidPackageId: null,
            isPrepaid: false,
            isBillable: true,
          }),
          expect.objectContaining({
            id: oversized.id,
            prepaidPackageId: null,
            isPrepaid: false,
            isBillable: true,
          }),
        ]),
      );
    });
    it.each(["bulk", "time.update"])(
      "orders card locks for opposite moves with %s",
      async (otherRoute) => {
        const clipSizes = [15, 30];
        const cards = await db
          .insert(prepaidPackages)
          .values(
            clipSizes.map((clipSizeMinutes) => ({
              userId: user,
              organizationId: org,
              clientId,
              name: `Concurrent card ${clipSizeMinutes}`,
              totalHours: "10",
              usedHours: String(clipSizeMinutes / 60),
              remainingHours: String(10 - clipSizeMinutes / 60),
              hourlyRate: "100",
              totalValue: "1000",
              purchaseDate: date(1),
              clipSizeMinutes,
            })),
          )
          .returning({ id: prepaidPackages.id });
        const taskIds = (
          await db
            .insert(tasks)
            .values(
              ["First task", "Second task"].map((title) => ({
                userId: user,
                organizationId: org,
                clientId,
                title,
                actualMinutes: 10,
              })),
            )
            .returning({ id: tasks.id })
        )
          .map(({ id }) => id)
          .sort();
        const entries = await db
          .insert(timeEntries)
          .values(
            cards.map((card, index) => ({
              userId: user,
              organizationId: org,
              clientId,
              date: date(18),
              hours: "0.17",
              taskId: index === 1 ? taskIds[1] : null,
              prepaidPackageId: card.id,
              isPrepaid: true,
            })),
          )
          .returning({ id: timeEntries.id });
        await db.insert(prepaidUsage).values(
          entries.map((entry, index) => ({
            timeEntryId: entry.id,
            prepaidPackageId: cards[index].id,
            hoursUsed: String(clipSizes[index] / 60),
            valueUsed: String((clipSizes[index] / 60) * 100),
          })),
        );

        await db.insert(timeEntrySegments).values({
          timeEntryId: entries[1].id,
          startTime: date(18),
          endTime: new Date(date(18).getTime() + 10 * 60_000),
          durationMinutes: 10,
        });

        orderedCardLocks.length = 0;
        relatedWritesBeforeCardLocks.length = 0;
        taskWriteIds.length = 0;
        const [bulkResult] = await Promise.all([
          caller.bulkAssignEntries({
            packageId: cards[1].id,
            timeEntryIds: [entries[0].id],
          }),
          otherRoute === "bulk"
            ? caller.bulkAssignEntries({
                packageId: cards[0].id,
                timeEntryIds: [entries[1].id],
              })
            : timeCaller.update({
                id: entries[1].id,
                data: {
                  clientId,
                  date: "2026-11-19",
                  description: "Moved by time editor",
                  hours: 0.22,
                  taskId: taskIds[0],
                  prepaidPackageId: cards[0].id,
                },
              }),
        ]);
        expect(bulkResult).toMatchObject({ assigned: 1, hoursDeducted: 0.5 });
        const cardIds = cards.map(({ id }) => id).sort();
        expect(orderedCardLocks.map((ids) => [...ids].sort())).toEqual([
          cardIds,
          cardIds,
        ]);
        expect(relatedWritesBeforeCardLocks).toEqual([0, 0]);
        expect(taskWriteIds).toEqual(otherRoute === "bulk" ? [] : taskIds);
        const segment = await db.query.timeEntrySegments.findFirst({
          where: eq(timeEntrySegments.timeEntryId, entries[1].id),
        });
        expect(segment?.startTime).toEqual(
          date(otherRoute === "bulk" ? 18 : 19),
        );
        const usage = await db.query.prepaidUsage.findMany({
          where: inArray(
            prepaidUsage.timeEntryId,
            entries.map(({ id }) => id),
          ),
        });
        expect(usage).toHaveLength(2);
        expect(usage).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              timeEntryId: entries[0].id,
              prepaidPackageId: cards[1].id,
              hoursUsed: "0.50",
            }),
            expect.objectContaining({
              timeEntryId: entries[1].id,
              prepaidPackageId: cards[0].id,
              hoursUsed: "0.25",
            }),
          ]),
        );
      },
    );
  },
);
