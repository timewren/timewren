import { describe, expect, it } from "vitest";
import { planBulkAssign } from "./bulk-assign";

const PKG = "pkg-1";
const CLIENT = "client-1";

const entry = (
  id: string,
  overrides: Partial<{
    effectiveClientId: string | null;
    prepaidPackageId: string | null;
  }> = {},
) => ({
  id,
  effectiveClientId: CLIENT,
  prepaidPackageId: null,
  ...overrides,
});

describe("planBulkAssign", () => {
  it("trækker utrukket tid på kortet", () => {
    const plan = planBulkAssign(PKG, CLIENT, [entry("a"), entry("b")]);

    expect(plan.toAssign.map((e) => e.id)).toEqual(["a", "b"]);
    expect(plan.alreadyOnPackage).toHaveLength(0);
    expect(plan.foreign).toHaveLength(0);
  });

  it("springer poster over der allerede ligger på målpakken", () => {
    const plan = planBulkAssign(PKG, CLIENT, [
      entry("a"),
      entry("b", { prepaidPackageId: PKG }),
    ]);

    expect(plan.toAssign.map((e) => e.id)).toEqual(["a"]);
    expect(plan.alreadyOnPackage.map((e) => e.id)).toEqual(["b"]);
  });

  it("flytter poster fra et andet klippekort", () => {
    const plan = planBulkAssign(PKG, CLIENT, [
      entry("a", { prepaidPackageId: "pkg-2" }),
    ]);

    expect(plan.toAssign.map((e) => e.id)).toEqual(["a"]);
    expect(plan.alreadyOnPackage).toHaveLength(0);
  });

  it("udpeger poster hos en anden kunde end kortet", () => {
    const plan = planBulkAssign(PKG, CLIENT, [
      entry("a"),
      entry("b", { effectiveClientId: "client-2" }),
    ]);

    expect(plan.foreign.map((e) => e.id)).toEqual(["b"]);
    expect(plan.toAssign.map((e) => e.id)).toEqual(["a"]);
  });

  it("behandler en post uden kunde som fremmed — intern tid må ikke trækkes", () => {
    const plan = planBulkAssign(PKG, CLIENT, [
      entry("a", { effectiveClientId: null }),
    ]);

    expect(plan.foreign.map((e) => e.id)).toEqual(["a"]);
    expect(plan.toAssign).toHaveLength(0);
  });
});
