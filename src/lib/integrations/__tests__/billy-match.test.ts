import { describe, expect, it } from "vitest";
import {
  type AmbiguousMatch,
  billyInvoiceIsPaid,
  matchUnlinkedInvoices,
  toIsoDate,
} from "../billy-match";

// Tallene er de rigtige fra prod 16/9-2026 (INV-057/058/059 mod Billy
// 179/180/182), så testen dokumenterer præcis det tilfælde der fejlede.
const billy = [
  {
    id: "b179",
    invoiceNo: 179,
    state: "approved",
    entryDate: "2026-07-31",
    amount: 15869.5,
    isPaid: true,
    balance: 0,
  },
  {
    id: "b180",
    invoiceNo: 180,
    state: "approved",
    entryDate: "2026-08-31",
    amount: 12537.5,
    isPaid: true,
    balance: 0,
  },
  {
    id: "b182",
    invoiceNo: 182,
    state: "approved",
    entryDate: "2026-09-01",
    amount: 3000,
    isPaid: false,
    balance: 3750,
  },
  {
    id: "b-draft",
    invoiceNo: null,
    state: "draft",
    entryDate: "2026-09-01",
    amount: 4050,
    isPaid: false,
    balance: 5062.5,
  },
];

describe("matchUnlinkedInvoices", () => {
  it("kobler på dato + nettobeløb og tager betalingsstatus med", () => {
    const local = [
      {
        id: "l57",
        invoiceNumber: "INV-057",
        issueDate: new Date("2026-07-31T00:00:00Z"),
        amount: "15869.50",
      },
      {
        id: "l58",
        invoiceNumber: "INV-058",
        issueDate: "2026-08-31T00:00:00.000Z",
        amount: "12537.50",
      },
      {
        id: "l59",
        invoiceNumber: "INV-059",
        issueDate: new Date("2026-09-01T00:00:00Z"),
        amount: 3000,
      },
    ];
    const m = matchUnlinkedInvoices(local, billy);
    expect(m.map((x) => [x.invoiceNumber, x.billyId, x.isPaid])).toEqual([
      ["INV-057", "b179", true],
      ["INV-058", "b180", true],
      ["INV-059", "b182", false],
    ]);
  });

  it("kobler ikke når to Billy-fakturaer har samme dato og beløb", () => {
    const twin = [
      {
        id: "x1",
        invoiceNo: 1,
        state: "approved",
        entryDate: "2026-09-01",
        amount: 300,
        isPaid: true,
      },
      {
        id: "x2",
        invoiceNo: 2,
        state: "approved",
        entryDate: "2026-09-01",
        amount: 300,
        isPaid: true,
      },
    ];
    const m = matchUnlinkedInvoices(
      [
        {
          id: "l",
          invoiceNumber: "INV-1",
          issueDate: "2026-09-01",
          amount: "300",
        },
      ],
      twin,
    );
    expect(m).toEqual([]);
  });

  it("springer kladder, annullerede og beløb der ikke stemmer over", () => {
    const m = matchUnlinkedInvoices(
      [
        {
          id: "a",
          invoiceNumber: "A",
          issueDate: "2026-09-01",
          amount: "4050",
        },
        {
          id: "b",
          invoiceNumber: "B",
          issueDate: "2026-09-01",
          amount: "3000.01",
        },
      ],
      [
        ...billy,
        { id: "void", state: "voided", entryDate: "2026-09-01", amount: 4050 },
      ],
    );
    expect(m).toEqual([]);
  });

  it("kobler intet når to TimeTrack-fakturaer deler samme Billy-kandidat", () => {
    const ambiguous: AmbiguousMatch[] = [];
    const m = matchUnlinkedInvoices(
      [
        {
          id: "a",
          invoiceNumber: "A",
          issueDate: "2026-09-01",
          amount: "3000",
        },
        {
          id: "b",
          invoiceNumber: "B",
          issueDate: "2026-09-01",
          amount: "3000",
        },
      ],
      billy,
      ambiguous,
    );
    expect(m).toEqual([]);
    expect(ambiguous.map((a) => a.invoiceNumber)).toEqual(["A", "B"]);
  });

  it("bruger Billy-kontakten som tie-breaker ved flere kandidater", () => {
    const twins = [
      {
        id: "x1",
        state: "approved",
        entryDate: "2026-09-01",
        amount: 300,
        contactId: "c1",
      },
      {
        id: "x2",
        state: "approved",
        entryDate: "2026-09-01",
        amount: 300,
        contactId: "c2",
      },
    ];
    const m = matchUnlinkedInvoices(
      [
        {
          id: "l",
          invoiceNumber: "INV-1",
          issueDate: "2026-09-01",
          amount: "300",
          billyContactId: "c2",
        },
      ],
      twins,
    );
    expect(m.map((x) => x.billyId)).toEqual(["x2"]);
  });

  it("springer kreditnotaer og fremmed valuta over", () => {
    const m = matchUnlinkedInvoices(
      [
        {
          id: "l",
          invoiceNumber: "INV-1",
          issueDate: "2026-09-01",
          amount: "300",
        },
      ],
      [
        {
          id: "k",
          type: "creditNote",
          state: "approved",
          entryDate: "2026-09-01",
          amount: 300,
        },
        {
          id: "e",
          currencyId: "EUR",
          state: "approved",
          entryDate: "2026-09-01",
          amount: 300,
        },
      ],
    );
    expect(m).toEqual([]);
  });
});

describe("billyInvoiceIsPaid", () => {
  it("stoler på Billy's isPaid og ellers balance 0 på godkendt faktura", () => {
    expect(
      billyInvoiceIsPaid({ state: "approved", entryDate: "", isPaid: true }),
    ).toBe(true);
    expect(
      billyInvoiceIsPaid({ state: "approved", entryDate: "", balance: 0 }),
    ).toBe(true);
    expect(
      billyInvoiceIsPaid({ state: "approved", entryDate: "", balance: 12 }),
    ).toBe(false);
    // Manglende balance må ikke læses som "betalt"
    expect(billyInvoiceIsPaid({ state: "approved", entryDate: "" })).toBe(
      false,
    );
    expect(
      billyInvoiceIsPaid({ state: "draft", entryDate: "", balance: 0 }),
    ).toBe(false);
  });
});

describe("toIsoDate", () => {
  it("giver datoen som Billy skriver den", () => {
    expect(toIsoDate(new Date("2026-08-31T00:00:00Z"))).toBe("2026-08-31");
    expect(toIsoDate("2026-07-31T00:00:00.000Z")).toBe("2026-07-31");
  });
});
