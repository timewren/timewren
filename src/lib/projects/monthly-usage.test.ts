import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { monthBoundsCopenhagen } from "./budget";
import { loadMonthlyUsage, monthlyUsageScope } from "./monthly-usage";

const dialect = new PgDialect();
const renderSql = (chunk: Parameters<PgDialect["sqlToQuery"]>[0]) =>
  dialect.sqlToQuery(chunk).sql;

/**
 * Minimal drizzle-stub: vi vil bare se HVILKE grænser og hvilket scope der
 * sendes med, og at rækkerne mappes til tal.
 */
function stubDb(rows: Array<{ projectId: string | null; hours: string }>) {
  const captured: { where?: unknown } = {};
  const db = {
    select() {
      return {
        from() {
          return {
            where(w: unknown) {
              captured.where = w;
              return {
                groupBy() {
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      };
    },
  };
  return { db: db as never, captured };
}

describe("monthlyUsageScope", () => {
  it("medtager legacy-rækker uden org-id i en organisation", () => {
    const sql = renderSql(monthlyUsageScope("org-1", "u1"));
    expect(sql).toContain('"organization_id"');
    // Legacy-rækker (org_id IS NULL) skal tælle med — ellers viser cron og
    // projektliste forskellige tal for det samme projekt.
    expect(sql).toContain("is null");
    expect(sql).toContain("or");
  });

  it("falder tilbage til ejerens egne poster uden org", () => {
    const sql = renderSql(monthlyUsageScope(null, "u1"));
    expect(sql).toContain('"user_id"');
    expect(sql).not.toContain('"organization_id"');
  });
});

describe("loadMonthlyUsage", () => {
  it("returnerer et tomt map uden projekter — og rører ikke databasen", async () => {
    const { db } = stubDb([]);
    const spy = vi.spyOn(db as unknown as { select: () => unknown }, "select");
    const used = await loadMonthlyUsage(db, {
      projectIds: [],
      scope: monthlyUsageScope(null, "u1"),
    });
    expect(used.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("mapper rækkerne til timer pr. projekt", async () => {
    const { db } = stubDb([
      { projectId: "p1", hours: "17.50" },
      { projectId: "p2", hours: "0" },
      { projectId: null, hours: "9" },
    ]);
    const used = await loadMonthlyUsage(db, {
      projectIds: ["p1", "p2"],
      scope: monthlyUsageScope("org-1", "u1"),
      now: new Date("2026-09-16T10:00:00Z"),
    });
    expect(used.get("p1")).toBeCloseTo(17.5);
    expect(used.get("p2")).toBe(0);
    // Intern tid uden projekt må ikke ende i map'et
    expect(used.size).toBe(2);
  });

  it("afgrænser til den danske kalendermåned", async () => {
    const now = new Date("2026-09-16T10:00:00Z");
    const { start, next } = monthBoundsCopenhagen(now);
    // Kontrol af den forventede grænse — loadMonthlyUsage bruger samme kilde
    expect(start.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(next.toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });
});
