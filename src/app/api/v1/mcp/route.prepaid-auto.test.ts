import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Værktøjerne kalder en tRPC-caller; her erstattes den af en stub, så testen
// kun ser på hvilket klippekort værktøjet sender videre (#422).
const caller = vi.hoisted(() => ({
  time: {
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    previewRate: vi.fn(),
  },
  projects: { list: vi.fn() },
  prepaid: { getActiveForClient: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/api/mcp-auth", () => ({ verifyMcpToken: vi.fn() }));
vi.mock("@/lib/trpc/routers/index", () => ({
  appRouter: { createCaller: () => caller },
}));

type ToolCb = (args: unknown, extra: unknown) => Promise<unknown>;
const captured = vi.hoisted(() => ({
  init: null as null | ((server: unknown) => void),
}));
vi.mock("mcp-handler", () => ({
  createMcpHandler: (init: (server: unknown) => void) => {
    captured.init = init;
    return () => new Response();
  },
  withMcpAuth: (handler: unknown) => handler,
}));

import "./route";

const tools = new Map<string, ToolCb>();
const extra = {
  http: { authInfo: { scopes: ["*"], extra: { userId: "user-1" } } },
};

const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const existingEntry = {
  id: ENTRY_ID,
  clientId: "client-1",
  projectId: null,
  description: "Support",
  notes: null,
  hours: "1.00",
  date: "2026-09-15",
  startTime: null,
  endTime: null,
  isBillable: true,
  isBilled: false,
  invoiceId: null,
  taskId: null,
  billableRate: "850.00",
  isPrepaid: false,
  prepaidPackageId: null,
  prepaidPackage: null,
};

beforeAll(() => {
  captured.init?.({
    registerTool: (name: string, _config: unknown, cb: ToolCb) => {
      tools.set(name, cb);
    },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  caller.time.create.mockResolvedValue({ id: ENTRY_ID });
  caller.time.getById.mockResolvedValue(existingEntry);
  caller.time.update.mockResolvedValue({});
  caller.prepaid.getActiveForClient.mockResolvedValue([
    {
      id: "pkg-senere",
      autoDeduct: true,
      remainingHours: 10,
      expiryDate: new Date("2099-12-31T00:00:00Z"),
    },
    {
      id: "pkg-først",
      autoDeduct: true,
      remainingHours: 10,
      expiryDate: new Date("2099-06-30T00:00:00Z"),
    },
  ]);
});

describe('MCP create_time_entry — prepaid: "auto" (#422)', () => {
  it("trækker fra kundens kort der udløber først", async () => {
    await tools.get("create_time_entry")?.(
      {
        clientId: "client-1",
        description: "Support",
        hours: 1,
        date: "2026-09-15",
        prepaid: "auto",
      },
      extra,
    );
    expect(caller.time.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "client-1",
        prepaidPackageId: "pkg-først",
      }),
    );
    expect(caller.time.create.mock.calls[0][0]).not.toHaveProperty("prepaid");
  });

  it("opretter uden træk når kunden intet auto-kort har", async () => {
    caller.prepaid.getActiveForClient.mockResolvedValue([]);
    await tools.get("create_time_entry")?.(
      {
        clientId: "client-1",
        description: "Support",
        hours: 1,
        date: "2026-09-15",
        prepaid: "auto",
      },
      extra,
    );
    expect(
      caller.time.create.mock.calls[0][0].prepaidPackageId,
    ).toBeUndefined();
  });

  it("sender et eksplicit kort uændret videre og slår ikke op", async () => {
    await tools.get("create_time_entry")?.(
      {
        clientId: "client-1",
        description: "Support",
        hours: 1,
        date: "2026-09-15",
        prepaidPackageId: "pkg-valgt",
      },
      extra,
    );
    expect(caller.time.create.mock.calls[0][0].prepaidPackageId).toBe(
      "pkg-valgt",
    );
    expect(caller.prepaid.getActiveForClient).not.toHaveBeenCalled();
  });

  it("afviser auto kombineret med et eksplicit kort", async () => {
    const result = (await tools.get("create_time_entry")?.(
      {
        clientId: "client-1",
        description: "Support",
        hours: 1,
        date: "2026-09-15",
        prepaid: "auto",
        prepaidPackageId: "pkg-valgt",
      },
      extra,
    )) as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(caller.time.create).not.toHaveBeenCalled();
  });
});

describe('MCP update_time_entry — prepaid: "auto" (#422)', () => {
  it("trækker en utrukket post fra auto-kortet og bevarer resten (PATCH)", async () => {
    await tools.get("update_time_entry")?.(
      { id: ENTRY_ID, prepaid: "auto" },
      extra,
    );
    const data = caller.time.update.mock.calls[0][0].data;
    expect(data.prepaidPackageId).toBe("pkg-først");
    expect(data.clientId).toBe("client-1");
    expect(data.description).toBe("Support");
  });

  it("rører ikke en faktureret post", async () => {
    caller.time.getById.mockResolvedValue({ ...existingEntry, isBilled: true });
    await tools.get("update_time_entry")?.(
      { id: ENTRY_ID, prepaid: "auto" },
      extra,
    );
    expect(caller.prepaid.getActiveForClient).not.toHaveBeenCalled();
    const data = caller.time.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("prepaidPackageId");
  });

  it("kan fjerne trækket med prepaidPackageId: null", async () => {
    await tools.get("update_time_entry")?.(
      { id: ENTRY_ID, prepaidPackageId: null },
      extra,
    );
    expect(
      caller.time.update.mock.calls[0][0].data.prepaidPackageId,
    ).toBeNull();
  });
});
