import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sessionUserId: "user-me" as string | null,
  sessionEmail: "demo-eur-test@demo.invalid",
  csvRequest: null as Record<string, unknown> | null,
  orgRequest: null as Record<string, unknown> | null,
  role: null as string | null,
  updates: 0,
  /** Objektet i lageret; null = findes ikke. */
  stored: null as { stream: ReadableStream; size?: number } | null,
  storageConfigured: true,
  /** where-argumenterne til hvert opslag i dataExportRequests. */
  lookups: [] as unknown[],
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        state.sessionUserId
          ? { user: { id: state.sessionUserId, email: state.sessionEmail } }
          : null,
    },
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      dataExportRequests: {
        findFirst: vi
          .fn()
          .mockImplementation(async (args: { where: unknown }) => {
            state.lookups.push(args.where);
            return state.lookups.length === 1
              ? state.orgRequest
              : state.csvRequest;
          })
          .mockName("findFirst"),
      },
      members: {
        findFirst: async () => (state.role ? { role: state.role } : undefined),
      },
    },
    update: () => {
      state.updates++;
      return { set: () => ({ where: async () => undefined }) };
    },
  },
}));
vi.mock("@/lib/export/org-export/storage", () => ({
  isExportStorageConfigured: () => state.storageConfigured,
  getOrgExportStream: async () => state.stored,
}));

vi.mock("@/lib/utils/data-export", () => ({
  generateUserDataExport: async () => ({
    clients: [],
    projects: [],
    timeEntries: [],
    tasks: [],
    invoices: [{ amount: "125.50" }],
    invoiceLines: [],
    prepaidPackages: [{ totalValue: "450.75" }],
    prepaidUsage: [],
    rateHistory: [],
  }),
}));

import { PgDialect } from "drizzle-orm/pg-core";
import { GET } from "./route";

function zipStream() {
  return {
    stream: new Blob([new Uint8Array([80, 75, 3, 4])]).stream(),
    size: 4,
  };
}

function call() {
  return GET(new Request("http://localhost/api/data-export/t"), {
    params: Promise.resolve({ token: "t" }),
  });
}

describe("GET /api/data-export/[token] for organisations-eksport", () => {
  beforeEach(() => {
    state.sessionUserId = "user-me";
    state.orgRequest = {
      id: "req-1",
      userId: "user-me",
      organizationId: "org-A",
      requestType: "org_full",
      status: "ready",
    };
    state.role = "admin";
    state.updates = 0;
    state.storageConfigured = true;
    state.stored = zipStream();
    state.lookups = [];
  });

  it("kræver login", async () => {
    state.sessionUserId = null;
    expect((await call()).status).toBe(401);
  });

  it("en medarbejder får 403 og intet genereres", async () => {
    state.role = "member";
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.updates).toBe(0);
    expect(state.updates).toBe(0);
  });

  it("en bruger uden for organisationen får 403", async () => {
    state.role = null;
    expect((await call()).status).toBe(403);
    expect(state.updates).toBe(0);
  });

  it("en anden bruger end bestilleren får 403", async () => {
    state.sessionUserId = "en-anden";
    expect((await call()).status).toBe(403);
  });

  it("administratoren, der bestilte den, får en ZIP", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([80, 75, 3, 4]),
    );
    expect(state.updates).toBe(1); // markeret som hentet
  });

  it("mangler ZIP'en i lageret, bygges den ikke om i requesten: 410 og intet markeres hentet", async () => {
    state.stored = null;
    const res = await call();
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("udløbet");
    expect(body.error).toContain("Bestil en ny eksport");
    expect(state.updates).toBe(0);
  });

  it("uden objektlager er svaret det samme 410 (intet at hente)", async () => {
    state.storageConfigured = false;
    state.stored = zipStream();
    const res = await call();
    expect(res.status).toBe(410);
    expect(state.updates).toBe(0);
  });
});

describe("GET /api/data-export/[token] for bruger-eksport (egne data)", () => {
  beforeEach(() => {
    state.sessionUserId = "user-me";
    state.orgRequest = {
      id: "req-2",
      userId: "user-me",
      organizationId: "org-A",
      requestType: "user_full",
      status: "ready",
    };
    state.role = "member";
    state.updates = 0;
    state.storageConfigured = true;
    state.stored = zipStream();
    state.lookups = [];
  });

  it("medarbejderen, der bestilte den, får sin ZIP, bygget som bruger-eksport", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toContain("mine-data");
  });

  it("kræver login", async () => {
    state.sessionUserId = null;
    expect((await call()).status).toBe(401);
  });

  it("ejeren af organisationen får 403 på en medarbejders eksport", async () => {
    state.sessionUserId = "ejeren";
    state.role = "owner";
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.updates).toBe(0);
    expect(state.updates).toBe(0);
  });

  it("en kollega i samme organisation får 403", async () => {
    state.sessionUserId = "kollega";
    state.role = "member";
    expect((await call()).status).toBe(403);
    expect(state.updates).toBe(0);
  });

  it("en bruger uden for organisationen får 403", async () => {
    state.role = null;
    expect((await call()).status).toBe(403);
    expect(state.updates).toBe(0);
  });

  it("ZIP-typerne slås op for sig, og den gamle JSON/CSV-gren udelukker dem", async () => {
    // Slå begge opslag op: et der finder intet (udløbet/ukendt token).
    state.orgRequest = null;
    await call();
    expect(state.lookups).toHaveLength(2);
    const dialect = new PgDialect();
    const render = (where: unknown) =>
      dialect.sqlToQuery(where as Parameters<PgDialect["sqlToQuery"]>[0]);
    const zip = render(state.lookups[0]);
    const legacy = render(state.lookups[1]);
    expect(zip.sql).toContain('"request_type" in (');
    expect(zip.params).toEqual(
      expect.arrayContaining(["org_full", "user_full"]),
    );
    expect(legacy.sql).toContain('"request_type" not in (');
    expect(legacy.params).toEqual(
      expect.arrayContaining(["org_full", "user_full"]),
    );
  });
});

describe("GET /api/data-export/[token] for legacy CSV", () => {
  it.each([
    ["1", "demo-eur-test@demo.invalid", "EUR"],
    ["1", "demo-legacy@demo.invalid", "kr"],
    ["0", "demo-eur-test@demo.invalid", "kr"],
  ])(
    "formats CSV amounts with DEMO_MODE=%s for %s",
    async (mode, email, currency) => {
      vi.stubEnv("DEMO_MODE", mode);
      state.sessionUserId = "user-me";
      state.sessionEmail = email;
      state.lookups = [];
      state.orgRequest = null;
      state.csvRequest = { id: "req-csv", userId: "user-me", format: "csv" };

      try {
        const response = await call();
        expect(response.status).toBe(200);
        const csv = await response.text();
        expect(csv).toContain(`125,50 ${currency}`);
        expect(csv).toContain(`450,75 ${currency}`);
      } finally {
        state.csvRequest = null;
        vi.unstubAllEnvs();
      }
    },
  );
});
