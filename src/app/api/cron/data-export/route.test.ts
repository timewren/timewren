import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  updateWheres: [] as unknown[],
  findWheres: [] as unknown[],
  legacyGenerated: 0,
}));

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, fn: unknown) => fn,
}));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: async (cond: unknown) => {
          state.updateWheres.push(cond);
        },
      }),
    }),
    query: {
      dataExportRequests: {
        findMany: async (args: { where: unknown }) => {
          state.findWheres.push(args.where);
          return [];
        },
      },
    },
  },
}));
vi.mock("@/lib/export/org-export/job", () => ({
  processOrgExports: async () => ({
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  }),
}));
vi.mock("@/lib/utils/data-export", () => ({
  generateUserDataExport: async () => {
    state.legacyGenerated++;
    return {};
  },
}));
vi.mock("@/lib/email/data-export", () => ({ sendDataExportReady: vi.fn() }));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));

import { GET } from "./route";

const dialect = new PgDialect();
const render = (where: unknown) =>
  dialect.sqlToQuery(where as Parameters<PgDialect["sqlToQuery"]>[0]);

describe("cron /api/cron/data-export: den gamle eksport rører aldrig ZIP-eksporterne", () => {
  beforeEach(() => {
    state.updateWheres = [];
    state.findWheres = [];
    state.legacyGenerated = 0;
  });

  it("udløb og afventende i den gamle gren udelukker både org_full og user_full", async () => {
    await (GET as unknown as (r: Request) => Promise<unknown>)(
      new Request("http://localhost/api/cron/data-export"),
    );
    expect(state.updateWheres).toHaveLength(1);
    expect(state.findWheres).toHaveLength(1);
    for (const where of [state.updateWheres[0], state.findWheres[0]]) {
      const q = render(where);
      // Præcis "request_type not in (org_full, user_full)": ellers ville en
      // ventende bruger-eksport blive bygget af den gamle, uafgrænsede kode.
      expect(q.sql).toContain('"request_type" not in (');
      expect(q.params).toEqual(
        expect.arrayContaining(["org_full", "user_full"]),
      );
    }
    expect(state.legacyGenerated).toBe(0);
  });
});
