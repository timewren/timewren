import { and, gt, isNotNull, lt } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { tokenRefreshWindow } from "@/lib/cron/refresh-window";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { forceRefreshDineroToken } from "@/lib/integrations/dinero-oauth";

// Proactively refresh OAuth tokens that expire within 10 minutes.
// Runs every 5 minutes to keep tokens fresh and avoid 401/403 errors.
// Allerede udløbne tokens prøves højst én gang i timen og aldrig efter et
// døgn — se tokenRefreshWindow.

export const GET = withCronLogging("refresh-tokens", async (_request) => {
  const { from, to } = tokenRefreshWindow(new Date());

  const expiringUsers = await db
    .select({
      id: users.id,
      dineroTokenExpiry: users.dineroTokenExpiry,
    })
    .from(users)
    .where(
      and(
        isNotNull(users.dineroRefreshToken),
        isNotNull(users.dineroTokenExpiry),
        lt(users.dineroTokenExpiry, to),
        gt(users.dineroTokenExpiry, from),
      ),
    );

  let refreshed = 0;
  let failed = 0;

  for (const user of expiringUsers) {
    try {
      // @ts-expect-error - db type mismatch between drizzle versions
      const result = await forceRefreshDineroToken(db, user.id);
      if (result) {
        refreshed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`[refresh-tokens] Failed for user ${user.id}:`, error);
      failed++;
    }
  }

  return {
    itemsProcessed: expiringUsers.length,
    itemsSucceeded: refreshed,
    itemsFailed: failed,
  };
});
