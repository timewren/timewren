import { TRPCError } from "@trpc/server";
import {
  deleteUserAccountCompletely,
  planAccountDeletion,
} from "@/lib/account-deletion";
import type { db as DbType } from "@/lib/db";
import { adminActivityLogs } from "@/lib/db/schema";

/**
 * Platform-admins sletning af en bruger følger samme regel som
 * selvbetjeningen (#918) — én fælles implementering: brugerens solo-orgs
 * slettes helt, i teams bevares organisationens data (tidsposter, fakturaer,
 * klippekort …) og peger på en anonymiseret bruger. Er brugeren eneste ejer
 * af et team, afvises sletningen, til ejerskabet er overdraget.
 *
 * Et butiksabonnement (App Store/Google Play) kan kun brugeren selv opsige;
 * admin-sletningen blokeres ikke af det.
 */
export async function deleteAllUserData(db: typeof DbType, userId: string) {
  const plan = await planAccountDeletion(db, userId);
  if (plan.blocked) {
    const names = plan.blocked.orgs.map((o) => o.name).join(", ");
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Brugeren er eneste ejer af et team med andre medlemmer (${names}). Ejerskabet skal overdrages til et andet medlem, før brugeren kan slettes.`,
    });
  }
  return deleteUserAccountCompletely(db, userId, {
    storeSubscriptionAcknowledged: true,
  });
}

// Helper to log admin actions
export async function logAdminAction(
  db: typeof DbType,
  adminUserId: string,
  action: string,
  targetUserId: string | null,
  details: Record<string, unknown> | null,
  headers: Headers | null,
) {
  const ipAddress =
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip") ||
    null;
  const userAgent = headers?.get("user-agent") || null;

  await db.insert(adminActivityLogs).values({
    adminUserId,
    action,
    targetUserId,
    details,
    ipAddress,
    userAgent,
  });
}
