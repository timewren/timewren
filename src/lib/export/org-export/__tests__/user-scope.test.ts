import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { USER_EXPORT_TABLES } from "../user-registry";
import { userScopeCondition } from "../user-scope";

const dialect = new PgDialect();
const ORG_X = "org-X";
const ORG_Y = "org-Y";
const ANNA = "user-anna";

function render(key: string, orgId: string | null, userId = ANNA) {
  const entry = USER_EXPORT_TABLES.find((e) => e.key === key)!;
  const cond = userScopeCondition(entry, { orgId, userId });
  return cond ? dialect.sqlToQuery(cond) : null;
}

describe("bruger-eksport: scoping på brugerens egne rækker i den aktive organisation", () => {
  it("hver tabel med organisation er låst til BÅDE org og bruger, og intet andet", () => {
    for (const entry of USER_EXPORT_TABLES) {
      if (entry.scope.kind !== "own") continue;
      const q = render(entry.key, ORG_X)!;
      expect(q, entry.key).not.toBeNull();
      // Kun to værdier: organisationen og brugeren, og ingen "eller sand".
      expect([...new Set(q.params)].sort(), entry.key).toEqual(
        [ANNA, ORG_X].sort(),
      );
      expect(q.sql, entry.key).toContain('"organization_id" = $');
      expect(q.sql, entry.key).not.toMatch(/ or true| 1 = 1/i);
    }
  });

  it("almindelige tabeller henter kun rækker, hvor user_id er brugeren", () => {
    const q = render("timeEntries", ORG_X)!;
    expect(q.sql).toBe(
      '("time_entries"."organization_id" = $1 and "time_entries"."user_id" = $2)',
    );
    expect(q.params).toEqual([ORG_X, ANNA]);
  });

  it("samme bruger i to organisationer får kun rækkerne fra den aktive", () => {
    const x = render("absenceRequests", ORG_X)!;
    const y = render("absenceRequests", ORG_Y)!;
    expect(x.params).toEqual([ORG_X, ANNA]);
    expect(y.params).toEqual([ORG_Y, ANNA]);
    expect(x.sql).toBe(y.sql);
  });

  it("en kollega får aldrig brugerens rækker: bruger-id'et er altid et parameter", () => {
    const colleague = render("timeEntries", ORG_X, "user-bo")!;
    expect(colleague.params).toEqual([ORG_X, "user-bo"]);
    expect(colleague.params).not.toContain(ANNA);
  });

  it("uden organisation er det kun rækker uden organisation (ingen rækker fra en org, man er gået ud af)", () => {
    for (const entry of USER_EXPORT_TABLES) {
      if (entry.scope.kind !== "own") continue;
      const q = render(entry.key, null)!;
      expect([...new Set(q.params)], entry.key).toEqual([ANNA]);
      expect(q.sql, entry.key).toContain('"organization_id" is null');
    }
  });

  it("opgaver: dem brugeren har oprettet eller fået tildelt, kun i den aktive org", () => {
    const q = render("tasks", ORG_X)!;
    expect(q.sql).toBe(
      '("tasks"."organization_id" = $1 and ("tasks"."user_id" = $2 or "tasks"."assigned_to_user_id" = $3))',
    );
    expect(q.params).toEqual([ORG_X, ANNA, ANNA]);
  });

  it("hændelsesloggen er kun poster, der handler om brugeren (ikke admin-handlinger over kolleger)", () => {
    const q = render("orgAuditLogs", ORG_X)!;
    expect(q.sql).toContain('"org_audit_logs"."target_user_id" = $2');
    expect(q.sql).not.toContain("actor_id");
    expect(q.params).toEqual([ORG_X, ANNA]);
  });

  it("børnetabeller hentes kun via forælderens egne rækker", () => {
    const q = render("timeEntrySegments", ORG_X)!;
    expect(q.sql).toBe(
      '"time_entry_segments"."time_entry_id" in (select "time_entries"."id" from "time_entries" where ("time_entries"."organization_id" = $1 and "time_entries"."user_id" = $2))',
    );
    expect(q.params).toEqual([ORG_X, ANNA]);
  });

  it("opgave-vedhæftninger: dem brugeren selv har lagt på opgaver i org'en", () => {
    const q = render("taskAttachments", ORG_X)!;
    expect(q.sql).toBe(
      '("task_attachments"."user_id" = $1 and "task_attachments"."task_id" in (select "tasks"."id" from "tasks" where "tasks"."organization_id" = $2))',
    );
    expect(q.params).toEqual([ANNA, ORG_X]);
  });

  it("medlemsnøglede tabeller (timepriser, kundeadgang) går via brugerens egen medlemsrække i org'en", () => {
    for (const key of ["memberRates", "memberClientAccess"]) {
      const q = render(key, ORG_X)!;
      expect(q.sql, key).toContain(
        'in (select "members"."id" from "members" where "members"."user_id" = $1 and "members"."organization_id" = $2)',
      );
      expect(q.params, key).toEqual([ANNA, ORG_X]);
      expect(render(key, null), key).toBeNull();
    }
  });

  it("profilen er brugerens egen række og organisationen er den aktive", () => {
    expect(render("users", ORG_X)!.params).toEqual([ANNA]);
    expect(render("organizations", ORG_X)!.params).toEqual([ORG_X]);
    expect(render("organizations", null)).toBeNull();
  });

  it("personlige tabeller uden organisation er kun brugerens egne", () => {
    for (const key of ["desktopDevices", "desktopLicenses"]) {
      const q = render(key, ORG_X)!;
      expect(q.params, key).toEqual([ANNA]);
      expect(q.sql, key).not.toContain("organization_id");
    }
  });

  it("alle tabeller har en betingelse med brugerens id (eller org-id for organisationen)", () => {
    for (const entry of USER_EXPORT_TABLES) {
      const q = render(entry.key, ORG_X);
      expect(q, entry.key).not.toBeNull();
      const needle = entry.scope.kind === "organization" ? ORG_X : ANNA;
      expect(q!.params, entry.key).toContain(needle);
    }
  });
});
