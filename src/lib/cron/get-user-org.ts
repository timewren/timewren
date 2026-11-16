import { resolvePrimaryOrgId } from "@/lib/auth/active-org";
import { db } from "@/lib/db";

/**
 * Look up the organizationId for a user from the members table.
 * Prefers the user's own workspace (owner role) over recently-joined
 * team orgs so that cron jobs operate on the correct data scope.
 * Returns null if the user isn't part of any organization.
 */
export async function getUserOrgId(userId: string): Promise<string | null> {
  return resolvePrimaryOrgId({ db, userId });
}
