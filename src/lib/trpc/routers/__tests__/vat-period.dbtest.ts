/**
 * Momsperioden læses samme sted, som `user.updateCompanyInfo` skriver den:
 * org'ens virksomhedsprofil, når den findes, ellers brugerens række. Gælder
 * momsoverblikket, indstillingssiden (`user.getProfile`), fristerne og
 * `extension.user.settings`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { companyProfiles, users } from "@/lib/db/schema";
import {
  type Account,
  deviceCaller,
  seedAccount,
  seedCompanyProfile,
  webCaller,
} from "../ext/__tests__/fixture";

const enabled = process.env.TT_DB_TESTS === "1";

async function readers(acc: Account) {
  const web = webCaller(acc);
  const [overview, profile, settings] = await Promise.all([
    web.vat.getVatOverview(),
    web.user.getProfile(),
    deviceCaller().extension.user.settings({ token: acc.token }),
  ]);
  return {
    overview: overview.isVatExempt ? "none" : overview.periodKind,
    profile: profile?.vatPeriod,
    settings: settings.vatPeriod,
  };
}

describe.skipIf(!enabled)("momsperiode: virksomhedsprofil før bruger", () => {
  it("org med virksomhedsprofil: læser profilens periode", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    // En gammel værdi på brugeren må ikke vinde over profilens.
    await db
      .update(users)
      .set({ vatPeriod: "quarterly" } as never)
      .where(eq(users.id, acc.userId));

    const web = webCaller(acc).user;
    await web.updateCompanyInfo({ companyType: "aps", vatPeriod: "monthly" });
    const profile = await db.query.companyProfiles.findFirst({
      where: eq(companyProfiles.organizationId, acc.orgId),
    });
    expect(profile?.vatPeriod).toBe("monthly");
    expect(await readers(acc)).toEqual({
      overview: "monthly",
      profile: "monthly",
      settings: "monthly",
    });
    expect((await web.getProfile())?.companyType).toBe("aps");
    expect((await web.getUpcomingDeadlines({})).needsSetup).toBe(false);

    await web.updateCompanyInfo({ companyType: "aps", vatPeriod: "none" });
    expect(await readers(acc)).toEqual({
      overview: "none",
      profile: "none",
      settings: "none",
    });
  }, 120_000);

  it("uden virksomhedsprofil: læser brugerens periode", async () => {
    const acc = await seedAccount("solo");
    const web = webCaller(acc).user;
    await web.updateCompanyInfo({
      companyType: "sole_prop",
      vatPeriod: "semi_annual",
    });
    const user = await db.query.users.findFirst({
      where: eq(users.id, acc.userId),
    });
    expect(user?.vatPeriod).toBe("semi_annual");
    expect(await readers(acc)).toEqual({
      overview: "semi_annual",
      profile: "semi_annual",
      settings: "semi_annual",
    });
  }, 120_000);

  it("profil uden periode: falder tilbage til brugerens", async () => {
    const acc = await seedAccount("solo");
    await db
      .update(users)
      .set({ vatPeriod: "monthly" } as never)
      .where(eq(users.id, acc.userId));
    await seedCompanyProfile(acc);
    expect(await readers(acc)).toEqual({
      overview: "monthly",
      profile: "monthly",
      settings: "monthly",
    });
  }, 120_000);
});

async function hasPayroll(acc: Account) {
  const { deadlines } = await webCaller(acc).user.getUpcomingDeadlines({
    lookAheadDays: 90,
  });
  return deadlines.some((d) => d.category === "payroll");
}

describe.skipIf(!enabled)("ansatte: virksomhedsprofil før bruger", () => {
  it("ny profil arver brugerens valg, og en gemt false respekteres", async () => {
    const acc = await seedAccount("solo");
    const web = webCaller(acc);
    // Uden profil gemmes valget på brugeren.
    await web.user.updateCompanyInfo({
      companyType: "sole_prop",
      vatPeriod: "quarterly",
      fiscalYearEnd: "06-30",
      hasEmployees: true,
    });
    expect(await hasPayroll(acc)).toBe(true);

    await web.onboarding.updateCompanyProfile({
      name: "Ansatte ApS",
      email: `${acc.userId}@firma.test`,
    });
    const profile = await db.query.companyProfiles.findFirst({
      where: eq(companyProfiles.organizationId, acc.orgId),
    });
    expect(profile).toMatchObject({
      companyType: "sole_prop",
      vatPeriod: "quarterly",
      fiscalYearEnd: "06-30",
      hasEmployees: true,
    });
    expect(await hasPayroll(acc)).toBe(true);

    await web.user.updateCompanyInfo({
      companyType: "sole_prop",
      vatPeriod: "quarterly",
      hasEmployees: false,
    });
    expect(await hasPayroll(acc)).toBe(false);
    expect((await web.user.getProfile())?.hasEmployees).toBe(false);
  }, 120_000);

  it("profil uden gemt værdi: falder tilbage til brugerens", async () => {
    const acc = await seedAccount("solo");
    await db
      .update(users)
      .set({ companyType: "sole_prop", hasEmployees: true } as never)
      .where(eq(users.id, acc.userId));
    await seedCompanyProfile(acc);
    const profile = await db.query.companyProfiles.findFirst({
      where: eq(companyProfiles.organizationId, acc.orgId),
    });
    // Ingen DB-default længere: NULL betyder "aldrig gemt på profilen".
    expect(profile?.hasEmployees).toBeNull();
    expect(await hasPayroll(acc)).toBe(true);
  }, 120_000);

  it("migration 0162 rydder kun default-false, der skjuler brugerens true", async () => {
    const hidden = await seedAccount("solo");
    const savedFalse = await seedAccount("solo");
    for (const acc of [hidden, savedFalse]) {
      await seedCompanyProfile(acc);
      await db
        .update(companyProfiles)
        .set({ companyType: "aps", hasEmployees: false })
        .where(eq(companyProfiles.organizationId, acc.orgId));
    }
    await db
      .update(users)
      .set({ hasEmployees: true } as never)
      .where(eq(users.id, hidden.userId));
    expect(await hasPayroll(hidden)).toBe(false);

    const migration = readFileSync(
      join(
        process.cwd(),
        "drizzle/0162_company_profiles_has_employees_nullable.sql",
      ),
      "utf8",
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      await db.execute(sql.raw(statement));
    }

    const after = async (acc: Account) =>
      (
        await db.query.companyProfiles.findFirst({
          where: eq(companyProfiles.organizationId, acc.orgId),
        })
      )?.hasEmployees;
    expect(await after(hidden)).toBeNull();
    expect(await hasPayroll(hidden)).toBe(true);
    // Brugeren har heller ikke ansatte: profilens false bliver stående.
    expect(await after(savedFalse)).toBe(false);
    expect(await hasPayroll(savedFalse)).toBe(false);
  }, 120_000);
});
