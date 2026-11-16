import { describe, expect, it } from "vitest";
import { resolveOrgProfile } from "./org-profile";

const on =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key);

describe("resolveOrgProfile (#452)", () => {
  it("eksplicit metadata.type vinder over modul-heuristikken", () => {
    expect(resolveOrgProfile("enterprise", on("clients"))).toBe("enterprise");
    expect(resolveOrgProfile("freelance", on("enterprise"))).toBe("freelance");
  });

  it("uden type: enterprise til, klienter fra ⇒ enterprise", () => {
    expect(resolveOrgProfile(null, on("enterprise"))).toBe("enterprise");
    expect(resolveOrgProfile(undefined, on("enterprise", "clients"))).toBe(
      "freelance",
    );
    expect(resolveOrgProfile(null, on("clients"))).toBe("freelance");
    expect(resolveOrgProfile(null, on())).toBe("freelance");
  });

  it("ukendt type falder tilbage til heuristikken", () => {
    expect(resolveOrgProfile("agency", on("enterprise"))).toBe("enterprise");
    expect(resolveOrgProfile("agency", on())).toBe("freelance");
  });
});
