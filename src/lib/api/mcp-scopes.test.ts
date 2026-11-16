import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { guardToolScopes, MCP_TOOL_SCOPES } from "./mcp-scopes";

type Cb = (...args: unknown[]) => unknown;

// Minimal stand-in for McpServer: fanger de callbacks, der registreres.
function fakeServer() {
  const tools = new Map<string, Cb>();
  const server = {
    registerTool: (name: string, _config: unknown, cb: Cb) => {
      tools.set(name, cb);
      return {};
    },
  };
  guardToolScopes(server);
  return { server, tools };
}

const extraWith = (scopes: string[]) => ({ http: { authInfo: { scopes } } });

describe("MCP tool-scopes", () => {
  it("en læse-nøgle kan kalde list-værktøjer, men ikke create_time_entry", async () => {
    const { server, tools } = fakeServer();
    const listHandler = vi.fn(async () => ({ content: [] }));
    const createHandler = vi.fn(async () => ({ content: [] }));
    server.registerTool("list_time_entries", {}, listHandler);
    server.registerTool("create_time_entry", {}, createHandler);

    const extra = extraWith(["time:read", "clients:read"]);

    await tools.get("list_time_entries")?.({}, extra);
    expect(listHandler).toHaveBeenCalledOnce();

    const denied = (await tools.get("create_time_entry")?.({}, extra)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(createHandler).not.toHaveBeenCalled();
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain("time:write");
  });

  it("write- og *-nøgler kan skrive", async () => {
    for (const scopes of [["time:write"], ["time:all"], ["*"]]) {
      const { server, tools } = fakeServer();
      const handler = vi.fn(async () => ({ content: [] }));
      server.registerTool("create_time_entry", {}, handler);
      await tools.get("create_time_entry")?.({}, extraWith(scopes));
      expect(handler).toHaveBeenCalledOnce();
    }
  });

  it("tomme scopes giver ingen adgang (som REST), men whoami virker", async () => {
    const { server, tools } = fakeServer();
    const listHandler = vi.fn(async () => ({ content: [] }));
    const whoamiHandler = vi.fn(async () => ({ content: [] }));
    server.registerTool("list_clients", {}, listHandler);
    server.registerTool("whoami", {}, whoamiHandler);

    await tools.get("list_clients")?.({}, extraWith([]));
    await tools.get("whoami")?.({}, extraWith([]));
    expect(listHandler).not.toHaveBeenCalled();
    expect(whoamiHandler).toHaveBeenCalledOnce();
  });

  it("afviser at registrere et værktøj uden scope-mapping", () => {
    const { server } = fakeServer();
    expect(() => server.registerTool("delete_everything", {}, vi.fn())).toThrow(
      /delete_everything/,
    );
  });

  it("alle værktøjer i MCP-ruten har en scope-mapping", () => {
    const source = readFileSync(
      resolve(__dirname, "../../app/api/v1/mcp/route.ts"),
      "utf8",
    );
    const names = [...source.matchAll(/registerTool\(\s*"(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(MCP_TOOL_SCOPES).toHaveProperty(name);
  });
});
