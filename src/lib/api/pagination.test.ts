import { describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE, parsePagination } from "./http";

function params(query: string) {
  return new URLSearchParams(query);
}

describe("parsePagination", () => {
  it("bruger standardværdier når intet er angivet", () => {
    const result = parsePagination(params(""));
    expect(result).toEqual({ page: 1, limit: 25 });
  });

  it("accepterer en limit op til loftet", () => {
    expect(parsePagination(params(`limit=${MAX_PAGE_SIZE}`))).toEqual({
      page: 1,
      limit: MAX_PAGE_SIZE,
    });
    expect(parsePagination(params("limit=50&page=3"))).toEqual({
      page: 3,
      limit: 50,
    });
  });

  it("afviser en limit over loftet i stedet for at kappe den tavst", async () => {
    const result = parsePagination(params("limit=500"));
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;

    expect(result.error.status).toBe(400);
    const body = await result.error.json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toContain(String(MAX_PAGE_SIZE));
  });

  // Grænsen præcist: en >= i stedet for > ville gøre det dokumenterede
  // maksimum til en fejl, og de eksisterende klienter sender netop 100.
  it("accepterer præcis loftet og afviser ét mere", () => {
    expect(parsePagination(params(`limit=${MAX_PAGE_SIZE}`))).toEqual({
      page: 1,
      limit: MAX_PAGE_SIZE,
    });
    expect(
      "error" in parsePagination(params(`limit=${MAX_PAGE_SIZE + 1}`)),
    ).toBe(true);
  });

  it("falder tilbage til standard ved ugyldige værdier", () => {
    expect(parsePagination(params("limit=abc"))).toEqual({
      page: 1,
      limit: 25,
    });
    expect(parsePagination(params("limit=0"))).toEqual({ page: 1, limit: 25 });
    expect(parsePagination(params("limit=-5"))).toEqual({ page: 1, limit: 25 });
    expect(parsePagination(params("page=0"))).toEqual({ page: 1, limit: 25 });
    expect(parsePagination(params("page=xyz"))).toEqual({ page: 1, limit: 25 });
  });
});
