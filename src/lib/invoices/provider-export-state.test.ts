import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import {
  canReleaseMissingProviderLink,
  getProviderEmailState,
  isDefiniteSendFailure,
  ProviderEmailUncertainError,
  releaseMissingProviderLink,
  resolveUncertainProviderEmail,
  sendProviderInvoiceEmail,
} from "./provider-export-state";

const dialect = new PgDialect();

/** Answers each findFirst with the next row, recording the WHERE clauses. */
function capturingDb(
  ...rows: (
    | { status?: string; metadata?: unknown; createdAt?: Date }
    | undefined
  )[]
) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const updates: { sql: string; params: unknown[] }[] = [];
  const db = {
    query: {
      integrationSyncLogs: {
        findFirst: async ({ where }: { where: SQL }) => {
          queries.push(dialect.sqlToQuery(where));
          return rows.shift();
        },
      },
    },
    update: () => ({
      set: () => ({
        where: (where: SQL) => {
          updates.push(dialect.sqlToQuery(where));
          return { returning: async () => [{ id: "inv-1" }] };
        },
      }),
    }),
  };
  return { db: db as never, queries, updates };
}

describe("getProviderEmailState", () => {
  it("scopes the log lookup to the invoice's organization and its members' older logs", async () => {
    const { db, queries } = capturingDb();
    await getProviderEmailState(
      db,
      "billy",
      { id: "inv-1", userId: "user-1", organizationId: "org-1" },
      "external",
    );
    expect(queries[0].sql).toContain('"organization_id" = $');
    expect(queries[0].params).toContain("org-1");
    expect(queries[0].params).not.toContain("user-1");
  });

  it("keeps the member columns in the subquery once the relational query aliases the log table", async () => {
    // The relational findFirst rewrites columns in its where clause to the
    // log table's alias; render the real query, not just the where clause.
    const mock = drizzle.mock({ schema });
    const logs = mock.query.integrationSyncLogs;
    let rendered = "";
    const db = {
      query: {
        integrationSyncLogs: {
          findFirst: async (config: Parameters<typeof logs.findFirst>[0]) => {
            rendered = logs.findFirst(config).toSQL().sql;
            return undefined;
          },
        },
      },
    };
    await getProviderEmailState(
      db as never,
      "billy",
      { id: "inv-1", userId: "user-1", organizationId: "org-1" },
      "external",
    );
    // Older export logs were stamped with the exporter's first membership.
    expect(rendered).toContain(
      '"integrationSyncLogs"."user_id" in (select "user_id" from "members" where "organization_id" = $',
    );
  });

  it("scopes a solo user's lookup to the owner", async () => {
    const { db, queries } = capturingDb();
    await getProviderEmailState(
      db,
      "dinero",
      { id: "inv-1", userId: "user-1", organizationId: null },
      null,
    );
    expect(queries[0].sql).toContain('"user_id" = $');
    expect(queries[0].params).toContain("user-1");
  });

  it.each([
    ["success", "sent"],
    ["partial", "uncertain"],
  ])("reports a %s attempt as %s", async (status, expected) => {
    const { db } = capturingDb({ status });
    await expect(
      getProviderEmailState(
        db,
        "billy",
        { id: "inv-1", userId: "user-1", organizationId: "org-1" },
        "external",
      ),
    ).resolves.toBe(expected);
  });
});

