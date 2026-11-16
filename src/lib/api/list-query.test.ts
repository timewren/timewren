import { describe, expect, it } from "vitest";
import { paginationMeta } from "./http";
import {
  containsPattern,
  moreResultsHint,
  pageOffset,
  toInvoiceSortField,
} from "./list-query";

describe("pageOffset", () => {
  it("første side starter ved 0", () => {
    expect(pageOffset(1, 25)).toBe(0);
  });

  // Netop den manglende oversættelse fra page til offset var fejlen i #572 og
  // #573: uden den kunne en klient aldrig nå forbi første side i databasen.
  it("side 21 med 25 pr. side starter efter faktura nummer 500", () => {
    expect(pageOffset(21, 25)).toBe(500);
  });

  it("går aldrig under 0", () => {
    expect(pageOffset(0, 25)).toBe(0);
  });
});

describe("containsPattern", () => {
  it("omkranser søgningen med jokertegn", () => {
    expect(containsPattern("acme")).toBe("%acme%");
  });

  it("escaper % og _ så de matcher sig selv, som den gamle delstreng-søgning", () => {
    expect(containsPattern("50%_rabat")).toBe("%50\\%\\_rabat%");
  });

  it("escaper backslash", () => {
    expect(containsPattern("a\\b")).toBe("%a\\\\b%");
  });
});

describe("toInvoiceSortField", () => {
  it("oversætter det dokumenterede totalAmount til kolonnen amount", () => {
    expect(toInvoiceSortField("totalAmount")).toBe("amount");
    expect(toInvoiceSortField("amount")).toBe("amount");
  });

  it("sender kendte felter videre og falder tilbage til createdAt", () => {
    expect(toInvoiceSortField("status")).toBe("status");
    expect(toInvoiceSortField("dueDate")).toBe("dueDate");
    expect(toInvoiceSortField("createdAt")).toBe("createdAt");
    expect(toInvoiceSortField("hacker")).toBe("createdAt");
  });
});

describe("paginationMeta", () => {
  it("bevarer de eksisterende felter og fortæller om der er en næste side", () => {
    expect(paginationMeta(1, 25, 65)).toEqual({
      page: 1,
      limit: 25,
      total: 65,
      totalPages: 3,
      hasMore: true,
      nextPage: 2,
    });
  });

  it("sidste side har ingen næste", () => {
    expect(paginationMeta(3, 25, 65)).toMatchObject({
      hasMore: false,
      nextPage: null,
    });
  });

  it("en tom liste har ingen næste side", () => {
    expect(paginationMeta(1, 25, 0)).toMatchObject({
      totalPages: 0,
      hasMore: false,
      nextPage: null,
    });
  });
});

describe("moreResultsHint", () => {
  it("er null når alt er vist", () => {
    expect(moreResultsHint("invoices", 1, 500, 65, 65)).toBeNull();
    expect(moreResultsHint("invoices", 1, 500, 0, 0)).toBeNull();
  });

  // Det tavse kap: 500 vist, flere findes. Uden hintet kan en sprogmodel ikke
  // se forskel på "det var alt" og "her er første side".
  it("siger hvor mange der findes og hvilken side der er den næste", () => {
    const hint = moreResultsHint("invoices", 1, 500, 500, 731);
    expect(hint).toContain("1-500 of 731");
    expect(hint).toContain("page=2");
  });

  it("regner rigtigt på en senere side", () => {
    expect(moreResultsHint("clients", 2, 100, 100, 250)).toContain(
      "101-200 of 250",
    );
    expect(moreResultsHint("clients", 3, 100, 50, 250)).toBeNull();
  });
});
