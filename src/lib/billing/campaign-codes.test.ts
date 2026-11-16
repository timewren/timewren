import { describe, expect, it } from "vitest";
import {
  type CampaignCode,
  campaignDiscountEndForPayment,
  campaignDiscountExpiresAt,
  describeCampaign,
  normalizeCampaignCode,
  resolveCampaignCode,
} from "./campaign-codes";

const CODES: CampaignCode[] = [
  {
    code: "TEST-60",
    label: "Test",
    trialDays: 60,
    discountPercent: 25,
    discountMonths: 12,
    redeemUntil: "2026-12-31",
  },
];

describe("normalizeCampaignCode", () => {
  it("trimmer og gør koden versal", () => {
    expect(normalizeCampaignCode("  test-60 ")).toBe("TEST-60");
  });

  it("afviser tomme og ugyldige koder", () => {
    expect(normalizeCampaignCode("")).toBeNull();
    expect(normalizeCampaignCode(null)).toBeNull();
    expect(normalizeCampaignCode("ab")).toBeNull();
    expect(normalizeCampaignCode("kode med mellemrum")).toBeNull();
  });
});

describe("resolveCampaignCode", () => {
  it("finder en gyldig kode uanset versaler", () => {
    const c = resolveCampaignCode(
      "test-60",
      new Date("2026-10-01T10:00:00Z"),
      CODES,
    );
    expect(c?.trialDays).toBe(60);
  });

  it("returnerer null for ukendte koder", () => {
    expect(
      resolveCampaignCode("UKENDT", new Date("2026-10-01"), CODES),
    ).toBeNull();
  });

  it("gælder hele sidste dag i dansk tid og ikke dagen efter", () => {
    // 31/12 kl. 23:30 dansk tid = 22:30 UTC
    expect(
      resolveCampaignCode("TEST-60", new Date("2026-12-31T22:30:00Z"), CODES),
    ).not.toBeNull();
    // 1/1 kl. 00:30 dansk tid = 23:30 UTC 31/12
    expect(
      resolveCampaignCode("TEST-60", new Date("2026-12-31T23:30:00Z"), CODES),
    ).toBeNull();
  });
});

describe("campaignDiscountExpiresAt", () => {
  it("lægger rabatmånederne oven i prøveperiodens slut", () => {
    const expires = campaignDiscountExpiresAt(
      CODES[0],
      new Date("2026-12-01T12:00:00Z"),
    );
    expect(expires?.toISOString().slice(0, 10)).toBe("2027-12-01");
  });

  it("giver null uden rabat", () => {
    expect(
      campaignDiscountExpiresAt(
        { ...CODES[0], discountPercent: 0 },
        new Date(),
      ),
    ).toBeNull();
  });
});

describe("describeCampaign", () => {
  it("beskriver prøve og rabat på dansk", () => {
    expect(describeCampaign(CODES[0])).toBe(
      "60 dages gratis prøve + 25 % rabat i 12 måneder",
    );
  });
});

describe("campaignDiscountEndForPayment", () => {
  it("giver fulde rabatmåneder fra en sen betaling", () => {
    const end = campaignDiscountEndForPayment(
      CODES[0],
      new Date("2027-04-10T12:00:00Z"),
      new Date("2027-12-01T12:00:00Z"),
    );
    expect(end.toISOString().slice(0, 10)).toBe("2028-04-10");
  });

  it("forkorter aldrig den lovede slutdato ved betaling midt i prøven", () => {
    const end = campaignDiscountEndForPayment(
      CODES[0],
      new Date("2026-10-15T12:00:00Z"),
      new Date("2027-12-01T12:00:00Z"),
    );
    expect(end.toISOString().slice(0, 10)).toBe("2027-12-01");
  });
});