describe("canReleaseMissingProviderLink", () => {
  const invoice = { id: "inv-1", userId: "user-1", organizationId: "org-1" };
  const exportedAt = new Date("2026-01-01T12:00:00Z");
  const before = { updatedAt: new Date("2025-12-31T11:59:00Z") };
  // Changed while the export waited on the provider, before it was logged.
  const duringExport = { updatedAt: new Date("2026-01-01T11:59:00Z") };
  const after = { updatedAt: new Date("2026-02-01T12:00:00Z") };

  it("compares a logged account with the connected one, ignoring the contact", async () => {
    const clientContactExists = vi.fn(async () => true);
    for (const [current, expected] of [
      ["acc-1", true],
      ["acc-2", false],
    ] as const) {
      const { db } = capturingDb({ metadata: { accountId: "acc-1" } });
      await expect(
        canReleaseMissingProviderLink({
          database: db,
          provider: "billy",
          invoice,
          externalId: "external",
          currentAccountId: async () => current,
          client: before,
          clientContactExists,
        }),
      ).resolves.toBe(expected);
    }
    expect(clientContactExists).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "uses an unchanged client's contact for a link without a logged account (contact found: %s)",
    async (found) => {
      const { db, queries } = capturingDb(undefined, { createdAt: exportedAt });
      const currentAccountId = vi.fn(async () => "acc-1");
      await expect(
        canReleaseMissingProviderLink({
          database: db,
          provider: "dinero",
          invoice,
          externalId: "external",
          currentAccountId,
          client: before,
          clientContactExists: async () => found,
        }),
      ).resolves.toBe(found);
      expect(currentAccountId).not.toHaveBeenCalled();
      expect(queries[1].params).toContain("export_invoice");
      expect(
        queries[1].params.some(
          (p) =>
            typeof p === "string" &&
            p.includes('"dineroInvoiceGuid":"external"'),
        ),
      ).toBe(true);
    },
  );

  it.each([
    ["the client changed after the export", after, { createdAt: exportedAt }],
    [
      "the client changed shortly before the export was logged",
      duringExport,
      { createdAt: exportedAt },
    ],
    ["no export is logged", before, undefined],
    ["the invoice has no client", null, { createdAt: exportedAt }],
  ])(
    "keeps a link without a logged account when %s",
    async (_case, client, exportLog) => {
      const { db } = capturingDb(undefined, exportLog);
      const clientContactExists = vi.fn(async () => true);
      await expect(
        canReleaseMissingProviderLink({
          database: db,
          provider: "billy",
          invoice,
          externalId: "external",
          currentAccountId: async () => "acc-1",
          client,
          clientContactExists,
        }),
      ).resolves.toBe(false);
      expect(clientContactExists).not.toHaveBeenCalled();
    },
  );
});

describe("getProviderEmailState (resolved attempts)", () => {
  it("skips attempts the user marked as not sent", async () => {
    const { db, queries } = capturingDb(undefined);
    await expect(
      getProviderEmailState(
        db,
        "dinero",
        { id: "inv-1", userId: "user-1", organizationId: "org-1" },
        null,
      ),
    ).resolves.toBe("available");
    expect(queries[0].sql).toContain('"status" <> $');
    expect(queries[0].params).toContain("error");
  });
});

describe("releaseMissingProviderLink", () => {
  it.each(["draft", "sent"])(
    "only clears a %s invoice in the status it was read with and with the same external id",
    async (status) => {
      const { db, updates } = capturingDb({ metadata: { accountId: "acc-1" } });
      await expect(
        releaseMissingProviderLink({
          database: db,
          provider: "billy",
          invoice: {
            id: "inv-1",
            userId: "user-1",
            organizationId: "org-1",
            status,
          },
          externalId: "external",
          currentAccountId: async () => "acc-1",
          client: null,
          clientContactExists: async () => false,
        }),
      ).resolves.toBe(true);
      expect(updates[0].sql).toContain('"status" = $');
      expect(updates[0].params).toEqual(
        expect.arrayContaining(["inv-1", status, "external"]),
      );
    },
  );

  it("keeps the link when another account answers 404", async () => {
    const { db, updates } = capturingDb({ metadata: { accountId: "acc-1" } });
    await expect(
      releaseMissingProviderLink({
        database: db,
        provider: "dinero",
        invoice: {
          id: "inv-1",
          userId: "user-1",
          organizationId: "org-1",
          status: "draft",
        },
        externalId: "external",
        currentAccountId: async () => "acc-2",
        client: null,
        clientContactExists: async () => true,
      }),
    ).resolves.toBe(false);
    expect(updates).toHaveLength(0);
  });
});

/** Records inserts, updates and deletes the way the export connection sees them. */
function recordingTx() {
  const calls: { op: string; values?: unknown; where?: unknown }[] = [];
  const tx = {
    insert: () => ({
      values: (values: unknown) => {
        calls.push({ op: "insert", values });
        return { returning: async () => [{ id: "attempt-1" }] };
      },
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          calls.push({ op: "update", values });
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        calls.push({ op: "delete" });
      },
    }),
  };
  return { tx: tx as never, calls };
}

