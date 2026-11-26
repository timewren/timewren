/**
 * Region på arbejdsområder ud over den personlige workspace (Greptile P1 på
 * #1275): organisationssiden (better-auth organization.create) og
 * enterprise-routeren skriver samme valuta, land og sprog som signup.
 *
 * - En engelsk TimeWren-bruger får EUR og intet land i sit andet arbejdsområde.
 * - En dansk bruger får DKK og løbenumre uden "INV-".
 * - Organisationer uden regionsfelter læses stadig som DKK og Danmark.
 *
 * Kører KUN med TT_DB_TESTS=1 (se docs/testing/timer-model-tests.md). Uden
 * NEXT_PUBLIC_BRAND er build-brandet TimeWren (selvhostet).
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationModules, organizations, users } from "@/lib/db/schema";
import { orgRegionFromMetadata } from "@/lib/org/region";
import { clearOrgRegionCache } from "@/lib/org/region.server";
import { enterpriseOrganizationRouter } from "@/lib/trpc/routers/enterprise/organization";
import { seedAccount } from "@/lib/trpc/routers/ext/__tests__/fixture";
import { computeNextInvoiceNumber } from "@/lib/trpc/routers/invoices";

const enabled = process.env.TT_DB_TESTS === "1";

async function seedUser(locale: string) {
  const acc = await seedAccount();
  await db.update(users).set({ locale }).where(eq(users.id, acc.userId));
  return acc;
}

/** Som organisationssiden: better-auths create med hooks. */
async function createViaAuth(userId: string, metadata?: object) {
  const slug = `ws-${randomUUID()}`;
  const org = await auth.api.createOrganization({
    body: { name: "Second workspace", slug, userId, metadata },
  });
  if (!org) throw new Error("organization.create gav intet");
  return org.id;
}

async function regionOf(orgId: string) {
  const row = await db.query.organizations.findFirst({
    where: eq(organizations.id, orgId),
    columns: { metadata: true },
  });
  return orgRegionFromMetadata(row?.metadata);
}

describe.skipIf(!enabled)("region på nye arbejdsområder", () => {
  it("giver en engelsk TimeWren-brugers andet arbejdsområde EUR", async () => {
    const acc = await seedUser("en");
    const orgId = await createViaAuth(acc.userId);
    expect(await regionOf(orgId)).toEqual({
      currency: "EUR",
      country: null,
      locale: "en",
    });
  });

  it("giver en dansk brugers andet arbejdsområde numre uden præfiks", async () => {
    const acc = await seedUser("da");
    const orgId = await createViaAuth(acc.userId);
    expect(await regionOf(orgId)).toEqual({
      currency: "DKK",
      country: "DK",
      locale: "da",
    });
    clearOrgRegionCache();
    const next = await db.transaction((tx) =>
      computeNextInvoiceNumber(tx, acc.userId, orgId),
    );
    expect(next).toBe("1");
  });

  it("bevarer metadata fra klienten oven på standarderne", async () => {
    const acc = await seedUser("en");
    const orgId = await createViaAuth(acc.userId, { type: "team" });
    const row = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { metadata: true },
    });
    const region = orgRegionFromMetadata(row?.metadata);
    expect(region.currency).toBe("EUR");
    expect(JSON.stringify(row?.metadata)).toContain("team");
  });

  it("giver enterprise.organization.create samme region", async () => {
    const acc = await seedUser("de");
    // Routeren ligger bag modulvagten for "enterprise".
    await db.insert(organizationModules).values({
      organizationId: acc.orgId,
      moduleKey: "enterprise",
      isAvailable: true,
      isEnabled: true,
    });
    const caller = enterpriseOrganizationRouter.createCaller({
      session: {
        user: { id: acc.userId },
        session: { id: `sess-${acc.userId}`, userId: acc.userId },
        activeOrganizationId: acc.orgId,
      },
      db,
      headers: new Headers(),
    } as never);
    const org = await caller.create({
      name: "Studio",
      slug: `studio-${randomUUID()}`,
    });
    expect(await regionOf(org.id)).toEqual({
      currency: "EUR",
      country: "DE",
      locale: "de",
    });
  });

  it("læser en organisation uden regionsfelter som før", async () => {
    const acc = await seedAccount();
    expect(await regionOf(acc.orgId)).toEqual({
      currency: "DKK",
      country: "DK",
      locale: null,
    });
  });
});
