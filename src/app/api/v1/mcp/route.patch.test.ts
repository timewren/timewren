import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Værktøjerne kalder en tRPC-caller; her erstattes den af en stub, så testen
// kun ser på hvad værktøjet sender videre (#718).
const caller = vi.hoisted(() => ({
  time: {
    getById: vi.fn(),
    update: vi.fn(),
    previewRate: vi.fn(),
  },
  prepaid: { list: vi.fn() },
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
const extraWith = (scopes: string[]) => ({
  http: { authInfo: { scopes, extra: { userId: "user-1" } } },
});
const extra = extraWith(["*"]);

const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const existingEntry = {
  id: ENTRY_ID,
  clientId: "client-1",
  projectId: "project-1",
  description: "Gammel tekst",
  notes: null,
  hours: "2.50",
  date: "2026-09-15",
  startTime: null,
  endTime: null,
  isBillable: true,
  isBilled: false,
  taskId: null,
  billableRate: "850.00",
};

function sentData() {
  expect(caller.time.update).toHaveBeenCalledOnce();
  return caller.time.update.mock.calls[0][0].data as Record<string, unknown>;
}

beforeAll(() => {
  captured.init?.({
    registerTool: (name: string, _config: unknown, cb: ToolCb) => {
      tools.set(name, cb);
    },
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  caller.time.getById.mockResolvedValue(existingEntry);
  caller.time.update.mockResolvedValue({});
});

describe("MCP update_time_entry — PATCH-semantik (#718)", () => {
  it("bevarer kunde, projekt, timer og dato når kun beskrivelsen sendes", async () => {
    await tools.get("update_time_entry")?.(
      { id: ENTRY_ID, description: "Ny tekst" },
      extra,
    );

    const data = sentData();
    expect(data.description).toBe("Ny tekst");
    expect(data.clientId).toBe("client-1");
    expect(data.projectId).toBe("project-1");
    expect(data.hours).toBe(2.5);
    expect(data.date).toBe("2026-09-15");
    expect(data.billableRate).toBe("850.00");
  });

  it("rydder kun kunden ved eksplicit null og bevarer projektet", async () => {
    await tools.get("update_time_entry")?.(
      { id: ENTRY_ID, clientId: null },
      extra,
    );

    const data = sentData();
    expect(data.clientId).toBeUndefined();
    expect(data.projectId).toBe("project-1");
    expect(data.description).toBe("Gammel tekst");
  });

  it("kan flytte posten til et andet projekt", async () => {
    await tools.get("update_time_entry")?.(
      { id: ENTRY_ID, projectId: "project-2" },
      extra,
    );

    const data = sentData();
    expect(data.projectId).toBe("project-2");
    expect(data.clientId).toBe("client-1");
    // Nyt projekt uden ny sats: rate-hierarkiet skal genberegne den.
    expect(data.billableRate).toBeUndefined();
  });

  it("svarer med den opdaterede post læst tilbage", async () => {
    caller.time.getById
      .mockResolvedValueOnce(existingEntry)
      .mockResolvedValueOnce({ ...existingEntry, description: "Ny tekst" });

    const result = (await tools.get("update_time_entry")?.(
      { id: ENTRY_ID, description: "Ny tekst" },
      extra,
    )) as { content: Array<{ text: string }> };

    expect(JSON.parse(result.content[0].text)).toMatchObject({
      description: "Ny tekst",
      clientId: "client-1",
    });
  });
});

describe("MCP list_prepaid_packages — klippekort-saldo", () => {
  it("returnerer saldoen pr. klippekort via prepaid.list", async () => {
    caller.prepaid.list.mockResolvedValue([
      {
        id: "pkg-1",
        name: "20 timer",
        clientId: "client-1",
        client: { id: "client-1", name: "Kunde A" },
        totalHours: "20.00",
        usedHours: "7.50",
        remainingHours: "12.50",
        purchaseDate: "2026-08-01",
        expiryDate: null,
        isActive: true,
        hideValue: false,
      },
    ]);

    const result = (await tools.get("list_prepaid_packages")?.(
      { clientId: "client-1", activeOnly: true },
      extra,
    )) as { content: Array<{ text: string }> };

    expect(caller.prepaid.list).toHaveBeenCalledWith({
      clientId: "client-1",
      activeOnly: true,
      includeArchived: undefined,
    });
    expect(JSON.parse(result.content[0].text)).toEqual([
      expect.objectContaining({
        id: "pkg-1",
        clientName: "Kunde A",
        totalHours: "20.00",
        usedHours: "7.50",
        remainingHours: "12.50",
      }),
    ]);
  });

  it("kræver prepaid:read-scope", async () => {
    const denied = (await tools.get("list_prepaid_packages")?.(
      {},
      extraWith(["time:read"]),
    )) as { isError?: boolean; content: Array<{ text: string }> };
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain("prepaid:read");
    expect(caller.prepaid.list).not.toHaveBeenCalled();

    await tools.get("list_prepaid_packages")?.({}, extraWith(["prepaid:read"]));
    expect(caller.prepaid.list).toHaveBeenCalledOnce();
  });
});