const invoice = { id: "inv-1", userId: "user-1", organizationId: "org-1" };

describe("sendProviderInvoiceEmail", () => {
  it("records the attempt before sending and marks it sent afterwards", async () => {
    const { tx, calls } = recordingTx();
    const send = vi.fn(async () => {
      expect(calls).toHaveLength(1);
    });
    await sendProviderInvoiceEmail(tx, invoice, "billy", "ext-1", send);
    expect(send).toHaveBeenCalledOnce();
    expect(calls).toEqual([
      {
        op: "insert",
        values: expect.objectContaining({
          integrationType: "billy",
          operation: "send_invoice_email",
          status: "partial",
          organizationId: "org-1",
          metadata: { invoiceId: "inv-1", externalId: "ext-1" },
        }),
      },
      { op: "update", values: { status: "success" } },
    ]);
  });

  it.each([400, 404, 422, 429])(
    "deletes the attempt when the provider refused with %s",
    async (statusCode) => {
      const { tx, calls } = recordingTx();
      const refusal = { statusCode, message: "refused" };
      await expect(
        sendProviderInvoiceEmail(tx, invoice, "dinero", "ext-1", async () => {
          throw refusal;
        }),
      ).rejects.toBe(refusal);
      expect(calls.map((c) => c.op)).toEqual(["insert", "delete"]);
    },
  );

  it.each([
    ["a timeout", new Error("The operation was aborted due to timeout")],
    ["a 502", { statusCode: 502 }],
    ["a 500", { statusCode: 500 }],
  ])("keeps the attempt as uncertain after %s", async (_, failure) => {
    const { tx, calls } = recordingTx();
    await expect(
      sendProviderInvoiceEmail(tx, invoice, "billy", "ext-1", async () => {
        throw failure;
      }),
    ).rejects.toBeInstanceOf(ProviderEmailUncertainError);
    // Only the "partial" insert: the attempt stays uncertain.
    expect(calls.map((c) => c.op)).toEqual(["insert"]);
  });
});

describe("isDefiniteSendFailure", () => {
  it.each([
    [{ statusCode: 401 }, true],
    [{ statusCode: 409 }, true],
    [{ statusCode: 503 }, false],
    [new Error("network"), false],
    [undefined, false],
  ])("%o -> %s", (error, expected) => {
    expect(isDefiniteSendFailure(error)).toBe(expected);
  });
});

describe("resolveUncertainProviderEmail", () => {
  function updatingDb(returned: unknown[]) {
    const sets: unknown[] = [];
    const wheres: { sql: string; params: unknown[] }[] = [];
    const db = {
      update: () => ({
        set: (values: unknown) => {
          sets.push(values);
          return {
            where: (where: SQL) => {
              wheres.push(dialect.sqlToQuery(where));
              return { returning: async () => returned };
            },
          };
        },
      }),
    };
    return { db: db as never, sets, wheres };
  }

  it.each([
    [true, "success"],
    [false, "error"],
  ])("wasSent %s marks the uncertain attempt %s", async (wasSent, status) => {
    const { db, sets, wheres } = updatingDb([{ id: "attempt-1" }]);
    await expect(
      resolveUncertainProviderEmail(db, "billy", invoice, wasSent),
    ).resolves.toBe(true);
    expect(sets[0]).toEqual(expect.objectContaining({ status }));
    // Only the open ("partial") attempt of this invoice is resolved.
    expect(wheres[0].params).toEqual(
      expect.arrayContaining(["billy", "send_invoice_email", "partial"]),
    );
    expect(wheres[0].params.join(" ")).toContain('"invoiceId":"inv-1"');
  });

  it("resolves false when there was nothing uncertain", async () => {
    const { db } = updatingDb([]);
    await expect(
      resolveUncertainProviderEmail(db, "dinero", invoice, false),
    ).resolves.toBe(false);
  });
});
