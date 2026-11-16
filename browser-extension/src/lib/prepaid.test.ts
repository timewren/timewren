import { describe, expect, it } from "vitest";
import type { PrepaidPackage } from "../types";
import {
  canStoreServerChoice,
  classifyPrepaidDeduction,
  daysUntilPrepaidExpiry,
  formatPrepaidExpiryDate,
  fromServerChoice,
  isPrepaidDeductionError,
  isPrepaidExpiringSoon,
  packagesForClient,
  pickAutoPrepaid,
  resolvePrepaidPackage,
  restoreStoredChoice,
} from "./prepaid";

const pkg = (
  over: Partial<PrepaidPackage> & { id: string },
): PrepaidPackage => ({
  clientId: "klient-1",
  clientName: "Goldschmidt",
  name: "Klippekort",
  totalHours: 35,
  usedHours: 0,
  remainingHours: 35,
  expiresAt: null,
  autoDeduct: true,
  ...over,
});

describe("packagesForClient", () => {
  it("tager kun kundens egne kort", () => {
    const res = packagesForClient(
      [pkg({ id: "a" }), pkg({ id: "b", clientId: "klient-2" })],
      "klient-1",
    );
    expect(res.map((p) => p.id)).toEqual(["a"]);
  });

  it("udelader opbrugte kort", () => {
    const res = packagesForClient(
      [pkg({ id: "a", remainingHours: 0 }), pkg({ id: "b" })],
      "klient-1",
    );
    expect(res.map((p) => p.id)).toEqual(["b"]);
  });

  it("giver tom liste uden kunde", () => {
    expect(packagesForClient([pkg({ id: "a" })], null)).toEqual([]);
  });
});

describe("pickAutoPrepaid", () => {
  it("vælger kundens kort med auto-træk", () => {
    expect(pickAutoPrepaid([pkg({ id: "a" })], "klient-1")?.id).toBe("a");
  });

  it("springer kort uden auto-træk over", () => {
    expect(
      pickAutoPrepaid([pkg({ id: "a", autoDeduct: false })], "klient-1"),
    ).toBeNull();
  });

  it("vælger det kort der udløber først", () => {
    const res = pickAutoPrepaid(
      [
        pkg({ id: "sen", expiresAt: "2026-12-01T00:00:00.000Z" }),
        pkg({ id: "tidlig", expiresAt: "2026-09-01T00:00:00.000Z" }),
      ],
      "klient-1",
    );
    expect(res?.id).toBe("tidlig");
  });

  it("foretrækker et kort med udløb frem for et uden", () => {
    const res = pickAutoPrepaid(
      [
        pkg({ id: "uden-udløb", expiresAt: null }),
        pkg({ id: "med-udløb", expiresAt: "2026-09-01T00:00:00.000Z" }),
      ],
      "klient-1",
    );
    expect(res?.id).toBe("med-udløb");
  });

  it("returnerer null når kunden ingen kort har", () => {
    expect(pickAutoPrepaid([pkg({ id: "a" })], "klient-2")).toBeNull();
  });

  it("returnerer null for intern tid uden kunde", () => {
    expect(pickAutoPrepaid([pkg({ id: "a" })], null)).toBeNull();
  });

  it("udelader opbrugte kort selv med auto-træk", () => {
    expect(
      pickAutoPrepaid([pkg({ id: "a", remainingHours: 0 })], "klient-1"),
    ).toBeNull();
  });
});

