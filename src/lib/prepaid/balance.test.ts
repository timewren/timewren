import { describe, expect, it } from "vitest";
import { isPrepaidBalanceLow, prepaidBalanceLevel } from "./balance";

// Standard-env: PREPAID_LOW_BALANCE_THRESHOLD=0.2, PREPAID_CRITICAL_BALANCE_HOURS=1
// (se src/lib/config.ts). Grænserne er inklusive, ligesom
// checkAndSendLowBalanceAlert i src/lib/trpc/routers/prepaid.ts, så UI'et
// aldrig viser "ok" på et kort der allerede har udløst lav-saldo-mailen.

describe("prepaidBalanceLevel", () => {
  it("er ok langt fra tærsklerne", () => {
    expect(prepaidBalanceLevel(80, 100)).toBe("ok");
  });

  it("er low ved præcis 20 % tilbage (store kort)", () => {
    expect(prepaidBalanceLevel(20, 100)).toBe("low");
  });

  it("er ok ved 21 % tilbage", () => {
    expect(prepaidBalanceLevel(21, 100)).toBe("ok");
  });

  it("er critical under den flade timer-gulv, selv med høj procent", () => {
    // 1t af et 1000t-kort er 0,1 % — langt under 20 % — men stadig kritisk,
    // fordi den flade gulv (1 time) fanger den uanset kortets størrelse.
    expect(prepaidBalanceLevel(1, 1000)).toBe("critical");
  });

  it("er critical ved 0 timer tilbage (opbrugt)", () => {
    expect(prepaidBalanceLevel(0, 100)).toBe("critical");
  });

  it("er critical ved negativt overtræk", () => {
    expect(prepaidBalanceLevel(-2, 100)).toBe("critical");
  });

  it("springer low over for små kort hvor gulvet er højere end 20 %-grænsen", () => {
    // Kort på 3 timer: 20 % = 0,6t, men den flade gulv (1t) er højere, så
    // kortet går direkte fra ok til critical uden et "low"-vindue.
    expect(prepaidBalanceLevel(1.5, 3)).toBe("ok");
    expect(prepaidBalanceLevel(1, 3)).toBe("critical");
  });

  it("falder tilbage til den flade gulv ved ukendt/ugyldig total", () => {
    expect(prepaidBalanceLevel(5, 0)).toBe("ok");
    expect(prepaidBalanceLevel(0.5, 0)).toBe("critical");
  });
});

describe("isPrepaidBalanceLow", () => {
  it("er false for ok", () => {
    expect(isPrepaidBalanceLow(80, 100)).toBe(false);
  });

  it("er true for low og critical", () => {
    expect(isPrepaidBalanceLow(20, 100)).toBe(true);
    expect(isPrepaidBalanceLow(0, 100)).toBe(true);
  });
});
