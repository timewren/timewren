/**
 * Brugerens aktive organisation — én kilde til sandheden.
 *
 * tRPC-konteksten og HTTP-ruter skal svare det samme på "hvilken org er
 * brugeren i nu", så reglerne står her ét sted: sessionens
 * `activeOrganizationId` (fra svaret eller fra sessionsrækken), men kun hvis
 * medlemskabet holder — ellers brugerens primære org (`resolvePrimaryOrgId`).
 */

import { and, asc, eq, sql } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { members, sessions } from "@/lib/db/schema";

export async function resolveActiveOrgId({
  db,
  userId,
  session,
}: {
  db: typeof dbType;
  userId: string;
  /** Better-Auth-sessionen, som den kom fra `getSession` eller tRPC-konteksten. */
  session: Record<string, unknown> | null | undefined;
}): Promise<string | null> {
  let orgId: string | null = null;

  // 1. activeOrganizationId direkte fra sessionssvaret
  if (
    typeof session?.activeOrganizationId === "string" &&
    session.activeOrganizationId.length > 0
  ) {
    orgId = session.activeOrganizationId;
  }

  // 2. Ellers fra sessionsrækken i databasen
  if (!orgId && session) {
    const inner = (session.session ?? session) as Record<string, unknown>;
    const sessionId = inner.id as string | undefined;
    if (sessionId) {
      try {
        const record = await db.query.sessions.findFirst({
          where: eq(sessions.id, sessionId),
          columns: { activeOrganizationId: true },
        });
        if (record?.activeOrganizationId) orgId = record.activeOrganizationId;
      } catch {
        // Sessionsopslag fejlede — fald tilbage nedenfor
      }
    }
  }

  // 3. Verificér at brugeren faktisk hører til den påståede org
  if (orgId) {
    const membership = await db.query.members.findFirst({
      where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
      columns: { id: true },
    });
    if (!membership) orgId = null;
  }

  // 4. Fallback: brugerens primære workspace
  if (!orgId) orgId = await resolvePrimaryOrgId({ db, userId });

  return orgId;
}

/**
 * Brugerens primære org uden for en session (cron, webhooks, indgående mail,
 * extension-login): owner-medlemskab før andre roller, derefter det ældste,
 * og org-id som sidste tie-break. Det er samme regel som
 * `pickPrimaryMembership` i desktop-sync (inkl. Better-Auths kommaseparerede
 * roller som "owner,admin"), så en bruger med flere orgs altid lander samme
 * sted. Null, hvis brugeren ikke er medlem af nogen org.
 */
export async function resolvePrimaryOrgId({
  db,
  userId,
}: {
  db: typeof dbType;
  userId: string;
}): Promise<string | null> {
  // Samme rækkefølge som `pickPrimaryMembership`: ejer i rollelisten, ældste
  // først (NULL sidst), org-id bytevis (COLLATE "C" = JS-strengsammenligning)
  const membership = await db.query.members.findFirst({
    where: eq(members.userId, userId),
    columns: { organizationId: true },
    orderBy: [
      sql`CASE WHEN ',' || replace(lower(${members.role}), ' ', '') || ',' LIKE '%,owner,%' THEN 0 ELSE 1 END`,
      asc(members.createdAt),
      sql`${members.organizationId} COLLATE "C"`,
    ],
  });
  return membership?.organizationId ?? null;
}

/**
 * En org, klienten beder om eksplicit (offline-køens afspilning, se
 * `ORG_OVERRIDE_HEADER`). Gælder kun, hvis brugeren er medlem — ellers null,
 * og kaldet skal afvises i stedet for at falde tilbage til en anden org.
 */
export async function resolveRequestedOrgId({
  db,
  userId,
  orgId,
}: {
  db: typeof dbType;
  userId: string;
  orgId: string;
}): Promise<string | null> {
  const membership = await db.query.members.findFirst({
    where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
    columns: { id: true },
  });
  return membership ? orgId : null;
}
