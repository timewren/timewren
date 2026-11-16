/**
 * Fælles testverden for token-API'et (`extension.<område>.*`): én bruger
 * pr. kald af seedAccount, med egen org, abonnement og extension-token.
 * Kun til `*.dbtest.ts` — kræver DATABASE_URL til en kasseret database.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  extensionTokens,
  members,
  organizations,
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
