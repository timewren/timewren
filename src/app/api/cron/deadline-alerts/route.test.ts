import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { users } from "@/lib/db/schema";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const h = vi.hoisted(() => ({
  usersWhere: undefined as unknown,
}));

// Brugerscanningen er det eneste, der testes her: ingen brugere returneres.
vi.mock("@/lib/db", () => {
  const chain = (isUsers: boolean) => {
    const c: Promise<unknown> & Record<string, unknown> = Object.assign(
      Promise.resolve([]),
      {} as Record<string, unknown>,
    );
    for (const m of ["leftJoin", "orderBy", "limit"]) c[m] = () => c;
    c.where = (w: unknown) => {
      if (isUsers) h.usersWhere = w;
      return c;
    };
    return c;
  };
  return {
    db: {
      select: () => ({
        from: (t: unknown) => chain(t === users),
      }),
    },
  };
});
vi.mock("@/lib/notifications", async (orig) => ({
  ...(await orig<typeof import("@/lib/notifications")>()),
  getQuietHoursPrefs: async () => new Map(),
}));

import { GET } from "./route";

describe("deadline-alerts cron: brugerscanningen (#1115)", () => {
  it("udelukker i SQL brugere uden en aktiv notifikationskanal", async () => {
    await (GET as unknown as (r: Request) => Promise<unknown>)(
      new Request("http://localhost/api/cron/deadline-alerts"),
    );
    expect(h.usersWhere).toBeDefined();
    const { sql } = new PgDialect().sqlToQuery(h.usersWhere as SQL);
    expect(sql).toMatch(/exists \(select 1 from "notification_channels"/i);
    expect(sql).toContain('"notification_channels"."is_enabled" = true');
  });
});
