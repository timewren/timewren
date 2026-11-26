/**
 * "Jeg er momsregistreret" slås til, når en dansk virksomhed får et CVR
 * (Mads 22/11-26), medmindre brugeren selv har valgt. Reglen ligger i
 * `src/lib/invoices/vat-default.ts` og gælder web (onboarding og
 * indstillinger) og device-API'et (`extension.company.update`), når kaldet
 * udelader `vatRegistered`.
 */

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { companyProfiles } from "@/lib/db/schema";
import {
  deviceCaller,
  seedAccount,
  seedCompanyProfile,
  webCaller,
} from "./fixture";

const enabled = process.env.TT_DB_TESTS === "1";

const firma = { name: "Moms ApS", email: "firma@moms.test" };

async function stored(orgId: string) {
  const row = await db.query.companyProfiles.findFirst({
    where: eq(companyProfiles.organizationId, orgId),
  });
  return row?.vatRegistered;
}

describe.skipIf(!enabled)("momsregistreret som standard ved CVR", () => {
  it("CVR indtastet i onboarding: slået til", async () => {
    const acc = await seedAccount("solo");
    const saved = await webCaller(acc).onboarding.saveCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
    });
    expect(saved.vatRegistered).toBe(true);
    expect(await stored(acc.orgId)).toBe(true);
  });

  it("CVR tilføjet til en profil uden CVR (indstillinger): slået til", async () => {
    const acc = await seedAccount("solo");
    await seedCompanyProfile(acc);
    expect(await stored(acc.orgId)).toBe(false);
    await webCaller(acc).onboarding.updateCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
    });
    expect(await stored(acc.orgId)).toBe(true);
  });

  it("brugerens fravalg står, også med CVR", async () => {
    const acc = await seedAccount("solo");
    await webCaller(acc).onboarding.saveCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
      vatRegistered: false,
    });
    expect(await stored(acc.orgId)).toBe(false);
    // Et senere kald uden valg rører ikke den gemte værdi.
    await deviceCaller().extension.company.update({
      token: acc.token,
      data: { ...firma, cvrNumber: "12345678", phone: "12 34 56 78" },
    });
    expect(await stored(acc.orgId)).toBe(false);
  });

  it("uden CVR: slået fra", async () => {
    const acc = await seedAccount("solo");
    const saved = await webCaller(acc).onboarding.saveCompanyProfile(firma);
    expect(saved.vatRegistered).toBe(false);
    await deviceCaller().extension.company.update({
      token: acc.token,
      data: { ...firma, phone: "12 34 56 78" },
    });
    expect(await stored(acc.orgId)).toBe(false);
  });

  it("udenlandsk virksomhed med 8 cifre: slået fra", async () => {
    const acc = await seedAccount("solo");
    await webCaller(acc).onboarding.updateCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
      country: "Sverige",
    });
    expect(await stored(acc.orgId)).toBe(false);
  });

  it("et kald uden valg gemmes ikke som valg", async () => {
    const acc = await seedAccount("solo");
    const saved = await webCaller(acc).onboarding.saveCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
    });
    expect(saved.vatRegisteredChosen).toBe(false);
  });

  // Greptile P1 1: autogemte mellemtrin må ikke vende et gemt fravalg.
  it("fravalg står gennem et autogemt halvt CVR", async () => {
    const acc = await seedAccount("solo");
    const web = webCaller(acc).onboarding;
    await web.updateCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
      vatRegistered: false,
    });
    await web.updateCompanyProfile({ ...firma, cvrNumber: "1234567" });
    const after = await web.updateCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
    });
    expect(after.vatRegistered).toBe(false);
    expect(after.vatRegisteredChosen).toBe(true);
  });

  // Greptile P1 2: landet tilbage til dansk slår reglen til igen.
  it("uden valg følger fluebenet landet, også tilbage til Danmark", async () => {
    const acc = await seedAccount("solo");
    const web = webCaller(acc).onboarding;
    await web.updateCompanyProfile({ ...firma, cvrNumber: "12345678" });
    expect(await stored(acc.orgId)).toBe(true);
    await web.updateCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
      country: "Den",
    });
    expect(await stored(acc.orgId)).toBe(false);
    await web.updateCompanyProfile({
      ...firma,
      cvrNumber: "12345678",
      country: "Denmark",
    });
    expect(await stored(acc.orgId)).toBe(true);
  });

  it("et kald uden CVR bruger det gemte CVR", async () => {
    const acc = await seedAccount("solo");
    await deviceCaller().extension.company.update({
      token: acc.token,
      data: { ...firma, cvrNumber: "12345678" },
    });
    await deviceCaller().extension.company.update({
      token: acc.token,
      data: { ...firma, phone: "12 34 56 78" },
    });
    expect(await stored(acc.orgId)).toBe(true);
  });

  it("device-API'et følger samme regel", async () => {
    const acc = await seedAccount("solo");
    await deviceCaller().extension.company.update({
      token: acc.token,
      data: { ...firma, cvrNumber: "12345678" },
    });
    const company = await deviceCaller().extension.company.get({
      token: acc.token,
    });
    expect(company.companyProfile?.vatRegistered).toBe(true);
  });
});
