import { eq } from "drizzle-orm";
import { type BrandKey, DEFAULT_BRAND_KEY } from "@/lib/brands/registry";
import type { db as Db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { isHostAuthEnabled, toBrandKey } from "./host-auth";

/**
 * Kontoens brand til valg af OAuth-klienter (login-udbydere, kalender).
 * Uden host-auth-flagene (MULTIBRAND_ENABLED + TIMEWREN_APP_ENABLED) altid
 * timetrack uden databaseopslag, så alt er som før.
 */
export async function accountBrand(
  db: typeof Db,
  userId: string,
): Promise<BrandKey> {
  if (!isHostAuthEnabled()) return DEFAULT_BRAND_KEY;
  const row = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { brand: true },
  });
  return toBrandKey(row?.brand);
}
