import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it } from "vitest";
import { withTimewrenCheckoutLock } from "@/lib/billing/timewren-checkout";
import * as schema from "@/lib/db/schema";
import { testPostgres } from "@/test/test-db";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "TimeWren checkout lock",
  () => {
    it("rejects 19 contenders while the checkout and ordinary queries can still run", async () => {
      const orgId = randomUUID();
      const scratch = `tw_checkout_${orgId.replaceAll("-", "")}`;
      const client = testPostgres({
        max: 2,
        connection: { search_path: scratch, statement_timeout: 1000 },
      });
      const db = drizzle(client, { schema });
      await client.unsafe(`CREATE SCHEMA ${scratch}`);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const checkout = withTimewrenCheckoutLock(db, orgId, async () => {
        entered.resolve();
        await release.promise;
        return "checkout";
      });
      const contender = async () => {
        throw new Error("Contender acquired the checkout lock");
      };
      try {
        await entered.promise;
        const requests = Array.from({ length: 19 }, () =>
          expect(
            withTimewrenCheckoutLock(db, orgId, contender),
          ).rejects.toMatchObject({
            code: "CONFLICT",
          }),
        );
        await Promise.all([
          ...requests,
          expect(db.execute(sql`select 1 as ok`)).resolves.toEqual([{ ok: 1 }]),
        ]);
        release.resolve();
        await checkout;
        await db.execute(sql`create table checkout_customer (id text)`);
        await expect(
          withTimewrenCheckoutLock(db, orgId, async (tx) => {
            await tx.execute(
              sql`insert into checkout_customer values ('cus_tw_test')`,
            );
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
          }),
        ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
        await expect(
          db.execute(sql`select id from checkout_customer`),
        ).resolves.toEqual([{ id: "cus_tw_test" }]);
      } finally {
        release.resolve();
        try {
          await checkout;
          await client.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
        } finally {
          await client.end();
        }
      }
    }, 5_000);
  },
);
