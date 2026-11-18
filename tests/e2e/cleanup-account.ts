import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { deleteUserAccountCompletely } from "../../src/lib/account-deletion";
import * as schema from "../../src/lib/db/schema";
import { isTestAccountEmail } from "../../src/lib/test-accounts";

export async function cleanupTestAccount(sql: postgres.Sql, email: string) {
  if (!isTestAccountEmail(email)) {
    throw new Error("Refusing to clean up an unmarked test account");
  }

  try {
    const db = drizzle(sql, { schema });
    const [user] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email));
    if (user) {
      await deleteUserAccountCompletely(db, user.id, {
        storeSubscriptionAcknowledged: true,
      });
    }
  } catch {
    throw new Error("Failed to clean up the test account");
  }
}
