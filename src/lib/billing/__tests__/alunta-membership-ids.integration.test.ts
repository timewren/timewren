import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { excludeTestSubscription } from "@/lib/test-accounts";
import {
  connectTestDb,
  isolatedTestDatabase,
  testPostgres,
} from "@/test/test-db";

vi.mock("@/lib/alunta", () => ({ alunta: { subscriptions: {} } }));

const { collectAluntaMembershipIds } = await import("../alunta-membership-ids");

// The legacy rule must look at the workspaces a user owns, not every
// workspace they are a member of.
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "collectAluntaMembershipIds legacy user-keyed memberships",
  () => {
    const database = isolatedTestDatabase();
    const sql = testPostgres({ max: 1, database: database.name });
    const db = drizzle(sql, { schema });

    beforeAll(async () => {
      await database.create();
      await connectTestDb(sql);
      const ids = ["member-elsewhere", "owner-elsewhere"];
      await db
        .insert(schema.users)
        .values(ids.map((id) => ({ id, name: id, email: `${id}@company.dk` })));
      await db.insert(schema.organizations).values([
        { id: "real-org", name: "Real", slug: "real-org" },
        ...ids.map((id) => ({
          id: `test-${id}`,
          name: id,
          slug: `test-${id}`,
          isTestAccount: true,
        })),
      ]);
      await db.insert(schema.members).values([
        ...ids.map((id) => ({
          id: `owns-${id}`,
          role: "owner",
          userId: id,
          organizationId: `test-${id}`,
        })),
        {
          id: "plain-member",
          role: "member",
          userId: "member-elsewhere",
          organizationId: "real-org",
        },
        {
          id: "real-owner",
          role: "owner",
          userId: "owner-elsewhere",
          organizationId: "real-org",
        },
      ]);
      await db.insert(schema.subscriptions).values(
        ids.map((id) => ({
          userId: id,
          organizationId: `test-${id}`,
          billingCycle: "monthly",
          aluntaSubscriptionId: `sub-${id}`,
          status: "active",
          isTrial: false,
          trialEndsAt: new Date(),
        })),
      );
    });

    afterAll(async () => {
      await sql.end();
      await database.drop();
    });

    it("excludes a legacy membership only when the user owns nothing but test workspaces", async () => {
      const ids = await collectAluntaMembershipIds(
        db,
        drizzleSql<boolean>`not (${excludeTestSubscription()})`,
        [
          { uuid: "legacy-member", external_customer_id: "member-elsewhere" },
          { uuid: "legacy-owner", external_customer_id: "owner-elsewhere" },
        ] as never,
      );
      expect([...ids].sort()).toEqual([
        "legacy-member",
        "sub-member-elsewhere",
        "sub-owner-elsewhere",
      ]);
    });
  },
);
