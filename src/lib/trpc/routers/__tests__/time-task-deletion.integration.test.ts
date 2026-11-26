import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/desktop/sync/push/route";
import * as schema from "@/lib/db/schema";
import { hashToken } from "@/lib/security/token-hash";
import { mergeIntoSameSessionEntry } from "@/lib/time/same-session-merge";
import { isolatedTestDatabase, testPostgres } from "@/test/test-db";
import { extensionRouter } from "../extension";
import {
  deductHoursCore,
  lockPrepaidPackages,
  reversePrepaidUsage,
} from "../prepaid";
import { timeRouter } from "../time";

const fixture = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof drizzle<typeof schema>> | undefined,
  userId: "time-task-race-owner",
  orgId: "time-task-race-org",
  deviceId: "time-task-race-device",
}));

vi.mock("@/lib/db", () => ({
  get db() {
    return fixture.db;
  },
}));
vi.mock("@/lib/desktop-auth", () => ({
  deviceAuthErrorResponse: () => null,
  authenticateDevice: async () => ({
    userId: fixture.userId,
    deviceId: fixture.deviceId,
  }),
}));
vi.mock("@/lib/desktop-org", () => ({
  resolveDesktopOrgId: async () => fixture.orgId,
}));
vi.mock("@/lib/db/index", () => ({
  get db() {
    return fixture.db;
  },
}));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "time entry writes racing with task deletion",
  () => {
    const database = isolatedTestDatabase();
    const connection = {
      deadlock_timeout: "100ms",
      statement_timeout: 15_000,
    };
    const writer = testPostgres({
      database: database.name,
      max: 1,
      connection,
    });
    const deleter = testPostgres({
      database: database.name,
      max: 1,
      connection,
    });
    const db = drizzle(writer, { schema });
    const { userId, orgId } = fixture;
    fixture.db = db;
    const startTime = new Date("2026-09-30T08:00:00Z");
    const endTime = new Date("2026-09-30T10:00:00Z");
    const caller = timeRouter.createCaller({
      db,
      headers: new Headers(),
      session: { user: { id: userId }, activeOrganizationId: orgId },
    } as never);

    beforeAll(async () => {
      await database.create();
      await db.insert(schema.users).values({
        id: userId,
        name: "Test Owner",
        email: "time-task-race@example.test",
        role: "admin",
      });
      await db.insert(schema.organizations).values({
        id: orgId,
        name: "Test Org",
        slug: orgId,
      });
      await db.insert(schema.desktopDevices).values({
        id: fixture.deviceId,
        userId,
        machineId: "task-race-machine",
      });
      await db.insert(schema.members).values({
        id: "time-task-race-member",
        userId,
        organizationId: orgId,
        role: "owner",
      });
    });

    afterAll(async () => {
      await Promise.all([writer.end(), deleter.end()]);
      await database.drop();
    });

    async function createCard() {
      const clientId = randomUUID();
      const packageId = randomUUID();
      await db.insert(schema.clients).values({
        id: clientId,
        userId,
        organizationId: orgId,
        name: "Client",
      });
      await db.insert(schema.prepaidPackages).values({
        id: packageId,
        clientId,
        userId,
        organizationId: orgId,
        name: "Card",
        totalHours: "10",
        remainingHours: "10",
        hourlyRate: "100",
        totalValue: "1000",
        purchaseDate: startTime,
      });
      return { clientId, packageId };
    }

    it("card writes allow concurrent foreign-key checks", async () => {
      const { clientId, packageId } = await createCard();
      const entryId = randomUUID();
      await db.insert(schema.timeEntries).values({
        id: entryId,
        userId,
        organizationId: orgId,
        clientId,
        date: startTime,
        hours: "1.00",
      });

      await db.transaction(async (tx) => {
        await lockPrepaidPackages(tx, [packageId]);
        await deductHoursCore(tx, userId, orgId, {
          packageId,
          clientId,
          hours: 1,
          timeEntryId: entryId,
        });
        await reversePrepaidUsage(tx, entryId, packageId);
        // PostgreSQL uses KEY SHARE when a timer selects this card.
        await deleter`SELECT id FROM prepaid_packages WHERE id = ${packageId} FOR KEY SHARE NOWAIT`;
      });
    });

    it.each(["quickStop", "desktop create"] as const)(
      "%s locks the card before locking the timer or task",
      async (operation) => {
        const { clientId, packageId } = await createCard();
        const taskId = randomUUID();
        const sessionId = randomUUID();
        const token = "quick-stop-lock-test";
        if (operation === "quickStop") {
          await db.insert(schema.extensionTokens).values({
            userId,
            name: "Test token",
            tokenHash: hashToken(token),
          });
          await db.insert(schema.timerStates).values({
            userId,
            organizationId: orgId,
            clientId,
            isRunning: true,
            elapsedSeconds: 3600,
            currentSessionId: sessionId,
            prepaidChoice: "package",
            prepaidPackageId: packageId,
            prepaidChoiceClientId: clientId,
          });
        } else {
          await db.insert(schema.tasks).values({
            id: taskId,
            userId,
            organizationId: orgId,
            title: "Task",
          });
        }
        const [backend] = await writer<{ pid: number }[]>`
          SELECT pg_backend_pid() AS pid
        `;
        const save = async () => {
          if (operation === "quickStop") {
            const result = await extensionRouter
              .createCaller({ db, headers: new Headers() } as never)
              .quickStop({ token, sessionId, saveEntry: true });
            expect(result.savedEntryId).toBeTruthy();
          } else {
            const response = await POST(
              new Request("http://localhost/api/desktop/sync/push", {
                method: "POST",
                body: JSON.stringify({
                  entities: [
                    {
                      type: "time_entry",
                      action: "create",
                      data: {
                        description: "Desktop",
                        date: "2026-09-30",
                        hours: 1,
                        clientId,
                        taskId,
                        prepaidPackageId: packageId,
                      },
                    },
                  ],
                }),
              }),
            );
            expect(await response.json()).toMatchObject({
              errors: [],
              accepted: [expect.objectContaining({ type: "time_entry" })],
            });
          }
        };
        const { mutation } = await deleter.begin(async (tx) => {
          await tx`SELECT id FROM prepaid_packages WHERE id = ${packageId} FOR UPDATE`;
          let settled = false;
          const mutation = Promise.allSettled([save()]).finally(() => {
            settled = true;
          });
          // Take the other lock once the save reaches the locked card.
          for (let attempt = 0; attempt < 500 && !settled; attempt++) {
            const [state] = await tx<{ blocked: boolean }[]>`
              SELECT pg_backend_pid() = ANY(pg_blocking_pids(${backend.pid})) AS blocked
            `;
            if (state.blocked) {
              if (operation === "quickStop") {
                await tx`SELECT id FROM timer_states WHERE user_id = ${userId} FOR UPDATE`;
              } else {
                await tx`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`;
              }
              return { mutation };
            }
            await setTimeout(10);
          }
          if (settled) {
            const [result] = await mutation;
            if (result.status === "rejected") throw result.reason;
          }
          throw new Error("The save did not reach the card lock");
        });
        const [result] = await mutation;
        if (result.status === "rejected") throw result.reason;

        const [card] = await writer<{ used_hours: string }[]>`
          SELECT used_hours FROM prepaid_packages WHERE id = ${packageId}
        `;
        expect(card.used_hours).toBe("1.00");
      },
    );

    const operations = {
      update: (id: string, taskId: string) =>
        caller.update({
          id,
          data: { taskId, date: "2026-09-30", hours: 2, description: "Work" },
        }),
      quickUpdateHours: (id: string) =>
        caller.quickUpdateHours({ id, hours: 2 }),
      delete: (id: string) => caller.delete({ id }),
      bulkDelete: (id: string) => caller.bulkDelete({ ids: [id] }),
      mergeSession: () =>
        db.transaction((tx) =>
          mergeIntoSameSessionEntry(tx, {
            userId,
            orgId,
            startTime,
            endTime,
            hours: 2,
            prepaidPackageId: null,
            incomingProjectId: null,
            incomingClientIdRaw: null,
            incomingClientId: null,
            assertEditable: async () => {},
          }),
        ),
    };

    it.each(Object.keys(operations) as (keyof typeof operations)[])(
      "%s completes while the linked task is deleted",
      async (operation) => {
        const id = randomUUID();
        const taskId = randomUUID();
        await db.insert(schema.tasks).values({
          id: taskId,
          title: "Task",
          userId,
          organizationId: orgId,
          actualMinutes: 60,
        });
        await db.insert(schema.timeEntries).values({
          id,
          taskId,
          userId,
          organizationId: orgId,
          date: new Date("2026-09-30T00:00:00Z"),
          hours: "1.00",
          startTime: operation === "mergeSession" ? startTime : null,
          endTime: new Date("2026-09-30T09:00:00Z"),
        });
        const [backend] = await writer<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;

        const results = await deleter.begin(async (tx) => {
          await tx`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`;
          const mutation = Promise.allSettled([
            operations[operation](id, taskId),
          ]);
          // Let the write reach the lock held by the task deletion before
          // issuing DELETE, whose FK action also needs the time-entry row.
          for (let attempt = 0; attempt < 500; attempt++) {
            const [state] = await tx<{ blocked: boolean }[]>`
              SELECT pg_backend_pid() = ANY(pg_blocking_pids(${backend.pid}))
                AS blocked
            `;
            if (state.blocked) {
              await tx`DELETE FROM tasks WHERE id = ${taskId}`;
              // Return without awaiting the write, so the task lock can commit.
              return { mutation };
            }
            await setTimeout(10);
          }
          throw new Error("The time entry write did not reach the task lock");
        });
        const [result] = await results.mutation;
        if (result.status === "rejected") throw result.reason;

        const [entry] = await writer<
          { task_id: string | null; hours: string }[]
        >`
          SELECT task_id, hours FROM time_entries WHERE id = ${id}
        `;
        if (operation === "delete" || operation === "bulkDelete") {
          expect(entry).toBeUndefined();
        } else {
          expect(entry).toEqual({ task_id: null, hours: "2.00" });
          await writer`DELETE FROM time_entries WHERE id = ${id}`;
        }
      },
    );
  },
);
