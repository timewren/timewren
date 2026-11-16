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
      /"time_entries"\."project_id" in \(select "projects"\."id" from "projects" where "projects"\."client_id" = \$2\)/i,
    );
    expect(params).toEqual([CLIENT_ID, CLIENT_ID]);
  });
});
