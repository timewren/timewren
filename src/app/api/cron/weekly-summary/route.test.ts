import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { users } from "@/lib/db/schema";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const h = vi.hoisted(() => ({
  usersSelect: undefined as unknown,
  usersWhere: undefined as unknown,
}));

// Brugerscanningen er det eneste, der testes her: ingen brugere returneres.
vi.mock("@/lib/db", () => {
  const chain = () => {
    const c: Promise<unknown> & Record<string, unknown> = Object.assign(
      Promise.resolve([]),
      {} as Record<string, unknown>,
    );
    for (const m of ["leftJoin", "orderBy", "limit"]) c[m] = () => c;
    c.where = (w: unknown) => {
      h.usersWhere = w;
      return c;
    };
    return c;
  };
  return {
    db: {
      select: (fields: unknown) => ({
        from: (t: unknown) => {
          if (t === users) h.usersSelect = fields;
          return chain();
        },
      }),
    },
  };
});

import { GET } from "./route";

describe("weekly-summary cron: brugerscanningen (#1115)", () => {
  it("henter kun de brugerkolonner, cronen bruger — ingen credentials", async () => {
    await (GET as unknown as (r: Request) => Promise<unknown>)(
      new Request("http://localhost/api/cron/weekly-summary"),
    );
    const fields = h.usersSelect as { user: Record<string, unknown> };
    expect(Object.keys(fields.user).sort()).toEqual([
      "email",
      "id",
      "locale",
      "name",
      "timezone",
    ]);
  });
});

describe("weekly-summary cron: fravalg filtreres i SQL", () => {
  it("udelukker kun brugere, der har slået ugerapporten fra (ingen præferencer tæller som til)", async () => {
    await (GET as unknown as (r: Request) => Promise<unknown>)(
      new Request("http://localhost/api/cron/weekly-summary"),
    );
    expect(h.usersWhere).toBeDefined();
    const { sql } = new PgDialect().sqlToQuery(h.usersWhere as SQL);
    expect(sql).toContain('"email_preferences"."user_id" is null');
    expect(sql).toContain('"email_preferences"."weekly_report" <> $');
  });
});