describe("resolvePrepaidPackage", () => {
  it("auto (og intet valg) følger pickAutoPrepaid", () => {
    const packages = [pkg({ id: "a" })];
    expect(
      resolvePrepaidPackage({ mode: "auto" }, packages, "klient-1").pkg?.id,
    ).toBe("a");
    expect(resolvePrepaidPackage(null, packages, "klient-1").pkg?.id).toBe("a");
    expect(resolvePrepaidPackage(undefined, packages, "klient-1").pkg?.id).toBe(
      "a",
    );
  });

  it("auto uden auto-kort giver intet træk uden advarsel", () => {
    const res = resolvePrepaidPackage(
      { mode: "auto" },
      [pkg({ id: "a", autoDeduct: false })],
      "klient-1",
    );
    expect(res.pkg).toBeNull();
    expect(res.pinnedUnavailable).toBe(false);
  });

  it("'intet klippekort' trækker aldrig — heller ikke med auto-kort", () => {
    const res = resolvePrepaidPackage(
      { mode: "none" },
      [pkg({ id: "a" })],
      "klient-1",
    );
    expect(res.pkg).toBeNull();
    expect(res.pinnedUnavailable).toBe(false);
  });

  it("eksplicit valg overstyrer auto-kortet", () => {
    const packages = [
      pkg({ id: "auto-kort", autoDeduct: true }),
      pkg({ id: "manuelt-kort", autoDeduct: false }),
    ];
    expect(
      resolvePrepaidPackage(
        { mode: "package", packageId: "manuelt-kort" },
        packages,
        "klient-1",
      ).pkg?.id,
    ).toBe("manuelt-kort");
  });

  it("eksplicit valg kan vælge kort uden auto-træk", () => {
    const packages = [pkg({ id: "a", autoDeduct: false })];
    expect(
      resolvePrepaidPackage(
        { mode: "package", packageId: "a" },
        packages,
        "klient-1",
      ).pkg?.id,
    ).toBe("a");
  });

  it("ugyldigt eksplicit valg falder ALDRIG tilbage til auto-kortet", () => {
    // Brugerens beslutning må ikke stiltiende erstattes: selv med et
    // gyldigt auto-kort til rådighed trækkes der intet
    const packages = [
      pkg({ id: "fremmed", clientId: "klient-2" }),
      pkg({ id: "eget-auto" }),
    ];
    const res = resolvePrepaidPackage(
      { mode: "package", packageId: "fremmed" },
      packages,
      "klient-1",
    );
    expect(res.pkg).toBeNull();
    expect(res.pinnedUnavailable).toBe(true);
  });

  it("opbrugt pinnet kort giver intet træk + advarselsflag", () => {
    const packages = [
      pkg({ id: "tomt", remainingHours: 0, autoDeduct: false }),
      pkg({ id: "eget-auto" }),
    ];
    const res = resolvePrepaidPackage(
      { mode: "package", packageId: "tomt" },
      packages,
      "klient-1",
    );
    expect(res.pkg).toBeNull();
    expect(res.pinnedUnavailable).toBe(true);
  });

  it("forsvundet pinnet kort giver intet træk + advarselsflag", () => {
    const res = resolvePrepaidPackage(
      { mode: "package", packageId: "findes-ikke" },
      [pkg({ id: "a" })],
      "klient-1",
    );
    expect(res.pkg).toBeNull();
    expect(res.pinnedUnavailable).toBe(true);
  });
});

describe("isPrepaidDeductionError", () => {
  it("genkender serverens klippekort-fejl", () => {
    expect(
      isPrepaidDeductionError(
        "Ikke nok timer tilbage på klippekortet. Tilgængelige timer: 0.50",
      ),
    ).toBe(true);
    expect(isPrepaidDeductionError("Klippekort ikke fundet")).toBe(true);
    expect(isPrepaidDeductionError("Klippekortet er udløbet")).toBe(true);
    expect(isPrepaidDeductionError("Klippekort er ikke aktivt")).toBe(true);
    expect(
      isPrepaidDeductionError("Ugyldigt timetal til klippekort-traek"),
    ).toBe(true);
    expect(
      isPrepaidDeductionError(
        "Klippekortet tilhører en anden kunde end registreringen",
      ),
    ).toBe(true);
  });

  it("rører ikke andre fejl", () => {
    expect(isPrepaidDeductionError("Projekt ikke fundet")).toBe(false);
    expect(isPrepaidDeductionError("Kunde ikke fundet")).toBe(false);
    expect(isPrepaidDeductionError("Perioden er låst")).toBe(false);
    expect(isPrepaidDeductionError("")).toBe(false);
  });
});

describe("classifyPrepaidDeduction", () => {
  it("almindeligt træk", () => {
    expect(
      classifyPrepaidDeduction({
        hoursDeducted: 2.5,
        overflowedToInvoice: false,
      }),
    ).toBe("deducted");
  });

  it("delvist træk med overløb", () => {
    expect(
      classifyPrepaidDeduction({
        hoursDeducted: 1.5,
        overflowedToInvoice: true,
      }),
    ).toBe("deducted-overflow");
  });

  it("invoice-politik uden dækning: INTET blev trukket", () => {
    expect(
      classifyPrepaidDeduction({
        hoursDeducted: 0,
        overflowedToInvoice: true,
      }),
    ).toBe("nothing-deducted");
  });
});

