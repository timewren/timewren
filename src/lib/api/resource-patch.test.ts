import { describe, expect, it } from "vitest";
import { mergePrepaidPatch, mergeProjectPatch } from "./resource-patch";

// projects.update og prepaid.update er fulde erstatninger: et felt der ikke
// sendes, bliver ryddet. REST-PATCH skal derfor flette med den gemte række
// (#718) — udeladt = uændret, eksplicit null = ryd.

const project = {
  id: "p-1",
  name: "Website",
  description: "Redesign",
  clientId: "client-1",
  hourlyRate: "950.00",
  fixedPrice: null,
  monthlyBudgetHours: "10.00",
  budgetHours: "80.00",
  status: "active",
  startDate: new Date("2026-09-01T00:00:00.000Z"),
  endDate: null,
  urlPatterns: ["example.com"],
  roundingEnabled: true,
  roundingMinutes: 15,
  roundingMethod: "up",
  client: { id: "client-1", name: "Kunde A" },
};

describe("mergeProjectPatch", () => {
  it("bevarer kunde, sats, budget og datoer når kun status sendes", () => {
    const data = mergeProjectPatch(project, { status: "completed" });
    expect(data).toEqual({
      name: "Website",
      description: "Redesign",
      clientId: "client-1",
      hourlyRate: "950.00",
      monthlyBudgetHours: "10.00",
      budgetHours: "80.00",
      status: "completed",
      startDate: "2026-09-01T00:00:00.000Z",
      urlPatterns: ["example.com"],
      roundingEnabled: true,
      roundingMinutes: 15,
      roundingMethod: "up",
    });
  });

  it("rydder kunden og satsen ved eksplicit null", () => {
    const data = mergeProjectPatch(project, {
      clientId: null,
      hourlyRate: null,
    });
    expect(data.clientId).toBeNull();
    expect(data.hourlyRate).toBeUndefined();
    expect(data.name).toBe("Website");
    expect(data.budgetHours).toBe("80.00");
  });

  it("normaliserer talværdier til strenge som før", () => {
    const data = mergeProjectPatch(project, { hourlyRate: 1100 });
    expect(data.hourlyRate).toBe("1100");
  });
});

const pkg = {
  id: "pkg-1",
  name: "20 timer",
  clientId: "client-1",
  totalHours: "20.00",
  usedHours: "5.00",
  remainingHours: "15.00",
  hourlyRate: "800.00",
  purchaseDate: new Date("2026-08-01T00:00:00.000Z"),
  expiryDate: new Date("2027-08-01T00:00:00.000Z"),
  description: "Support",
  clipSizeMinutes: 15,
  overdraftPolicy: "block",
  overdraftRate: null,
  autoDeduct: true,
  client: { id: "client-1" },
  usageHistory: [],
  hideValue: false,
};

describe("mergePrepaidPatch", () => {
  it("bevarer udløb, beskrivelse og klip-størrelse når kun navnet sendes", () => {
    const data = mergePrepaidPatch(pkg, { name: "Nyt navn" });
    expect(data).toEqual({
      name: "Nyt navn",
      clientId: "client-1",
      totalHours: 20,
      hourlyRate: 800,
      purchaseDate: "2026-08-01T00:00:00.000Z",
      expiryDate: "2027-08-01T00:00:00.000Z",
      description: "Support",
      clipSizeMinutes: 15,
    });
  });

  it("rydder udløbsdato og klip-størrelse ved eksplicit null", () => {
    const data = mergePrepaidPatch(pkg, {
      expiryDate: null,
      clipSizeMinutes: null,
    });
    expect(data.expiryDate).toBeUndefined();
    expect(data.clipSizeMinutes).toBeNull();
    expect(data.description).toBe("Support");
  });

  it("sender de øvrige sendte felter uændret videre", () => {
    const data = mergePrepaidPatch(pkg, {
      totalHours: 30,
      overdraftPolicy: "allow",
      autoDeduct: false,
    });
    expect(data.totalHours).toBe(30);
    expect(data.overdraftPolicy).toBe("allow");
    expect(data.autoDeduct).toBe(false);
    expect(data.hourlyRate).toBe(800);
  });
});
