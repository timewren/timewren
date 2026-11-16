import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ORG_EXPORT_TABLES } from "../registry";
import { scopeCondition } from "../scope";

const dialect = new PgDialect();
const ORG_A = "org-A";
const USER = "user-1";

function render(key: string, orgId: string | null) {
  const entry = ORG_EXPORT_TABLES.find((e) => e.key === key)!;
  const cond = scopeCondition(entry, { orgId, userId: USER });
  return cond ? dialect.sqlToQuery(cond) : null;
}

describe("organisations-eksport: scoping", () => {
  it("hver tabel scopes på organisationens id og intet andet, når der er en org", () => {
    for (const entry of ORG_EXPORT_TABLES) {
      const q = render(entry.key, ORG_A);
      expect(q, entry.key).not.toBeNull();
      // Org-id'et er den eneste parameter: ingen bruger-id-fallback blandes ind.
      expect(q!.params, entry.key).toEqual([ORG_A]);
      if (entry.scope.kind === "org" || entry.scope.kind === "parent") {
        expect(q!.sql, entry.key).toContain('"organization_id" = $1');
      }
    }
  });

  it("børnetabeller hentes kun via forælderens org-scopede id'er", () => {
    const q = render("invoiceLines", ORG_A)!;
    expect(q.sql).toBe(
      '"invoice_lines"."invoice_id" in (select "invoices"."id" from "invoices" where "invoices"."organization_id" = $1)',
    );
    const att = render("taskAttachments", ORG_A)!;
    expect(att.sql).toContain('"tasks"."organization_id" = $1');
  });

  it("brugere er kun medlemmer af organisationen", () => {
    const q = render("users", ORG_A)!;
    expect(q.sql).toBe(
      '"user"."id" in (select "members"."user_id" from "members" where "members"."organization_id" = $1)',
    );
    expect(q.params).toEqual([ORG_A]);
  });

  it("uden organisation får en solo-bruger kun sine egne rækker", () => {
    for (const entry of ORG_EXPORT_TABLES) {
      const q = render(entry.key, null);
      if (!q) continue; // tabeller uden user_id har ingen rækker for solo
      expect(q.params, entry.key).toEqual([USER]);
      expect(q.sql, entry.key).not.toContain("organization_id");
    }
    expect(render("organizations", null)).toBeNull();
    expect(render("timeEntries", null)!.sql).toBe(
      '"time_entries"."user_id" = $1',
    );
  });
});
