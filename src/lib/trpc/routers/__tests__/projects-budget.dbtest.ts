import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { projects, timeEntries } from "@/lib/db/schema";
import { monthBoundsCopenhagen } from "@/lib/projects/budget";
import { seedAccount, webCaller } from "../ext/__tests__/fixture";

describe.skipIf(process.env.TT_DB_TESTS !== "1")(
  "projects.listWithStats",
  () => {
    it("preserves budget label precision alongside the rounded totals", async () => {
      const account = await seedAccount();
      const owner = { userId: account.userId, organizationId: account.orgId };
      const [project] = await db
        .insert(projects)
        .values({
          ...owner,
          name: "Projekt A",
          budgetHours: "20",
          monthlyBudgetHours: "20",
        })
        .returning({ id: projects.id });
      await db.insert(timeEntries).values({
        ...owner,
        projectId: project.id,
        date: monthBoundsCopenhagen().start,
        description: "Arbejde",
        hours: "20.02",
      });

      const result = await webCaller(account).projects.listWithStats();
      expect(result.projects[0].stats).toMatchObject({
        totalHours: 20,
        estimatedBudgetHours: 20,
        projectBudget: { usedHours: 20.02, budgetHours: 20 },
        monthly: { usedHours: 20, usedHoursExact: 20.02, healthStatus: "red" },
      });
    });
  },
);
