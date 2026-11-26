import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { entryBelongsToClient } from "../client-scope";

const dialect = new PgDialect();
const CLIENT_ID = "00000000-0000-4000-8000-0000000000c1";

describe("entryBelongsToClient", () => {
  it("matcher både direkte kunde og poster på kundens projekter (samme regel som kundesiden)", () => {
    const { sql, params } = dialect.sqlToQuery(entryBelongsToClient(CLIENT_ID));
    expect(sql).toContain('"time_entries"."client_id" = $1');
    expect(sql).toMatch(
      /"time_entries"\."project_id" = any\(array\(select "scope_p"\."id" from "projects" "scope_p" where "scope_p"\."client_id" = \$2\)\)/i,
    );
    expect(params).toEqual([CLIENT_ID, CLIENT_ID]);
  });

  it("holder projekt-grenen indekserbar (ingen IN-subquery)", () => {
    // `project_id IN (subquery)` bliver en hashed SubPlan, som Postgres kun
    // kan bruge som filter: kundesiden læste så alle organisationens poster
    // for at finde kundens. `= ANY(ARRAY(subquery))` er en InitPlan med et
    // array, så begge grene kan gå gennem deres indeks (BitmapOr).
    const { sql } = dialect.sqlToQuery(entryBelongsToClient(CLIENT_ID));
    expect(sql).not.toMatch(/"project_id" in \(/i);
  });
});
