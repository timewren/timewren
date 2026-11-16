import { and, eq, gt, sql } from "drizzle-orm";
import type { db as DbHandle } from "@/lib/db";
import { invitations, members } from "@/lib/db/schema";

type Db = typeof DbHandle;

/**
 * Antal optagne pladser i en organisation: nuværende medlemmer + afventende
 * invitationer der STADIG er gyldige. Delt mellem
 * `organization.checkSeatAvailability` (UI), `subscription.purchaseExtraSeats`
 * (validering) og `syncSeatsToUsage` (Alunta-quantity), så alle tæller
 * pladser præcis som invite-enforcementen i auth-hooks gør.
 *
 * Udløbne invitationer beholder status "pending" i Better-Auths tabel — der
 * findes ingen oprydningsjob. Talte de med, ville kunden betale for en plads
 * ingen nogensinde får (kunde A 14/9-2026).
 */
export async function countSeatUsage(
  db: Db,
  orgId: string,
): Promise<{ members: number; pendingInvites: number; total: number }> {
  const [memberCount, pendingInvites] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(members)
      .where(eq(members.organizationId, orgId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invitations)
      .where(
        and(
          eq(invitations.organizationId, orgId),
          eq(invitations.status, "pending"),
          gt(invitations.expiresAt, new Date()),
        ),
      ),
  ]);

  const memberTotal = memberCount[0]?.count ?? 0;
  const inviteTotal = pendingInvites[0]?.count ?? 0;
  return {
    members: memberTotal,
    pendingInvites: inviteTotal,
    total: memberTotal + inviteTotal,
  };
}
