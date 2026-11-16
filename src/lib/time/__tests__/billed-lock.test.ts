import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import {
  assertBilledPatchAllowed,
  assertEntryNotBilled,
  assertNoEntriesBilled,
  isBilledLocked,
  lockedFieldChanges,
} from "../billed-lock";

const onInvoice = {
  isBilled: true,
  invoiceId: "inv-1",
  hours: "1.50",
  date: new Date("2026-09-15T00:00:00Z"),
  description: "Arbejde",
  notes: null,
  billableRate: "800.00",
  isBillable: true,
  projectId: "p-1",
  clientId: null,
  startTime: new Date("2026-09-15T08:00:00Z"),
};
const manual = { ...onInvoice, invoiceId: null };
const open = { ...onInvoice, isBilled: false, invoiceId: null };

function forbidden(fn: () => void): TRPCError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(TRPCError);
    expect((e as TRPCError).code).toBe("FORBIDDEN");
    return e as TRPCError;
  }
  throw new Error("forventede FORBIDDEN");
}

describe("isBilledLocked", () => {
  it("låser poster der er faktureret eller hænger på en faktura", () => {
    expect(isBilledLocked(onInvoice)).toBe(true);
    expect(isBilledLocked(manual)).toBe(true);
    expect(isBilledLocked({ isBilled: false, invoiceId: "inv-1" })).toBe(true);
    expect(isBilledLocked(open)).toBe(false);
    expect(isBilledLocked({ isBilled: null })).toBe(false);
  });
});

describe("assertEntryNotBilled", () => {
  it("peger på kreditering når posten står på en faktura", () => {
    const err = forbidden(() => assertEntryNotBilled(onInvoice));
    expect(err.message).toContain("Kreditér fakturaen");
  });

  it("peger på markeringen når posten er manuelt markeret", () => {
    const err = forbidden(() => assertEntryNotBilled(manual));
    expect(err.message).toContain("Fjern markeringen");
  });

  it("lader ufakturerede poster passere", () => {
    expect(() => assertEntryNotBilled(open)).not.toThrow();
  });
});

describe("assertNoEntriesBilled", () => {
  it("afviser hele bulk-handlingen og tæller de låste", () => {
    const err = forbidden(() =>
      assertNoEntriesBilled([open, onInvoice, manual], "slettes"),
    );
    expect(err.message).toMatch(/^2 af de valgte tidsposter/);
    expect(err.message).toContain("slettes");
  });

  it("bruger enkeltpostens besked ved én post", () => {
    const err = forbidden(() => assertNoEntriesBilled([onInvoice], "slettes"));
    expect(err.message).toContain("Kreditér fakturaen");
  });

  it("passerer når ingen er faktureret", () => {
    expect(() => assertNoEntriesBilled([open, open], "flyttes")).not.toThrow();
  });
});

describe("lockedFieldChanges", () => {
  it("ignorerer uændrede værdier i anden form", () => {
    expect(
      lockedFieldChanges(onInvoice, {
        hours: 1.5,
        date: "2026-09-15",
        billableRate: 800,
        isBillable: 1,
        projectId: "p-1",
        clientId: null,
        description: "Arbejde",
        startTime: "2026-09-15T08:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("læser NULL i boolean-kolonner som kolonnens default", () => {
    const legacy = { ...onInvoice, isBilled: null, isBillable: null };
    expect(
      lockedFieldChanges(legacy, { isBilled: false, isBillable: true }),
    ).toEqual([]);
    expect(lockedFieldChanges(legacy, { isBillable: false })).toEqual([
      "isBillable",
    ]);
  });

  it("runder timer til to decimaler som databasen (h:m:s-formularen)", () => {
    expect(lockedFieldChanges(onInvoice, { hours: 1.5 + 1 / 3600 })).toEqual(
      [],
    );
  });

  it("finder ændrede låste felter", () => {
    expect(
      lockedFieldChanges(onInvoice, {
        hours: 2,
        date: "2026-09-16",
        clientId: "c-2",
        startTime: "2026-09-15T09:00:00.000Z",
      }),
    ).toEqual(["hours", "date", "clientId", "startTime"]);
  });

  it("tillader noten og ignorerer felter der ikke er sendt", () => {
    expect(
      lockedFieldChanges(onInvoice, {
        notes: "Intern note",
        updatedAt: new Date(),
        hours: undefined,
      }),
    ).toEqual([]);
  });
});

describe("assertBilledPatchAllowed", () => {
  it("afviser ændring af timer på en faktureret post", () => {
    forbidden(() => assertBilledPatchAllowed(onInvoice, { hours: 3 }));
  });

  it("tillader kun-note-ændringer", () => {
    expect(() =>
      assertBilledPatchAllowed(onInvoice, { notes: "ny", hours: 1.5 }),
    ).not.toThrow();
  });

  it("tillader at fjerne en manuel markering sammen med rettelser", () => {
    expect(() =>
      assertBilledPatchAllowed(manual, { isBilled: false, hours: 3 }),
    ).not.toThrow();
  });

  it("frigiver ikke en post på en faktura ved at fjerne markeringen", () => {
    forbidden(() =>
      assertBilledPatchAllowed(onInvoice, { isBilled: false, hours: 3 }),
    );
    forbidden(() => assertBilledPatchAllowed(onInvoice, { invoiceId: null }));
  });

  it("lader ufakturerede poster ændres frit, også til faktureret", () => {
    expect(() =>
      assertBilledPatchAllowed(open, {
        hours: 9,
        isBilled: true,
        invoiceId: "inv-2",
      }),
    ).not.toThrow();
  });
});
