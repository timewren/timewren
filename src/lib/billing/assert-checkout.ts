import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import {
  authBrandForHost,
  isHostAuthEnabled,
  toBrandKey,
} from "@/lib/auth/host-auth";
import type { db as DbHandle } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  isCheckoutAvailableForBrand,
  isCheckoutAvailableForUser,
} from "./brand-billing";

type Db = typeof DbHandle;

async function checkoutRefused(): Promise<TRPCError> {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: await tr("serverErrors", "subscription.checkoutComingSoon"),
  });
}

/**
 * TimeWren-konti kan ikke betale endnu (lib/billing/brand-billing.ts): afvis
 * checkout, så de aldrig ender i TimeTracks betaling (Alunta, App Store,
 * Google Play, Stripe).
 */
export async function assertCheckoutAvailable(db: Db, userId: string) {
  if (await isCheckoutAvailableForUser(db, userId)) return;
  throw await checkoutRefused();
}

/**
 * Som assertCheckoutAvailable for køb uden session (fx desktop-licensen):
 * afvis på en TimeWren-host og for en adresse, der tilhører en TimeWren-konto.
 * Uden host-auth-flagene intet opslag og ingen afvisning.
 */
export async function assertCheckoutAvailableForBuyer(
  db: Db,
  buyer: { host: string | null | undefined; email: string },
) {
  if (!isCheckoutAvailableForBrand(authBrandForHost(buyer.host))) {
    throw await checkoutRefused();
  }
  if (!isHostAuthEnabled()) return;
  const row = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${buyer.email.trim().toLowerCase()}`,
    columns: { brand: true },
  });
  if (row && !isCheckoutAvailableForBrand(toBrandKey(row.brand))) {
    throw await checkoutRefused();
  }
}
