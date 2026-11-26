import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORG_REGION,
  defaultClientCountry,
  formatInvoiceSequence,
  isDenmark,
  isEuMemberState,
  isEuVatFormat,
  normalizeVatNumber,
  orgRegionFromMetadata,
  regionForNewOrg,
  regionMetadata,
} from "../region";

describe("regionForNewOrg (fund 19)", () => {
  it("giver TimeTrack DKK og Danmark uanset sprog", () => {
    expect(regionForNewOrg("timetrack", "da")).toEqual({
      currency: "DKK",
      country: "DK",
      locale: "da",
    });
    expect(regionForNewOrg("timetrack", "en").currency).toBe("DKK");
  });

  it("giver en dansk TimeWren-bruger DKK og Danmark", () => {
    expect(regionForNewOrg("timewren", "da")).toEqual({
      currency: "DKK",
      country: "DK",
      locale: "da",
    });
  });

  it("giver engelsk, tysk og spansk EUR", () => {
    expect(regionForNewOrg("timewren", "en")).toEqual({
      currency: "EUR",
      country: null,
      locale: "en",
    });
    expect(regionForNewOrg("timewren", "de")).toMatchObject({
      currency: "EUR",
      country: "DE",
    });
    expect(regionForNewOrg("timewren", "es-ES")).toMatchObject({
      currency: "EUR",
      country: "ES",
      locale: "es",
    });
  });

  it("læser intet sprog som dansk (kolonnens default)", () => {
    expect(regionForNewOrg("timewren", null).currency).toBe("DKK");
  });
});

describe("orgRegionFromMetadata", () => {
  it("læser en organisation fra før som DKK og Danmark", () => {
    expect(orgRegionFromMetadata(null)).toEqual(DEFAULT_ORG_REGION);
    expect(orgRegionFromMetadata({ type: "freelance" })).toEqual(
      DEFAULT_ORG_REGION,
    );
  });

  it("læser metadata gemt som JSON-streng (Better-Auth-opdatering)", () => {
    const region = regionForNewOrg("timewren", "de");
    expect(
      orgRegionFromMetadata(
        JSON.stringify({ type: "freelance", ...regionMetadata(region) }),
      ),
    ).toEqual(region);
  });

  it("læser det gemte tilbage", () => {
    const region = regionForNewOrg("timewren", "en");
    expect(
      orgRegionFromMetadata({ type: "freelance", ...regionMetadata(region) }),
    ).toEqual(region);
  });
});

describe("formatInvoiceSequence (fund 11)", () => {
  it("beholder INV-001 for organisationer fra før og ikke-danske", () => {
    expect(formatInvoiceSequence(DEFAULT_ORG_REGION, 1)).toBe("INV-001");
    expect(formatInvoiceSequence(regionForNewOrg("timewren", "en"), 42)).toBe(
      "INV-042",
    );
  });

  it("giver en ny dansk organisation løbenumre uden præfiks", () => {
    expect(formatInvoiceSequence(regionForNewOrg("timetrack", "da"), 1)).toBe(
      "1",
    );
    expect(
      formatInvoiceSequence(regionForNewOrg("timetrack", "da"), 1042),
    ).toBe("1042");
  });
});

describe("kundens land og momsnummer", () => {
  it("genkender Danmark på flere sprog", () => {
    for (const name of [
      "Danmark",
      "Denmark",
      "dänemark",
      "DK",
      " dinamarca ",
    ]) {
      expect(isDenmark(name)).toBe(true);
    }
    expect(isDenmark("Germany")).toBe(false);
    expect(isDenmark("")).toBe(false);
    expect(isDenmark(null)).toBe(false);
  });

  it("genkender EU-lande uden for Danmark på flere sprog", () => {
    for (const name of [
      "DE",
      "Germany",
      "Tyskland",
      "Deutschland",
      "Alemania",
      " österreich ",
      "Østrig",
      "Grækenland",
      "EL",
      "Czech Republic",
      "Holland",
    ]) {
      expect(isEuMemberState(name), name).toBe(true);
    }
    for (const name of [
      "Danmark",
      "USA",
      "United States",
      "Norge",
      "Schweiz",
      "United Kingdom",
      "",
      null,
    ]) {
      expect(isEuMemberState(name), String(name)).toBe(false);
    }
  });

  it("tjekker EU-momsnummerets form", () => {
    expect(isEuVatFormat("DE123456789")).toBe(true);
    expect(isEuVatFormat("de 123 456 789")).toBe(true);
    expect(isEuVatFormat("ESX1234567X")).toBe(true);
    expect(isEuVatFormat("12345678")).toBe(false);
    expect(isEuVatFormat("D1")).toBe(false);
    expect(normalizeVatNumber("nl 8534.21.390 B01")).toBe("NL853421390B01");
  });

  it("starter landefeltet med organisationens land på brugerens sprog", () => {
    expect(defaultClientCountry(DEFAULT_ORG_REGION, "da")).toBe("Danmark");
    // En dansk organisation med fransk eller engelsk UI: stadig "Danmark",
    // som isDenmark genkender (ellers forsvinder CVR-opslaget).
    expect(defaultClientCountry(DEFAULT_ORG_REGION, "fr")).toBe("Danmark");
    expect(defaultClientCountry(DEFAULT_ORG_REGION, "en")).toBe("Danmark");
    expect(defaultClientCountry(regionForNewOrg("timewren", "en"), "en")).toBe(
      "",
    );
    expect(defaultClientCountry(regionForNewOrg("timewren", "de"), "de")).toBe(
      "Deutschland",
    );
  });
});
