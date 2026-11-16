import { describe, expect, it, vi } from "vitest";
import { type BillyContact, BillyIntegration } from "../billy";

// Prod 1/10-2026: En kunde havde to Billy-kontakter med samme CVR, og
// den arkiverede kom først i listen. Eksporten koblede klienten til den.
const contact = (id: string, isArchived: boolean): BillyContact => ({
  id,
  name: "Eksempel Højskole ApS",
  type: "company",
  registrationNo: "38768484",
  countryId: "DK",
  isCustomer: true,
  isSupplier: false,
  isArchived,
});

describe("findContactByCvr", () => {
  it("vælger den aktive kontakt frem for en arkiveret med samme CVR", async () => {
    const billy = new BillyIntegration("test");
    vi.spyOn(billy, "getContacts").mockResolvedValue([
      contact("arkiveret", true),
      contact("aktiv", false),
    ]);
    expect((await billy.findContactByCvr("38768484"))?.id).toBe("aktiv");
  });

  it("returnerer null når kun en arkiveret kontakt har CVR'et", async () => {
    const billy = new BillyIntegration("test");
    vi.spyOn(billy, "getContacts").mockResolvedValue([
      contact("arkiveret", true),
    ]);
    expect(await billy.findContactByCvr("38768484")).toBeNull();
  });
});
