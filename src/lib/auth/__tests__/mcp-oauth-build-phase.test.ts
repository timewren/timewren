import { memoryAdapter } from "@better-auth/memory-adapter";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type McpOAuthDeps, mcpOAuthPlugins } from "../mcp-oauth";

// #1096: `next build` evaluerer `@/lib/auth` i hver build-worker under
// "Collecting page data". oauth-provider seeder `resources` i databasen ved
// init, og under build er DATABASE_URL en pladsholder, så hver worker logger
// "could not seed resources at startup". Under build må init ikke røre
// databasen; ved kørsel seedes ressourcen som før.

const deps: McpOAuthDeps = {
  resolveOrgForSession: async () => null,
  planDenial: async () => null,
  audit: async () => {},
};

async function initWithMemoryDb() {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    organization: [],
    member: [],
    invitation: [],
    oauthClient: [],
    oauthResource: [],
    oauthClientResource: [],
    oauthRefreshToken: [],
    oauthAccessToken: [],
    oauthConsent: [],
    oauthClientAssertion: [],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: "test-secret-test-secret-test-secret-123",
    database: memoryAdapter(db),
    plugins: [organization(), ...mcpOAuthPlugins(deps)],
    logger: { disabled: true },
  });
  await auth.$context;
  return db;
}

describe("mcpOAuthPlugins under next build (#1096)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("seeder ikke MCP-ressourcen i databasen under build", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    const db = await initWithMemoryDb();
    expect(db.oauthResource).toEqual([]);
  });

  it("seeder MCP-ressourcen ved kørsel", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const db = await initWithMemoryDb();
    expect(db.oauthResource.map((r) => r.identifier)).toEqual([
      "http://localhost:3000/api/v1/mcp",
    ]);
  });
});
