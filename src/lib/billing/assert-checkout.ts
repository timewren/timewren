import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import { accountBrand } from "@/lib/auth/account-brand";
import {
  authBrandForHost,
  isHostAuthEnabled,
  toBrandKey,
} from "@/lib/auth/host-auth";
import type { db as DbHandle } from "@/lib/db";
import { organizations, users } from "@/lib/db/schema";
import {
  isCheckoutAvailableForBrand,
  isCheckoutAvailableForUser,
} from "./brand-billing";
import {
  isStripeBillingBrand,
  isTimewrenStripeEnabled,
} from "./timewren-stripe";

type Db = typeof DbHandle;

async function checkoutRefused(): Promise<TRPCError> {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: await tr("serverErrors", "subscription.checkoutNotForAccount"),
  });
}

/**
 * TimeWren-konti betaler med Stripe (assertStripeCheckoutAvailable), aldrig
 * i TimeTracks betaling: afvis dem i Alunta-, butiks- (App Store, Google
 * Play) og desktop-flowet (lib/billing/brand-billing.ts).
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

/**
 * Stripe-checkout og kundeportal er kun for TimeWren-konti, og kun når
 * TimeWren-betaling er slået til (lib/billing/timewren-stripe.ts). En
 * TimeTrack-konto kan aldrig ramme Stripe-flowet; den betaler via Alunta.
 */
export async function assertStripeCheckoutAvailable(db: Db, userId: string) {
  if (!isTimewrenStripeEnabled()) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: await tr("serverErrors", "subscription.stripeUnavailable"),
    });
  }
  if (!isStripeBillingBrand(await accountBrand(db, userId))) {
    throw await checkoutRefused();
  }
}

/**
 * Checkout skal også ramme en TimeWren-organisation: webhooken afviser events
 * for en organisation på et andet brand, så en betaling dér ville blive
 * gennemført uden at give planen.
 */
export async function assertStripeCheckoutOrganization(
  db: Db,
  organizationId: string,
) {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { brand: true },
  });
  if (!org || !isStripeBillingBrand(toBrandKey(org.brand))) {
    throw await checkoutRefused();
  }
}
