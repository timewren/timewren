import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { calendarConnections } from "@/lib/db/schema";
import {
  calendarWriteAccessRequiredMessage,
  hasCalendarWriteAccess,
} from "./google-calendar-scopes";

/**
 * Afvis en skrivende Google Calendar-handling på en read-only-forbindelse
 * med en forklarende dansk besked, før vi rammer en 403 fra Google.
 *
 * Er brugeren slet ikke forbundet, gør guarden intet: de eksisterende
 * "ikke forbundet"-svar i integrationen håndterer det tilfælde.
 */
export async function assertGoogleCalendarWriteAccess(
  userId: string,
): Promise<void> {
  const connection = await db.query.calendarConnections.findFirst({
    where: and(
      eq(calendarConnections.userId, userId),
      eq(calendarConnections.provider, "google"),
      isNull(calendarConnections.parentConnectionId),
    ),
    columns: { grantedScopes: true },
  });

  if (connection && !hasCalendarWriteAccess(connection.grantedScopes)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: calendarWriteAccessRequiredMessage(),
    });
  }
}
