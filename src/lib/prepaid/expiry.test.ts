import { describe, expect, it } from "vitest";
import {
  duplicatedPrepaidExpiry,
  formatPrepaidExpiry,
  isPrepaidExpired,
  prepaidDaysUntilExpiry,
  prepaidExpiredBefore,
  prepaidExpiresWithinBefore,
  prepaidExpiryDateStr,
  prepaidExpiryLabel,
  prepaidExpiryPhrase,
  prepaidValidUntil,
} from "./expiry";

// Køres i CI både med TZ=UTC (prod) og TZ=Europe/Copenhagen (udvikling);
// alle forventninger er absolutte og må ikke afhænge af processens TZ.

// Lagringskonventionen: UTC-midnat på udløbsdatoen.
const SUMMER = new Date("2026-08-15T00:00:00Z"); // CEST, +2
const WINTER = new Date("2026-12-15T00:00:00Z"); // CET, +1

describe("isPrepaidExpired — kortet gælder hele udløbsdagen (#736)", () => {
  it.each([
    ["sommertid 00:30 på udløbsdagen", SUMMER, "2026-08-14T22:30:00Z", false],
    ["sommertid 23:30 på udløbsdagen", SUMMER, "2026-08-15T21:30:00Z", false],
    [
      "sommertid 23:59:59 på udløbsdagen",
      SUMMER,
      "2026-08-15T21:59:59Z",
      false,
    ],
    ["sommertid 00:00 dagen efter", SUMMER, "2026-08-15T22:00:00Z", true],
    ["sommertid 00:01 dagen efter", SUMMER, "2026-08-15T22:01:00Z", true],
    ["vintertid 00:30 på udløbsdagen", WINTER, "2026-12-14T23:30:00Z", false],
    ["vintertid 23:30 på udløbsdagen", WINTER, "2026-12-15T22:30:00Z", false],
    ["vintertid 00:01 dagen efter", WINTER, "2026-12-15T23:01:00Z", true],
    ["dagen før udløb", WINTER, "2026-12-14T12:00:00Z", false],
  ])("%s", (_label, expiry, now, expired) => {
    expect(isPrepaidExpired(expiry, new Date(now))).toBe(expired);
  });

  it("håndterer skiftedagene for sommertid", () => {
    // 29/3-2026: ur stilles frem kl. 02 → dagen slutter 21:59:59Z (CEST)
    const spring = new Date("2026-03-29T00:00:00Z");
    expect(isPrepaidExpired(spring, new Date("2026-03-29T21:30:00Z"))).toBe(
      false,
    );
    expect(isPrepaidExpired(spring, new Date("2026-03-29T22:01:00Z"))).toBe(
      true,
    );
    // 25/10-2026: ur stilles tilbage kl. 03 → dagen slutter 22:59:59Z (CET)
    const autumn = new Date("2026-10-25T00:00:00Z");
    expect(isPrepaidExpired(autumn, new Date("2026-10-25T22:30:00Z"))).toBe(
      false,
    );
    expect(isPrepaidExpired(autumn, new Date("2026-10-25T23:01:00Z"))).toBe(
      true,
    );
  });

  it("tolker også ældre rækker gemt som dansk midnat på den tilsigtede dato", () => {
    // new Date(2026, 7, 15) i en proces med TZ=Europe/Copenhagen
    const legacy = new Date("2026-08-14T22:00:00Z");
    expect(prepaidExpiryDateStr(legacy)).toBe("2026-08-15");
    expect(isPrepaidExpired(legacy, new Date("2026-08-15T21:30:00Z"))).toBe(
      false,
    );
    expect(isPrepaidExpired(legacy, new Date("2026-08-15T22:01:00Z"))).toBe(
      true,
    );
  });

  it("accepterer ISO-strenge (tRPC/REST) og null", () => {
    expect(
      isPrepaidExpired(
        "2026-08-15T00:00:00.000Z",
        new Date("2026-08-15T12:00:00Z"),
      ),
    ).toBe(false);
    expect(isPrepaidExpired(null)).toBe(false);
    expect(isPrepaidExpired(undefined)).toBe(false);
    expect(prepaidValidUntil(null)).toBeNull();
  });

  it("prepaidValidUntil er dansk midnat efter udløbsdatoen", () => {
    expect(prepaidValidUntil(SUMMER)?.toISOString()).toBe(
      "2026-08-15T22:00:00.000Z",
    );
    expect(prepaidValidUntil(WINTER)?.toISOString()).toBe(
      "2026-12-15T23:00:00.000Z",
    );
  });
});

describe("prepaidExpiredBefore — SQL-grænsen svarer til isPrepaidExpired", () => {
  it("giver starten af dagens danske dato", () => {
    // 00:30 dansk sommertid den 15/8 er stadig 14/8 i UTC
    expect(
      prepaidExpiredBefore(new Date("2026-08-14T22:30:00Z")).toISOString(),
    ).toBe("2026-08-14T22:00:00.000Z");
    expect(
      prepaidExpiredBefore(new Date("2026-12-15T22:30:00Z")).toISOString(),
    ).toBe("2026-12-14T23:00:00.000Z");
  });

  it("er ækvivalent med isPrepaidExpired for UTC- og dansk-midnat-værdier", () => {
    const expiries = [
      SUMMER,
      WINTER,
      new Date("2026-08-14T22:00:00Z"),
      new Date("2026-03-29T00:00:00Z"),
      new Date("2026-10-25T00:00:00Z"),
    ];
    const start = Date.parse("2026-03-27T00:00:00Z");
    for (const expiry of expiries) {
      for (let h = 0; h < 24 * 300; h += 7) {
        const now = new Date(start + h * 3600_000 + 60_000);
        const sqlExpired =
          expiry.getTime() < prepaidExpiredBefore(now).getTime();
        expect(sqlExpired).toBe(isPrepaidExpired(expiry, now));
      }
    }
  });
});

