/**
 * Fælles testverden for token-API'et (`extension.<område>.*`): én bruger
 * pr. kald af seedAccount, med egen org, abonnement og extension-token.
 * Kun til `*.dbtest.ts` — kræver DATABASE_URL til en kasseret database.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  companyProfiles,
  extensionTokens,
  memberClientAccess,
  members,
  organizations,
  rolePermissions,
  subscriptions,
  users,
} from "@/lib/db/schema";
import { hashToken } from "@/lib/security/token-hash";
import { appRouter } from "@/lib/trpc/routers";

export interface Account {
  userId: string;
  orgId: string;
  token: string;
  tokenId: string;
}

export async function seedAccount(
  plan: "free" | "solo" = "solo",
): Promise<Account> {
  const suffix = randomUUID();
  const userId = `dev-${suffix}`;
  const orgId = `dev-org-${suffix}`;
  const token = `dev-token-${suffix}`;

  await db.insert(users).values({
    id: userId,
    email: `${userId}@device.test`,
    name: "Enhed Test",
    emailVerified: true,
  } as never);
  await db.insert(organizations).values({
    id: orgId,
    name: "Enhed Org",
    slug: orgId,
  } as never);
  await db.insert(members).values({
    id: `dev-member-${suffix}`,
    organizationId: orgId,
    userId,
    role: "owner",
  } as never);
  await db.insert(subscriptions).values({
    userId,
    organizationId: orgId,
    billingCycle: "monthly",
    status: plan === "free" ? "free" : "active",
    planTier: plan,
    isTrial: false,
    trialEndsAt: new Date(Date.now() + 365 * 86_400_000),
  } as never);
  const [row] = await db
    .insert(extensionTokens)
    .values({
      userId,
      tokenHash: hashToken(token),
      name: "Test-enhed",
      isRevoked: false,
    } as never)
    .returning({ id: extensionTokens.id });

  return { userId, orgId, token, tokenId: row.id };
}

/**
 * Et medlem i `owner`'s org med eget extension-token. `clientIds`: org'en
 * begrænser kundeadgang, og medlemmet ser kun disse kunder.
 * `readOnlyModules`: medlemsrollen får kun læseadgang til modulerne.
 */
export async function seedMember(
  owner: Account,
  opts: {
    role?: "member" | "admin";
    clientIds?: string[];
    readOnlyModules?: string[];
  } = {},
): Promise<Account> {
  const suffix = randomUUID();
  const userId = `dev-mem-${suffix}`;
  const memberId = `dev-mem-row-${suffix}`;
  const token = `dev-mem-token-${suffix}`;
  await db.insert(users).values({
    id: userId,
    email: `${userId}@device.test`,
    name: "Medlem Test",
    emailVerified: true,
  } as never);
  await db.insert(members).values({
    id: memberId,
    organizationId: owner.orgId,
    userId,
    role: opts.role ?? "member",
  } as never);
  if (opts.clientIds) {
    await db
      .update(organizations)
      .set({ metadata: { restrictClientAccess: true } } as never)
      .where(eq(organizations.id, owner.orgId));
    for (const clientId of opts.clientIds) {
      await db.insert(memberClientAccess).values({
        organizationId: owner.orgId,
        memberId,
        clientId,
      } as never);
    }
  }
  for (const moduleKey of opts.readOnlyModules ?? []) {
    await db.insert(rolePermissions).values({
      organizationId: owner.orgId,
      roleName: opts.role ?? "member",
      moduleKey,
      accessLevel: "read",
    } as never);
  }
  const [row] = await db
    .insert(extensionTokens)
    .values({
      userId,
      organizationId: owner.orgId,
      tokenHash: hashToken(token),
      name: "Medlemsenhed",
      isRevoked: false,
    } as never)
    .returning({ id: extensionTokens.id });
  return { userId, orgId: owner.orgId, token, tokenId: row.id };
}

/**
 * Virksomhedsprofil (afsenderoplysninger) for kontoens org. Web's "Generér
 * faktura" kræver den før organisationens første faktura.
 */
export async function seedCompanyProfile(account: Account) {
  await db.insert(companyProfiles).values({
    userId: account.userId,
    organizationId: account.orgId,
    name: "Enhed ApS",
    email: `${account.userId}@firma.test`,
  } as never);
}

/**
 * Caller som en token-klient (desktop): ingen session, token i input. `ip`
 * giver kaldet sin egen IP, så IP-rate-limits ikke deles på tværs af tests.
 * `bearer` sender tokenet i `Authorization`-headeren.
 */
export function deviceCaller(
  client = "desktop/1.0.0",
  ip?: string,
  bearer?: string,
) {
  const headers = new Headers({ "x-timetrack-client": client });
  if (ip) headers.set("x-forwarded-for", ip);
  if (bearer) headers.set("authorization", `Bearer ${bearer}`);
  return appRouter.createCaller({ session: null, db, headers } as never);
}

/** Caller som en indlogget web-bruger (til sammenligning med web). */
export function webCaller(account: Account) {
  return appRouter.createCaller({
    session: {
      user: {
        id: account.userId,
        email: `${account.userId}@device.test`,
        name: "Enhed Test",
      },
      session: { id: `sess-${account.userId}`, userId: account.userId },
      activeOrganizationId: account.orgId,
    },
    db,
    headers: new Headers(),
  } as never);
}
