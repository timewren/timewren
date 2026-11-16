import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import type { db as dbType } from "@/lib/db";
import { orgDpaAcceptances, users } from "@/lib/db/schema";
import { logOrgAudit } from "@/lib/org-audit";
import { getClientIp } from "@/lib/utils/rate-limiter";
import { DPA_VERSION } from "./content";

/**
 * Elektronisk accept af databehandleraftalen pr. organisation og version.
 * Delt mellem Enterprise-indstillingerne og accept for alle planer
 * (Indstillinger > GDPR & Databeskyttelse), så begge veje skriver samme række og samme
 * hændelseslog. Append-only: én række pr. (org, version).
 */

type Db = typeof dbType;
export type DpaAcceptanceRow = typeof orgDpaAcceptances.$inferSelect;

/**
 * IP til acceptrækken. Sidste værdi i X-Forwarded-For (sat af vores egen
 * proxy), ikke den første, som klienten selv kan skrive (samme regel som
 * rate-limiteren).
 */
export function clientIpFromHeaders(headers: Headers | null): string | null {
  if (!headers) return null;
  const ip = getClientIp(headers);
  return ip === "unknown" ? null : ip.slice(0, 64);
}

export async function listDpaAcceptances(
  db: Db,
  orgId: string,
): Promise<DpaAcceptanceRow[]> {
  return db.query.orgDpaAcceptances.findMany({
    where: eq(orgDpaAcceptances.organizationId, orgId),
    orderBy: [desc(orgDpaAcceptances.acceptedAt)],
  });
}

/** Accepten af netop den gældende version, eller null. */
export async function currentDpaAcceptance(
  db: Db,
  orgId: string,
): Promise<DpaAcceptanceRow | null> {
  const row = await db.query.orgDpaAcceptances.findFirst({
    where: and(
      eq(orgDpaAcceptances.organizationId, orgId),
      eq(orgDpaAcceptances.version, DPA_VERSION),
    ),
  });
  return row ?? null;
}

export async function acceptDpaForOrg(
  db: Db,
  params: {
    orgId: string;
    userId: string;
    sessionEmail: string;
    sessionName?: string | null;
    version: string;
    headers: Headers | null;
  },
): Promise<DpaAcceptanceRow> {
  const { orgId, userId } = params;
  if (params.version !== DPA_VERSION) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.dpa.outdated"),
    });
  }
  const me = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true, name: true },
  });
  const existing = await currentDpaAcceptance(db, orgId);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(orgDpaAcceptances)
      .values({
        organizationId: orgId,
        version: DPA_VERSION,
        acceptedBy: userId,
        acceptedByEmail: me?.email ?? params.sessionEmail,
        acceptedByName: me?.name ?? params.sessionName ?? null,
        ipAddress: clientIpFromHeaders(params.headers),
        userAgent: params.headers?.get("user-agent")?.slice(0, 512) ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      await logOrgAudit(tx, orgId, userId, "dpa_accepted", {
        metadata: { version: DPA_VERSION, ipAddress: row.ipAddress },
      });
      return row;
    }
    const raced = await tx.query.orgDpaAcceptances.findFirst({
      where: and(
        eq(orgDpaAcceptances.organizationId, orgId),
        eq(orgDpaAcceptances.version, DPA_VERSION),
      ),
    });
    if (!raced) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: await tr("serverErrors", "enterprise.dpa.acceptFailed"),
      });
    }
    return raced;
  });
}
