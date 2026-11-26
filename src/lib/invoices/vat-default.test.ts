import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideVat,
  isDanishCountry,
  isDanishCvr,
  type VatDecisionInput,
} from "./vat-default";

describe("isDanishCvr", () => {
  it("godtager 8 cifre, også med mellemrum og DK foran", () => {
    expect(isDanishCvr("12345678")).toBe(true);
    expect(isDanishCvr("1234 5678")).toBe(true);
    expect(isDanishCvr("DK12345678")).toBe(true);
  });

  it("afviser tomt, for kort og navne", () => {
    expect(isDanishCvr("")).toBe(false);
    expect(isDanishCvr(null)).toBe(false);
    expect(isDanishCvr("1234567")).toBe(false);
    expect(isDanishCvr("Paritet ApS")).toBe(false);
  });
});

describe("isDanishCountry", () => {
  it("tomt land er Danmark (feltets standard)", () => {
    expect(isDanishCountry("")).toBe(true);
    expect(isDanishCountry(undefined)).toBe(true);
    expect(isDanishCountry(" Danmark ")).toBe(true);
    expect(isDanishCountry("denmark")).toBe(true);
    expect(isDanishCountry("Sverige")).toBe(false);
  });
});

describe("decideVat", () => {
  const cvr = "12345678";
  const untouched: VatDecisionInput = {
    chosen: false,
    stored: false,
    cvrNumber: cvr,
    country: "Danmark",
  };
  const on = (input: VatDecisionInput) => decideVat(input).vatRegistered;

  it("CVR på en profil uden valg: slået til, og tæller ikke som valg", () => {
    expect(decideVat(untouched)).toEqual({
      vatRegistered: true,
      vatRegisteredChosen: false,
    });
  });

  it("uden CVR: slået fra", () => {
    expect(on({ ...untouched, cvrNumber: "" })).toBe(false);
    expect(on({ ...untouched, cvrNumber: undefined })).toBe(false);
  });

  it("udenlandsk virksomhed: slået fra, selv med 8 cifre", () => {
    expect(on({ ...untouched, country: "Sverige" })).toBe(false);
  });

  it("et halvt CVR (søgning på navn eller under indtastning): slået fra", () => {
    expect(on({ ...untouched, cvrNumber: "1234567" })).toBe(false);
    expect(on({ ...untouched, cvrNumber: "Moms ApS" })).toBe(false);
  });

  it("brugerens valg i kaldet vinder og bliver gemt som valg", () => {
    expect(decideVat({ ...untouched, requested: false })).toEqual({
      vatRegistered: false,
      vatRegisteredChosen: true,
    });
    expect(decideVat({ ...untouched, cvrNumber: "", requested: true })).toEqual(
      { vatRegistered: true, vatRegisteredChosen: true },
    );
  });

  it("et gemt valg står, uanset CVR og land", () => {
    const chosenOff = { ...untouched, chosen: true, stored: false };
    expect(on(chosenOff)).toBe(false);
    expect(on({ ...chosenOff, country: "Sverige" })).toBe(false);
    const chosenOn = { ...untouched, chosen: true, stored: true };
    expect(on({ ...chosenOn, cvrNumber: "" })).toBe(true);
    expect(decideVat(chosenOn).vatRegisteredChosen).toBe(true);
  });

  // Greptile P1 1: et gemt fravalg må ikke vendes af autogemte mellemtrin.
  it("fravalg med CVR: slet et ciffer, autogem, tast det igen: stadig fra", () => {
    const saved = { chosen: true, stored: false, country: "Danmark" };
    // Autogemmet med syv cifre: intet valg i kaldet, det gemte står
    const midway = decideVat({ ...saved, cvrNumber: "1234567" });
    expect(midway).toEqual({ vatRegistered: false, vatRegisteredChosen: true });
    // Profilen er nu gemt med syv cifre; det fulde nummer tastes igen
    const after = decideVat({
      chosen: midway.vatRegisteredChosen,
      stored: midway.vatRegistered,
      cvrNumber: cvr,
      country: "Danmark",
    });
    expect(after.vatRegistered).toBe(false);
  });

  // Greptile P1 2: landet tilbage til dansk efter en mellemstavning.
  it("land skrevet om fra Danmark til Denmark: slået til igen", () => {
    expect(on({ ...untouched, country: "Danmark" })).toBe(true);
    expect(on({ ...untouched, country: "Den" })).toBe(false);
    expect(on({ ...untouched, country: "Denmark" })).toBe(true);
  });

  it("land skrevet om med et gemt fravalg: stadig fra", () => {
    const chosenOff = { ...untouched, chosen: true, stored: false };
    expect(on({ ...chosenOff, country: "Den" })).toBe(false);
    expect(on({ ...chosenOff, country: "Denmark" })).toBe(false);
  });

  // Greptile P1 3: et opslag, der lander efter brugerens valg, ændrer det ikke.
  it("CVR fra et opslag efter brugerens fravalg: stadig fra", () => {
    // Brugeren søger på navn, sætter og fjerner fluebenet, og så lander CVR'et
    expect(
      on({ chosen: true, stored: false, cvrNumber: cvr, country: "Danmark" }),
    ).toBe(false);
  });
});

describe("backfill i migration 0163", () => {
  // Migrationen genkender et helt CVR med sin egen regex. Den skal give det
  // samme som isDanishCvr, ellers bliver gemte valg overskrevet ved opgradering.
  const sql = readFileSync(
    join(
      process.cwd(),
      "drizzle/0163_company_profiles_vat_registered_chosen.sql",
    ),
    "utf8",
  );
  const match = sql.match(
    /regexp_replace\(coalesce\("cvr_number", ''\), '\\s', '', 'g'\) ~\* '([^']+)'/,
  );

  it("bruger samme CVR-regel som isDanishCvr", () => {
    expect(match).not.toBeNull();
    const pattern = new RegExp(match?.[1] ?? "", "i");
    const backfill = (value: string | null) =>
      pattern.test((value ?? "").replace(/\s/g, ""));
    for (const value of [
      "12345678",
      "1234 5678",
      "DK 1234 5678",
      "dk12345678",
      "1234567",
      "123456789",
      "Acme ApS",
      "",
      null,
    ]) {
      expect(backfill(value), String(value)).toBe(isDanishCvr(value));
    }
  });
});