describe("restoreStoredChoice", () => {
  const stored = {
    choice: { mode: "none" } as const,
    clientId: "klient-1",
    sessionStart: "2026-08-18T08:00:00.000Z",
  };

  it("gendanner valget for præcis samme kunde + session", () => {
    expect(
      restoreStoredChoice(stored, "klient-1", "2026-08-18T08:00:00.000Z"),
    ).toEqual({ mode: "none" });
  });

  it("en NY session på samme kunde arver ALDRIG et gammelt valg", () => {
    expect(
      restoreStoredChoice(stored, "klient-1", "2026-08-20T09:00:00.000Z"),
    ).toEqual({ mode: "auto" });
  });

  it("anden kunde giver default", () => {
    expect(
      restoreStoredChoice(stored, "klient-2", "2026-08-18T08:00:00.000Z"),
    ).toEqual({ mode: "auto" });
  });

  it("pauset session (startTime null) matcher kun null-nøgle med kunde", () => {
    const paused = { ...stored, sessionStart: null };
    expect(restoreStoredChoice(paused, "klient-1", null)).toEqual({
      mode: "none",
    });
    // Uden kunde må intet gendannes — heller ikke ved null-null-match
    expect(
      restoreStoredChoice({ ...paused, clientId: null }, null, null),
    ).toEqual({ mode: "auto" });
  });

  it("intet gemt giver default", () => {
    expect(restoreStoredChoice(undefined, "klient-1", "x")).toEqual({
      mode: "auto",
    });
    expect(restoreStoredChoice(null, "klient-1", "x")).toEqual({
      mode: "auto",
    });
  });
});

describe("isPrepaidExpiringSoon (#736)", () => {
  const expiry = "2026-08-15T00:00:00.000Z"; // gemt som UTC-midnat
  const at = (iso: string) => new Date(iso);

  it("markerer kortet hele udløbsdagen i dansk tid", () => {
    expect(daysUntilPrepaidExpiry(expiry, at("2026-08-15T21:30:00Z"))).toBe(0);
    expect(isPrepaidExpiringSoon(expiry, 7, at("2026-08-15T21:30:00Z"))).toBe(
      true,
    );
    expect(isPrepaidExpiringSoon(expiry, 7, at("2026-08-15T22:01:00Z"))).toBe(
      false,
    );
  });

  it("tæller kalenderdage frem til udløb", () => {
    expect(isPrepaidExpiringSoon(expiry, 7, at("2026-08-08T10:00:00Z"))).toBe(
      true,
    );
    expect(isPrepaidExpiringSoon(expiry, 7, at("2026-08-07T10:00:00Z"))).toBe(
      false,
    );
    expect(isPrepaidExpiringSoon(null)).toBe(false);
  });
});

describe("formatPrepaidExpiryDate", () => {
  it("viser den danske dato uanset processens tidszone", () => {
    // UTC-midnat og dansk midnat (22:00Z dagen før om sommeren) er begge 30/9
    expect(formatPrepaidExpiryDate("2026-09-30T00:00:00.000Z")).toBe(
      "30. sep. 2026",
    );
    expect(formatPrepaidExpiryDate("2026-09-29T22:00:00.000Z")).toBe(
      "30. sep. 2026",
    );
    // BRAND.md: "12. okt. 2026", aldrig "12/10"
    expect(formatPrepaidExpiryDate("2026-05-03T00:00:00.000Z")).toBe(
      "3. maj 2026",
    );
  });
});

describe("fromServerChoice (serverens gemte valg, #422)", () => {
  it("oversætter valget for timerens kunde", () => {
    expect(
      fromServerChoice(
        { mode: "package", packageId: "p1", clientId: "klient-1" },
        "klient-1",
      ),
    ).toEqual({ mode: "package", packageId: "p1" });
    expect(
      fromServerChoice({ mode: "none", clientId: "klient-1" }, "klient-1"),
    ).toEqual({ mode: "none" });
  });

  it("er null uden valg, uden kunde, eller for en anden kunde", () => {
    expect(fromServerChoice(null, "klient-1")).toBeNull();
    expect(fromServerChoice(undefined, "klient-1")).toBeNull();
    expect(
      fromServerChoice({ mode: "none", clientId: "klient-1" }, null),
    ).toBeNull();
    expect(
      fromServerChoice({ mode: "none", clientId: "klient-2" }, "klient-1"),
    ).toBeNull();
  });
});

describe("canStoreServerChoice", () => {
  it("kræver kunde og en aktiv session (kørende eller pauset med tid)", () => {
    expect(canStoreServerChoice({ clientId: "k", isRunning: true })).toBe(true);
    expect(
      canStoreServerChoice({
        clientId: "k",
        isRunning: false,
        baseSeconds: 60,
      }),
    ).toBe(true);
    expect(
      canStoreServerChoice({
        clientId: "k",
        isRunning: false,
        elapsedSeconds: 0,
        baseSeconds: 0,
      }),
    ).toBe(false);
    expect(canStoreServerChoice({ clientId: null, isRunning: true })).toBe(
      false,
    );
    expect(canStoreServerChoice(null)).toBe(false);
  });
});
