import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { timeEntries } from "@/lib/db/schema";
import {
  dateUpperBound,
  endOfDayExclusive,
  isDateOnlyString,
  startOfNextDay,
} from "../date-bounds";

const dialect = new PgDialect();
const render = (expr: Parameters<typeof dialect.sqlToQuery>[0]) =>
  dialect.sqlToQuery(expr);

describe("isDateOnlyString", () => {
  it("genkender en ren dato", () => {
    expect(isDateOnlyString("2026-09-26")).toBe(true);
  });

  it("afviser tidsstempler og andet", () => {
    expect(isDateOnlyString("2026-09-26T23:59:59.999Z")).toBe(false);
    expect(isDateOnlyString("26-09-2026")).toBe(false);
    expect(isDateOnlyString("")).toBe(false);
  });
});

describe("endOfDayExclusive", () => {
  it("giver starten af næste UTC-dag", () => {
    expect(endOfDayExclusive("2026-09-26").toISOString()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
  });

  it("ruller over måned og år", () => {
    expect(endOfDayExclusive("2026-02-28").toISOString()).toBe(
      "2026-03-01T00:00:00.000Z",
    );
    expect(endOfDayExclusive("2026-12-31").toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("dækker en post kl. 07:00 på sidste dag — det gamle lte(midnat) gjorde ikke", () => {
    const entryAt7 = new Date("2026-09-26T07:00:00.000Z");
    const oldBound = new Date("2026-09-26");
    expect(entryAt7 <= oldBound).toBe(false);
    expect(entryAt7 < endOfDayExclusive("2026-09-26")).toBe(true);
  });

  it("udelukker næste dags midnatspost", () => {
    const nextDay = new Date("2026-09-27");
    expect(nextDay < endOfDayExclusive("2026-09-26")).toBe(false);
  });

  it("kaster på andet end yyyy-MM-dd", () => {
    expect(() => endOfDayExclusive("2026-09-26T00:00:00Z")).toThrow();
  });
});

describe("startOfNextDay", () => {
  it("giver lokal midnat dagen efter en lokal midnat", () => {
    expect(startOfNextDay(new Date(2026, 8, 30))).toEqual(new Date(2026, 9, 1));
  });

  it("er uændret for kaldere der allerede sender slutningen af dagen", () => {
    expect(startOfNextDay(new Date(2026, 8, 26, 23, 59, 59, 999))).toEqual(
      startOfNextDay(new Date(2026, 8, 26)),
    );
  });

  it("ruller over årsskiftet", () => {
    expect(startOfNextDay(new Date(2026, 11, 31))).toEqual(
      new Date(2027, 0, 1),
    );
  });
});

describe("dateUpperBound", () => {
  it("bruger eksklusiv grænse på næste dag for en ren dato", () => {
    const { sql, params } = render(
      dateUpperBound(timeEntries.date, "2026-09-26"),
    );
    expect(sql).toBe('"time_entries"."date" < $1');
    expect(params).toEqual(["2026-09-27T00:00:00.000Z"]);
  });

  it("respekterer et fuldt tidsstempel som inklusiv grænse (uændret adfærd)", () => {
    const { sql, params } = render(
      dateUpperBound(timeEntries.date, "2026-09-26T21:59:59.999Z"),
    );
    expect(sql).toBe('"time_entries"."date" <= $1');
    expect(params).toEqual(["2026-09-26T21:59:59.999Z"]);
  });
});
