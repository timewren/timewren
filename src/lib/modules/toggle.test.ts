import { describe, expect, it } from "vitest";
import { shouldMakeModuleAvailable } from "./toggle";

describe("shouldMakeModuleAvailable", () => {
  it("et modul seedet som utilgængeligt gøres tilgængeligt, når det slås til", () => {
    expect(
      shouldMakeModuleAvailable({ enabled: true, isAvailable: false }),
    ).toBe(true);
  });

  it("et tilgængeligt modul røres ikke", () => {
    expect(
      shouldMakeModuleAvailable({ enabled: true, isAvailable: true }),
    ).toBe(false);
  });

  it("at slå et modul fra ændrer aldrig tilgængeligheden", () => {
    expect(
      shouldMakeModuleAvailable({ enabled: false, isAvailable: false }),
    ).toBe(false);
  });
});
