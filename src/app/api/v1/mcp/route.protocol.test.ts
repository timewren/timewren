import { beforeEach, describe, expect, it, vi } from "vitest";

// Kører den rigtige mcp-handler (ingen mock af protokollaget) med JSON-RPC
// over HTTP, som en MCP-klient gør. Kun nøgleopslaget og tRPC-calleren er
// stubbet, så testen fanger brud i wire-protokol, auth og scope-vagt ved en
// opgradering af mcp-handler eller MCP-SDK'et.
const caller = vi.hoisted(() => ({
  clients: { listPage: vi.fn() },
  time: { create: vi.fn() },
}));
const auth = vi.hoisted(() => ({ verifyMcpToken: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/api/mcp-auth", () => auth);
vi.mock("@/lib/trpc/routers/index", () => ({
  appRouter: { createCaller: () => caller },
}));

import { POST } from "./route";

const URL_MCP = "http://localhost/api/v1/mcp";

async function rpc(
  method: string,
  params: Record<string, unknown> = {},
  token: string | null = "tk_live_test",
) {
  const res = await POST(
    new Request(URL_MCP, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const text = await res.text();
  // Svaret er enten ren JSON eller én SSE-hændelse med JSON i data-linjen.
  const json = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5);
  return { status: res.status, body: json ? JSON.parse(json) : null };
}

function authAs(scopes: string[]) {
  auth.verifyMcpToken.mockResolvedValue({
    token: "tk_live_test",
    clientId: "key-1",
    scopes,
    extra: { userId: "user-1", organizationId: "org-1" },
  });
}

describe("MCP-endpointet over HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authAs(["*"]);
  });

  it("afviser kald uden gyldig nøgle med 401", async () => {
    auth.verifyMcpToken.mockResolvedValue(undefined);
    const { status } = await rpc("tools/list", {}, null);
    expect(status).toBe(401);
  });

  it("initialize svarer med serverens navn", async () => {
    const { status, body } = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBe("timetrack");
  });

  it("tools/list viser alle værktøjer med objekt-skemaer", async () => {
    const { body } = await rpc("tools/list");
    const tools = body.result.tools as {
      name: string;
      inputSchema: { type: string; properties?: Record<string, unknown> };
    }[];
    expect(tools.map((t) => t.name)).toContain("whoami");
    expect(tools).toHaveLength(12);
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    const listClients = tools.find((t) => t.name === "list_clients");
    expect(Object.keys(listClients?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["q", "includeArchived", "page", "limit"]),
    );
  });

  it("whoami returnerer nøglens bruger, organisation og scopes", async () => {
    authAs(["time:read"]);
    const { body } = await rpc("tools/call", { name: "whoami", arguments: {} });
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      userId: "user-1",
      organizationId: "org-1",
      scopes: ["time:read"],
    });
  });

  it("et værktøj får argumenterne og kalder tRPC", async () => {
    caller.clients.listPage.mockResolvedValue({
      clients: [{ id: "c1", name: "Acme ApS" }],
      total: 1,
    });
    const { body } = await rpc("tools/call", {
      name: "list_clients",
      arguments: { q: "acme" },
    });
    expect(body.result.isError).toBeFalsy();
    expect(caller.clients.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ q: "acme" }),
    );
    expect(JSON.parse(body.result.content[0].text)).toEqual([
      { id: "c1", name: "Acme ApS" },
    ]);
  });

  it("scope-vagten afviser et værktøj nøglen ikke har adgang til", async () => {
    authAs(["clients:read"]);
    const { body } = await rpc("tools/call", {
      name: "create_time_entry",
      arguments: { description: "Møde", hours: 1, date: "2026-09-16" },
    });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("missing required scope");
    expect(caller.time.create).not.toHaveBeenCalled();
  });

  it("ugyldige argumenter giver en fejl uden at kalde tRPC", async () => {
    const { body } = await rpc("tools/call", {
      name: "list_clients",
      arguments: { q: 42 },
    });
    expect(body.error ?? body.result?.isError).toBeTruthy();
    expect(caller.clients.listPage).not.toHaveBeenCalled();
  });
});
