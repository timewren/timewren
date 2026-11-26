import { and, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/lib/db/schema";
import { prepaidPackages } from "@/lib/db/schema";
import { pickAutoDeductPackage } from "./auto-select";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Kortet automatisk træk skal ramme for kunden — samme liste som
 * `prepaid.getActiveForClient` (brugerens org/scope, kundens aktive kort,
 * nyeste først) og samme udløber-først-regel som web og extension
 * (`pickAutoDeductPackage`, #422). null = intet kort at trække fra.
 *
 * Bruges hvor serveren selv skal afgøre kortet: et timer-stop uden
 * eksplicit valg (extension.quickStop).
 */
export async function findAutoDeductPackageForClient(
  db: Pick<Db, "select">,
  params: {
    userId: string;
    orgId: string | null;
    clientId: string;
    now?: Date;
  },
): Promise<{ id: string } | null> {
  const scopeFilter = params.orgId
    ? eq(prepaidPackages.organizationId, params.orgId)
    : eq(prepaidPackages.userId, params.userId);

  const packages = await db
    .select({
      id: prepaidPackages.id,
      autoDeduct: prepaidPackages.autoDeduct,
      remainingHours: prepaidPackages.remainingHours,
      // Et tomt kort med overtræk tilladt kan stadig auto-vælges (#1319)
      overdraftPolicy: prepaidPackages.overdraftPolicy,
      expiryDate: prepaidPackages.expiryDate,
      isActive: prepaidPackages.isActive,
    })
    .from(prepaidPackages)
    .where(
      and(
        scopeFilter,
        eq(prepaidPackages.clientId, params.clientId),
        eq(prepaidPackages.isActive, true),
      ),
    )
    .orderBy(desc(prepaidPackages.purchaseDate));

  const picked = pickAutoDeductPackage(packages, params.now);
  return picked ? { id: picked.id } : null;
}
