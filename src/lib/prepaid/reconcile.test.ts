import { describe, expect, it } from "vitest";
import { effectiveClientId, resolvePrepaidReconcile } from "./reconcile";

const PKG_A = "11111111-1111-1111-1111-111111111111";
const PKG_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** Post med kun klient (ingen projekt-klient). */
const only = (clientId: string | null) => ({ clientId, projectClientId: null });

const basePrepaid = {
  wasPrepaid: true,
  oldPackageId: PKG_A,
  oldClient: only(CLIENT_A),
  newClient: only(CLIENT_A),
  requestedPackageId: undefined,
  oldHours: 2,
  newHours: 2,
};

describe("resolvePrepaidReconcile — klient-skift (#204 fund 1)", () => {
  it("detacher trækket når klienten skifter uden eksplicit pakkevalg", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      newClient: only(CLIENT_B),
    });
    expect(d.targetPackageId).toBeNull();
    expect(d.needsReconcile).toBe(true);
    expect(d.packageChanged).toBe(true);
  });

  it("detacher også når klienten fjernes helt (intern tid)", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      newClient: only(null),
    });
    expect(d.targetPackageId).toBeNull();
    expect(d.needsReconcile).toBe(true);
  });

  it("beholder pakken ved klient-skift når en ny pakke vælges eksplicit", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      newClient: only(CLIENT_B),
      requestedPackageId: PKG_B,
    });
    expect(d.targetPackageId).toBe(PKG_B);
    expect(d.needsReconcile).toBe(true);
    expect(d.packageChanged).toBe(true);
  });

  it("rører ikke trækket når hverken klient, timer eller pakke ændres", () => {
    const d = resolvePrepaidReconcile(basePrepaid);
    expect(d.targetPackageId).toBe(PKG_A);
    expect(d.needsReconcile).toBe(false);
  });
});

describe("resolvePrepaidReconcile — pakkeskift/fjern (#204 fund 2)", () => {
  it("null fjerner trækket eksplicit", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      requestedPackageId: null,
    });
    expect(d.targetPackageId).toBeNull();
    expect(d.needsReconcile).toBe(true);
    expect(d.packageChanged).toBe(true);
  });

  it("uuid flytter trækket til en anden pakke", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      requestedPackageId: PKG_B,
    });
    expect(d.targetPackageId).toBe(PKG_B);
    expect(d.needsReconcile).toBe(true);
    expect(d.packageChanged).toBe(true);
    expect(d.allowInactive).toBe(false); // ny pakke skal være aktiv
  });

  it("kan gøre en ikke-prepaid post prepaid", () => {
    const d = resolvePrepaidReconcile({
      wasPrepaid: false,
      oldPackageId: null,
      oldClient: only(CLIENT_A),
      newClient: only(CLIENT_A),
      requestedPackageId: PKG_A,
      oldHours: 2,
      newHours: 2,
    });
    expect(d.targetPackageId).toBe(PKG_A);
    expect(d.needsReconcile).toBe(true);
  });

  it("ikke-prepaid post uden pakkevalg reconciler ikke", () => {
    const d = resolvePrepaidReconcile({
      wasPrepaid: false,
      oldPackageId: null,
      oldClient: only(CLIENT_A),
      newClient: only(CLIENT_B),
      requestedPackageId: undefined,
      oldHours: 2,
      newHours: 5,
    });
    expect(d.needsReconcile).toBe(false);
    expect(d.targetPackageId).toBeNull();
  });
});

describe("resolvePrepaidReconcile — timer-ændring + inaktiv pakke (#204 fund 4)", () => {
  it("timer-ændring på samme pakke reconciler", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      newHours: 5,
    });
    expect(d.targetPackageId).toBe(PKG_A);
    expect(d.needsReconcile).toBe(true);
    expect(d.packageChanged).toBe(false);
  });

  it("NEDskrivning på samme pakke tillader inaktiv pakke", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      oldHours: 5,
      newHours: 2,
    });
    expect(d.allowInactive).toBe(true);
  });

  it("uændrede timer på samme pakke tillader inaktiv (no-op-sikkert)", () => {
    const d = resolvePrepaidReconcile(basePrepaid);
    expect(d.allowInactive).toBe(true);
  });

  it("OPskrivning på samme pakke kræver aktiv pakke", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      oldHours: 2,
      newHours: 5,
    });
    expect(d.allowInactive).toBe(false);
  });

  it("nedskrivning kombineret med pakkeskift kræver stadig aktiv målpakke", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      oldHours: 5,
      newHours: 2,
      requestedPackageId: PKG_B,
    });
    expect(d.allowInactive).toBe(false);
  });
});

describe("resolvePrepaidReconcile — effektiv klient (A1 P1-1)", () => {
  it("fortsæt: klient+projekt → kun projekt (samme kunde) beholder trækket", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      oldClient: { clientId: CLIENT_A, projectClientId: CLIENT_A },
      newClient: { clientId: null, projectClientId: CLIENT_A },
    });
    expect(d.clientChanged).toBe(false);
    expect(d.targetPackageId).toBe(PKG_A);
    expect(d.needsReconcile).toBe(false);
  });

  it("kun projekt → klient+projekt (samme kunde) beholder trækket", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      oldClient: { clientId: null, projectClientId: CLIENT_A },
      newClient: { clientId: CLIENT_A, projectClientId: CLIENT_A },
      newHours: 3,
    });
    expect(d.clientChanged).toBe(false);
    expect(d.targetPackageId).toBe(PKG_A);
    expect(d.packageChanged).toBe(false);
  });

  it("projekt hos en anden kunde detacher stadig", () => {
    const d = resolvePrepaidReconcile({
      ...basePrepaid,
      oldClient: { clientId: null, projectClientId: CLIENT_A },
      newClient: { clientId: null, projectClientId: CLIENT_B },
    });
    expect(d.clientChanged).toBe(true);
    expect(d.targetPackageId).toBeNull();
  });
});

describe("effectiveClientId", () => {
  it("klienten vinder, ellers projektets klient, ellers null", () => {
    expect(
      effectiveClientId({ clientId: CLIENT_A, projectClientId: CLIENT_B }),
    ).toBe(CLIENT_A);
    expect(
      effectiveClientId({ clientId: null, projectClientId: CLIENT_B }),
    ).toBe(CLIENT_B);
    expect(
      effectiveClientId({ clientId: null, projectClientId: null }),
    ).toBeNull();
  });
});