describe("prepaidDaysUntilExpiry", () => {
  it("tæller udløbsdagen som 0 (udløber i dag) hele dagen", () => {
    expect(
      prepaidDaysUntilExpiry(SUMMER, new Date("2026-08-14T22:30:00Z")),
    ).toBe(0);
    expect(
      prepaidDaysUntilExpiry(SUMMER, new Date("2026-08-15T21:30:00Z")),
    ).toBe(0);
    expect(
      prepaidDaysUntilExpiry(WINTER, new Date("2026-12-14T23:30:00Z")),
    ).toBe(0);
  });

  it("tæller hele kalenderdage, ikke 24-timers-blokke", () => {
    // 23:30 dansk dagen før = i morgen, selvom der kun er ½ time til midnat
    expect(
      prepaidDaysUntilExpiry(SUMMER, new Date("2026-08-14T21:30:00Z")),
    ).toBe(1);
    expect(
      prepaidDaysUntilExpiry(SUMMER, new Date("2026-08-08T06:00:00Z")),
    ).toBe(7);
    // Henover sommertidsskiftet i oktober
    expect(
      prepaidDaysUntilExpiry(WINTER, new Date("2026-10-20T10:00:00Z")),
    ).toBe(56);
  });

  it("er negativ efter udløb og null uden udløb", () => {
    expect(
      prepaidDaysUntilExpiry(SUMMER, new Date("2026-08-15T22:01:00Z")),
    ).toBe(-1);
    expect(
      prepaidDaysUntilExpiry(SUMMER, new Date("2026-08-20T10:00:00Z")),
    ).toBe(-5);
    expect(prepaidDaysUntilExpiry(null)).toBeNull();
  });
});

describe("prepaidExpiresWithinBefore", () => {
  it("dækker udløbsdatoer til og med i dag + N", () => {
    const now = new Date("2026-08-08T06:00:00Z"); // 8/8 dansk
    const bound = prepaidExpiresWithinBefore(7, now);
    expect(bound.toISOString()).toBe("2026-08-15T22:00:00.000Z");
    expect(SUMMER.getTime() < bound.getTime()).toBe(true); // 15/8 = i dag + 7
    expect(new Date("2026-08-16T00:00:00Z").getTime() < bound.getTime()).toBe(
      false,
    );
  });
});

describe("prepaidExpiryPhrase", () => {
  it("formulerer udløbsdagen som 'udløber i dag'", () => {
    expect(prepaidExpiryPhrase(0)).toBe("udløber i dag");
    expect(prepaidExpiryPhrase(1)).toBe("udløber i morgen");
    expect(prepaidExpiryPhrase(5)).toBe("udløber om 5 dage");
    expect(prepaidExpiryPhrase(-1)).toBe("udløbet");
    expect(prepaidExpiryLabel(0)).toBe("Udløber i dag");
  });
});

describe("formatPrepaidExpiry", () => {
  it("viser den danske dato også for dansk-midnat-værdier i en UTC-proces", () => {
    expect(formatPrepaidExpiry(new Date("2026-08-14T22:00:00Z"))).toBe(
      "15.8.2026",
    );
    expect(formatPrepaidExpiry(SUMMER)).toBe("15.8.2026");
    expect(formatPrepaidExpiry(null)).toBe("");
  });
});

describe("duplicatedPrepaidExpiry — kopien gemmer en dato (#738)", () => {
  it("bevarer gyldigheden i hele dage og gemmer UTC-midnat", () => {
    // Original: købt 1/3 kl. 14:37 dansk, udløber 31/3 (30 dage).
    const purchase = new Date("2026-03-01T13:37:00Z");
    const expiry = new Date("2026-03-31T00:00:00Z");
    // Dupliceret 20/10 kl. 23:30 dansk — hen over skiftet til vintertid 25/10.
    const now = new Date("2026-10-20T21:30:00Z");
    expect(duplicatedPrepaidExpiry(purchase, expiry, now)).toEqual(
      new Date("2026-11-19T00:00:00Z"),
    );
  });

  it("dansk midnat og kl. 00:30 dansk tæller som samme dag", () => {
    const purchase = new Date("2026-06-30T22:00:00Z"); // 1/7 00:00 dansk
    const expiry = new Date("2026-07-30T22:00:00Z"); // 31/7 dansk (ældre række)
    const now = new Date("2026-10-24T22:30:00Z"); // 25/10 00:30 dansk
    expect(duplicatedPrepaidExpiry(purchase, expiry, now)).toEqual(
      new Date("2026-11-24T00:00:00Z"),
    );
  });

  it("intet udløb giver intet udløb", () => {
    expect(duplicatedPrepaidExpiry(new Date(), null)).toBeNull();
  });
});
