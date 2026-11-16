import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parsePrepaidMode,
  resolveAutoPrepaidForUpdate,
  resolveAutoPrepaidPackageId,
} from "./prepaid-auto";

const caller = {
  projects: { list: vi.fn() },
  prepaid: { getActiveForClient: vi.fn() },
};
// biome-ignore lint/suspicious/noExplicitAny: stub af tRPC-calleren
const asCaller = caller as any;

// Listen som getActiveForClient leverer den: nyeste først
const packages = [
  {
    id: "nyt",
    autoDeduct: true,
    remainingHours: 10,
    expiryDate: new Date("2099-12-31T00:00:00Z"),
  },
  {
    id: "gammelt",
    autoDeduct: true,
    remainingHours: 4,
    expiryDate: new Date("2099-01-31T00:00:00Z"),
  },
  { id: "manuelt", autoDeduct: false, remainingHours: 20, expiryDate: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  caller.prepaid.getActiveForClient.mockResolvedValue(packages);
  caller.projects.list.mockResolvedValue([{ id: "p1", clientId: "c-proj" }]);
});

describe("parsePrepaidMode", () => {
  it("er slået fra uden feltet", () => {
    expect(parsePrepaidMode({})).toEqual({ ok: true, auto: false });
    expect(parsePrepaidMode({ prepaid: undefined })).toEqual({
      ok: true,
      auto: false,
    });
  });

  it('accepterer kun "auto"', () => {
    expect(parsePrepaidMode({ prepaid: "auto" })).toEqual({
      ok: true,
      auto: true,
    });
    expect(parsePrepaidMode({ prepaid: "none" })).toMatchObject({
      ok: false,
      field: "prepaid",
    });
    expect(parsePrepaidMode({ prepaid: true })).toMatchObject({ ok: false });
  });

  it("afviser auto kombineret med et eksplicit kort", () => {
    expect(
      parsePrepaidMode({ prepaid: "auto", prepaidPackageId: "x" }),
    ).toMatchObject({ ok: false, field: "prepaid" });
  });
});

describe("resolveAutoPrepaidPackageId (ny post)", () => {
  it("vælger det auto-kort der udløber først — samme regel som web", async () => {
    expect(
      await resolveAutoPrepaidPackageId(asCaller, { clientId: "c1" }),
    ).toBe("gammelt");
    expect(caller.prepaid.getActiveForClient).toHaveBeenCalledWith({
      clientId: "c1",
    });
  });

  it("bruger projektets kunde når der kun er et projekt", async () => {
    await resolveAutoPrepaidPackageId(asCaller, { projectId: "p1" });
    expect(caller.prepaid.getActiveForClient).toHaveBeenCalledWith({
      clientId: "c-proj",
    });
  });

  it("giver null for intern tid og for kunder uden auto-kort", async () => {
    expect(await resolveAutoPrepaidPackageId(asCaller, {})).toBeNull();
    caller.prepaid.getActiveForClient.mockResolvedValue([packages[2]]);
    expect(
      await resolveAutoPrepaidPackageId(asCaller, { clientId: "c1" }),
    ).toBeNull();
  });
});

describe("resolveAutoPrepaidForUpdate (PATCH)", () => {
  const plain = { isBilled: false, invoiceId: null };

  it("trækker en utrukket post fra auto-kortet", async () => {
    expect(
      await resolveAutoPrepaidForUpdate(asCaller, plain, { clientId: "c1" }),
    ).toBe("gammelt");
  });

  it("beholder et eksisterende træk på kundens kort", async () => {
    expect(
      await resolveAutoPrepaidForUpdate(
        asCaller,
        {
          ...plain,
          isPrepaid: true,
          prepaidPackageId: "nyt",
          prepaidPackage: { clientId: "c1" },
        },
        { clientId: "c1" },
      ),
    ).toBeUndefined();
    expect(caller.prepaid.getActiveForClient).not.toHaveBeenCalled();
  });

  it("flytter trækket når posten skifter kunde", async () => {
    expect(
      await resolveAutoPrepaidForUpdate(
        asCaller,
        {
          ...plain,
          isPrepaid: true,
          prepaidPackageId: "andet",
          prepaidPackage: { clientId: "c-gammel" },
        },
        { clientId: "c1" },
      ),
    ).toBe("gammelt");
  });

  it("rører ikke fakturerede poster (#717)", async () => {
    expect(
      await resolveAutoPrepaidForUpdate(
        asCaller,
        { isBilled: true, invoiceId: null },
        { clientId: "c1" },
      ),
    ).toBeUndefined();
    expect(
      await resolveAutoPrepaidForUpdate(
        asCaller,
        { isBilled: false, invoiceId: "inv-1" },
        { clientId: "c1" },
      ),
    ).toBeUndefined();
    expect(caller.prepaid.getActiveForClient).not.toHaveBeenCalled();
  });

  it("lader trækket være når kunden intet auto-kort har", async () => {
    caller.prepaid.getActiveForClient.mockResolvedValue([]);
    expect(
      await resolveAutoPrepaidForUpdate(asCaller, plain, { clientId: "c1" }),
    ).toBeUndefined();
  });
});
