import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  clients,
  orgPeriodLocks,
  prepaidPackages,
  prepaidUsage,
  projects,
  timeEntries,
} from "@/lib/db/schema";
import { seedAccount, webCaller } from "../ext/__tests__/fixture";

describe.skipIf(process.env.TT_DB_TESTS !== "1")(
  "time.bulkRemoveFromProject",
  () => {
    it.each([
      "same-client",
      "different-client",
      "internal-project",
      "billed",
      "locked",
    ] as const)(
      "reconciles an existing deduction with a mixed selection (%s)",
      async (status) => {
        const account = await seedAccount();
        const owned = { userId: account.userId, organizationId: account.orgId };
        const date = new Date();
        const [client] = await db
          .insert(clients)
          .values({
            ...owned,
            name: "Kunde A",
            defaultHourlyRate: "275",
          })
          .returning();
        const internalProject = status === "internal-project";
        const changesClient = status === "different-client";
        let cardClientId = client.id;
        if (changesClient) {
          const [otherClient] = await db
            .insert(clients)
            .values({
              ...owned,
              name: "Kunde B",
            })
            .returning({ id: clients.id });
          cardClientId = otherClient.id;
        }
        const [project] = await db
          .insert(projects)
          .values({
            ...owned,
            name: "Projekt A",
            clientId: internalProject ? null : client.id,
            hourlyRate: "900",
          })
          .returning();
        const [card] = await db
          .insert(prepaidPackages)
          .values({
            ...owned,
            clientId: cardClientId,
            name: "Kort A",
            totalHours: "10",
            remainingHours: "10",
            hourlyRate: "100",
            totalValue: "1000",
            purchaseDate: date,
          })
          .returning();
        const [entry, other] = await db
          .insert(timeEntries)
          .values(
            [false, status === "billed"].map((isBilled, index) => ({
              clientId:
                internalProject || (changesClient && index === 0)
                  ? cardClientId
                  : null,
              ...owned,
              projectId: project.id,
              date,
              hours: "1.25",
              billableRate: "900",
              isBilled,
            })),
          )
          .returning();
        const caller = webCaller(account);
        await caller.prepaid.bulkAssignEntries({
          packageId: card.id,
          timeEntryIds: [entry.id],
        });

        if (status === "locked") {
          await db.insert(orgPeriodLocks).values({
            organizationId: account.orgId,
            lockedBefore: new Date(date.getTime() + 86_400_000),
            lockedByUserId: account.userId,
          });
        }

        const ids = [entry.id, other.id];
        const canMove =
          status === "same-client" || changesClient || internalProject;
        const move = caller.time.bulkRemoveFromProject({ ids });
        if (canMove) {
          await expect(move).resolves.toMatchObject({ count: 2 });
        } else {
          await expect(move).rejects.toMatchObject({
            code: status === "locked" ? "BAD_REQUEST" : "FORBIDDEN",
          });
        }

        const saved = await db.query.timeEntries.findMany({
          where: inArray(timeEntries.id, ids),
        });
        expect(saved).toHaveLength(2);
        for (const row of saved) {
          expect(row).toMatchObject({
            projectId: canMove ? null : project.id,
            clientId: canMove ? client.id : null,
            billableRate: canMove ? "275.00" : "900.00",
          });
        }
        expect(saved.find(({ id }) => id === entry.id)).toMatchObject({
          isPrepaid: !changesClient,
          prepaidPackageId: changesClient ? null : card.id,
        });
        expect(
          await db.query.prepaidUsage.findMany({
            where: eq(prepaidUsage.timeEntryId, entry.id),
          }),
        ).toMatchObject(
          changesClient
            ? []
            : [{ prepaidPackageId: card.id, hoursUsed: "1.25" }],
        );
        expect(
          await db.query.prepaidPackages.findFirst({
            where: eq(prepaidPackages.id, card.id),
          }),
        ).toMatchObject({
          remainingHours: changesClient ? "10.00" : "8.75",
          usedHours: changesClient ? "0.00" : "1.25",
        });
      },
    );
  },
);
