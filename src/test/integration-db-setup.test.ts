import { describe, expect, it } from "vitest";
import { writtenTables } from "./integration-db-setup";

describe("writtenTables", () => {
  it("finder tabeller, hvis skrivetællere er steget under kørslen", () => {
    const before = new Map([
      ["clients", 4],
      ["user", 10],
    ]);
    const after = new Map([
      ["clients", 4],
      ["user", 12],
      ["time_entries", 1],
    ]);

    expect(writtenTables(before, after)).toEqual(["time_entries", "user"]);
  });

  it("er tom, når intet er skrevet", () => {
    const counts = new Map([["clients", 4]]);
    expect(writtenTables(counts, new Map(counts))).toEqual([]);
  });
});
