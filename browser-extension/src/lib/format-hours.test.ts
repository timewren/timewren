import { describe, expect, it } from "vitest";
import { formatHourlyRate, formatHoursShort } from "./format-hours";

describe("formatHoursShort", () => {
  it("bruger komma og mellemrum før enheden", () => {
    expect(formatHoursShort(7.5)).toBe("7,5 t");
    expect(formatHoursShort(13.8)).toBe("13,8 t");
  });

  it("udelader nuller til sidst og giver højst to decimaler", () => {
    expect(formatHoursShort(8)).toBe("8 t");
    expect(formatHoursShort(1.25)).toBe("1,25 t");
    expect(formatHoursShort(13.8333)).toBe("13,83 t");
  });

  it("viser minutter under en time", () => {
    expect(formatHoursShort(0.75)).toBe("45 min");
  });

  it("nul og ugyldige tal er 0 t", () => {
    expect(formatHoursShort(0)).toBe("0 t");
    expect(formatHoursShort(Number.NaN)).toBe("0 t");
  });
});

describe("formatHourlyRate", () => {
  it("skriver kr. med punktum og tusindtalspunktum", () => {
    expect(formatHourlyRate(850)).toBe("850 kr./t");
    expect(formatHourlyRate(1250)).toBe("1.250 kr./t");
    expect(formatHourlyRate(712.5)).toBe("712,5 kr./t");
  });
});
