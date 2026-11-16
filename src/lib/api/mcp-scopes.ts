import { hasScope, type Resource } from "./scopes";

type ToolScope = { resource: Resource; permission: "read" | "write" } | null;

/**
 * Scope-krav pr. MCP-værktøj — samme ressource og handling som den tilsvarende
 * REST-rute. `null` = intet scope-krav (som GET /api/v1/me).
 */
export const MCP_TOOL_SCOPES: Record<string, ToolScope> = {
  whoami: null,
  list_clients: { resource: "clients", permission: "read" },
  get_client: { resource: "clients", permission: "read" },
  create_client: { resource: "clients", permission: "write" },
  list_time_entries: { resource: "time", permission: "read" },
  create_time_entry: { resource: "time", permission: "write" },
  update_time_entry: { resource: "time", permission: "write" },
  list_prepaid_packages: { resource: "prepaid", permission: "read" },
  unbilled_summary: { resource: "reports", permission: "read" },
  list_invoices: { resource: "invoices", permission: "read" },
  // REST kræver invoices:write, også ved dryRun
  invoice_from_time_entries: { resource: "invoices", permission: "write" },
  send_invoice: { resource: "invoices", permission: "write" },
};

type ToolCallback = (...args: unknown[]) => unknown;

/**
 * Pakker `server.registerTool` ind, så hvert værktøjs callback først tjekker
 * API-nøglens scopes (fra AuthInfo) med samme `hasScope` som REST. Et værktøj
 * uden mapping kan ikke registreres (fail closed).
 */
export function guardToolScopes(server: {
  // biome-ignore lint/suspicious/noExplicitAny: McpServer.registerTool er stærkt generisk
  registerTool: (...args: any[]) => unknown;
}): void {
  const register = server.registerTool.bind(server);
  server.registerTool = (name: string, config: unknown, cb: ToolCallback) => {
    if (!Object.hasOwn(MCP_TOOL_SCOPES, name)) {
      throw new Error(`MCP tool "${name}" has no scope mapping`);
    }
    const required = MCP_TOOL_SCOPES[name];
    const guarded: ToolCallback = (...args) => {
      if (required) {
        // extra er altid sidste argument (args, extra) eller (extra)
        const extra = args[args.length - 1] as
          | { http?: { authInfo?: { scopes?: string[] } } }
          | undefined;
        const scopes = extra?.http?.authInfo?.scopes ?? [];
        if (!hasScope(scopes, required.resource, required.permission)) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Forbidden: missing required scope ${required.resource}:${required.permission}. This API key does not grant that access.`,
              },
            ],
          };
        }
      }
      return cb(...args);
    };
    return register(name, config, guarded);
  };
}
