import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import {
  type DemoCurrency,
  demoCurrencyForEmail,
  isDemoMode,
  registerDemoCurrencyResolver,
} from "./demo-mode";

const currencyStore = new AsyncLocalStorage<DemoCurrency>();
registerDemoCurrencyResolver(() => currencyStore.getStore());

/** Kør `fn` med en given valuta (organisationens, uden for demoen). */
export function runWithCurrency<T>(currency: DemoCurrency, fn: () => T): T {
  return currencyStore.run(currency, fn);
}

export function runWithDemoCurrency<T>(
  email: string | null | undefined,
  fn: () => T,
): T {
  return currencyStore.run(demoCurrencyForEmail(email), fn);
}

/**
 * Shared links and cron jobs have an account owner but no session. The demo
 * picks the owner's demo currency; otherwise the organisation's (fund 19),
 * and DKK touches nothing, as before.
 */
export async function runWithOwnerCurrency<T>(
  owner: { userId: string; organizationId: string | null | undefined },
  fn: () => T,
): Promise<Awaited<T>> {
  if (!isDemoMode()) {
    if (!owner.organizationId) return await fn();
    const [{ db }, { getOrgRegion }] = await Promise.all([
      import("@/lib/db"),
      import("@/lib/org/region.server"),
    ]);
    const { currency } = await getOrgRegion(db, owner.organizationId);
    return currency === "DKK"
      ? await fn()
      : await runWithCurrency(currency, fn);
  }

  const [{ db }, { users }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/db/schema"),
  ]);
  const user = await db.query.users.findFirst({
    where: eq(users.id, owner.userId),
    columns: { email: true },
  });
  return await runWithDemoCurrency(user?.email, fn);
}
