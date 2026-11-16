import { and, desc, eq, sql } from "drizzle-orm";
import type { db as Database } from "@/lib/db";
import {
  accounts,
  employeeProfiles,
  members,
  organizations,
  orgVerifiedDomains,
  sessions,
  users,
} from "@/lib/db/schema";
import { calculateConversionFactor } from "@/lib/enterprise/vacation";
import { logOrgAudit } from "@/lib/org-audit";
import { resolveOrgMaxSeats } from "@/lib/org-seats";
import { readStoredIdToken } from "@/lib/security/oauth-token-crypto";
import { copenhagenToday } from "@/lib/time/copenhagen";
import {
  type AutoJoinDenyReason,
  decideAutoJoin,
  decodeIdTokenClaims,
  emailDomain,
  isFreeEmailDomain,
} from "./domains";

type Db = typeof Database;

export const MICROSOFT_PROVIDER_ID = "microsoft-entra-id";

export interface VerifiedOrgMatch {
  organizationId: string;
  domain: string;
  ssoTenantId: string | null;
  autoJoinDefaultRole: string;
  requireSsoForDomains: boolean;
}

/**
 * Find den org der har verificeret e-mailens domæne. Gratis-domæner
 * afvises før opslag. Én række max (partial unique index på verified).
 * Med `brand` (multibrand) tæller kun organisationer på kontoens brand: en
 * TimeWren-konto joines aldrig ind i en TimeTrack-organisation og omvendt.
 */
export async function findVerifiedOrgForEmail(
  db: Db,
  email: string | null | undefined,
  brand?: string,
): Promise<VerifiedOrgMatch | null> {
  const domain = emailDomain(email);
  if (!domain || isFreeEmailDomain(domain)) return null;
  const rows = await db
    .select({
      organizationId: orgVerifiedDomains.organizationId,
      domain: orgVerifiedDomains.domain,
      ssoTenantId: organizations.ssoTenantId,
      autoJoinDefaultRole: organizations.autoJoinDefaultRole,
      requireSsoForDomains: organizations.requireSsoForDomains,
    })
    .from(orgVerifiedDomains)
    .innerJoin(
      organizations,
      eq(organizations.id, orgVerifiedDomains.organizationId),
    )
    .where(
      and(
        eq(orgVerifiedDomains.domain, domain),
        eq(orgVerifiedDomains.status, "verified"),
        brand ? eq(organizations.brand, brand) : undefined,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type AutoJoinResult =
  | { joined: true; organizationId: string; role: "member" | "manager" }
  | { joined: false; reason: AutoJoinDenyReason | "no_seats" | "no_user" };

/**
 * Auto-join en bruger i den org der ejer brugerens e-mail-domæne.
 * Idempotent: eksisterende medlemskab → uændret. Kaldes ved hvert login
 * (session.create) — koster ét opslag når domænet ikke er verificeret.
 */
export async function autoJoinUserToVerifiedOrg(
  db: Db,
  userId: string,
): Promise<AutoJoinResult> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      email: true,
      emailVerified: true,
      name: true,
      brand: true,
    },
  });
  if (!user?.email) return { joined: false, reason: "no_user" };

  const match = await findVerifiedOrgForEmail(db, user.email, user.brand);
  if (!match) {
    const domain = emailDomain(user.email);
    return {
      joined: false,
      reason:
        domain && isFreeEmailDomain(domain)
          ? "free_domain"
          : domain
            ? "no_verified_domain"
            : "no_email",
    };
  }

  const [memberships, msAccount] = await Promise.all([
    db.query.members.findMany({
      where: eq(members.userId, userId),
      columns: { organizationId: true },
    }),
    db.query.accounts.findFirst({
      where: and(
        eq(accounts.userId, userId),
        eq(accounts.providerId, MICROSOFT_PROVIDER_ID),
      ),
      orderBy: [desc(accounts.updatedAt)],
      columns: { idToken: true },
    }),
  ]);

  const decision = decideAutoJoin({
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    microsoftClaims: msAccount
      ? decodeIdTokenClaims(readStoredIdToken(msAccount.idToken))
      : null,
    match: {
      organizationId: match.organizationId,
      ssoTenantId: match.ssoTenantId,
      autoJoinDefaultRole: match.autoJoinDefaultRole,
    },
    existingMembershipOrgIds: memberships.map((m) => m.organizationId),
  });
  if (!decision.join) return { joined: false, reason: decision.reason };

  const orgId = decision.organizationId;
  const maxSeats = await resolveOrgMaxSeats(orgId);
  const hasOtherOrg = memberships.length > 0;

  const outcome = await db.transaction(async (tx) => {
    // Lås org-rækken så to samtidige logins ikke begge passerer seat-tjekket
    // (TOCTOU). Tællingen sker efter låsen inde i samme transaktion.
    const [org] = await tx
      .select({ defaultWeeklyHours: organizations.defaultWeeklyHours })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for("update");
    const [{ count: memberCount }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(members)
      .where(eq(members.organizationId, orgId));
    if (memberCount >= maxSeats) {
      console.warn(
        `[auto-join] Org ${orgId} har ingen ledige pladser (${memberCount}/${maxSeats}) — ${user.email} ikke tilføjet`,
      );
      return "no_seats" as const;
    }
    const weeklyHours = org?.defaultWeeklyHours ?? "37.0";

    // members.role er owner/admin/member — manager udtrykkes på profilen
    await tx
      .insert(members)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId,
        role: "member",
      })
      .onConflictDoNothing();
    await tx
      .insert(employeeProfiles)
      .values({
        userId,
        organizationId: orgId,
        role: decision.role,
        employmentType: "full_time",
        weeklyHours,
        conversionFactor: calculateConversionFactor(
          Number(weeklyHours),
          Number(weeklyHours),
        ).toFixed(3),
        workingDays: ["1", "2", "3", "4", "5"],
        // Dansk dato — CURRENT_DATE følger sessionens TZ (UTC), #649
        startDate: copenhagenToday(),
        departmentId: null,
      })
      .onConflictDoNothing();
    await tx
      .update(users)
      .set({ onboardingCompleted: true })
      .where(eq(users.id, userId));
    // Skift kun aktiv org for brugere uden andre orgs — en eksisterende
    // freelancer/konsulent skal ikke rives ud af sin workspace ved login.
    if (!hasOtherOrg) {
      await tx
        .update(sessions)
        .set({ activeOrganizationId: orgId })
        .where(eq(sessions.userId, userId));
    }
    await logOrgAudit(tx, orgId, userId, "member_auto_joined", {
      targetUserId: userId,
      targetEmail: user.email,
      metadata: {
        domain: match.domain,
        via: decision.via,
        role: decision.role,
        tenantRequired: Boolean(match.ssoTenantId),
        activeOrgSwitched: !hasOtherOrg,
      },
    });
    return "joined" as const;
  });

  if (outcome === "no_seats") return { joined: false, reason: "no_seats" };
  return { joined: true, organizationId: orgId, role: decision.role };
}
