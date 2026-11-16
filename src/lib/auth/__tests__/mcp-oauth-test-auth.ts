// Test-instans af better-auth med samme OAuth-plugins som produktion
// (mcpOAuthPlugins) på en hukommelsesdatabase. Medlemskab læses fra
// organization-pluginets egne rækker; plan styres af `testState.paidOrgs`.
// Med MCP_OAUTH_TEST_PG_URL kører samme flow mod Postgres via
// drizzle-adapteren og appens rigtige skema (efter drizzle-kit push).
import { memoryAdapter } from "@better-auth/memory-adapter";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { type McpOAuthDeps, mcpOAuthPlugins } from "../mcp-oauth";

export const testState = {
  paidOrgs: new Set<string>(),
  audit: [] as Array<{ action: string; orgId: string }>,
};

export const memoryDb: Record<string, Record<string, unknown>[]> = {
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

async function memberships(userId: string): Promise<string[]> {
  const ctx = await testAuth.$context;
  const rows = await ctx.adapter.findMany<{ organizationId: string }>({
    model: "member",
    where: [{ field: "userId", value: userId }],
  });
  return rows.map((r) => r.organizationId);
}

export async function isMember(userId: string, orgId: string) {
  return (await memberships(userId)).includes(orgId);
}

export const testDeps: McpOAuthDeps = {
  // Som resolveActiveOrgId: aktiv org hvis medlem, ellers første medlemskab
  async resolveOrgForSession(userId, session) {
    const orgs = await memberships(userId);
    const active = session.activeOrganizationId;
    if (typeof active === "string" && orgs.includes(active)) return active;
    return orgs[0] ?? null;
  },
  async planDenial(_userId, orgId) {
    return testState.paidOrgs.has(orgId)
      ? null
      : "AI-forbindelser kræver et betalt abonnement, og organisationen er på Gratis.";
  },
  async audit(orgId, _userId, action) {
    testState.audit.push({ action, orgId });
  },
};

async function database() {
  const url = process.env.MCP_OAUTH_TEST_PG_URL;
  if (!url) return memoryAdapter(memoryDb);
  const [{ drizzleAdapter }, { drizzle }, { default: postgres }, schema] =
    await Promise.all([
      import("better-auth/adapters/drizzle"),
      import("drizzle-orm/postgres-js"),
      import("postgres"),
      import("@/lib/db/schema"),
    ]);
  return drizzleAdapter(drizzle(postgres(url), { schema }), {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      organization: schema.organizations,
      member: schema.members,
      invitation: schema.invitations,
      oauthClient: schema.oauthClients,
      oauthResource: schema.oauthResources,
      oauthClientResource: schema.oauthClientResources,
      oauthRefreshToken: schema.oauthRefreshTokens,
      oauthAccessToken: schema.oauthAccessTokens,
      oauthConsent: schema.oauthConsents,
      oauthClientAssertion: schema.oauthClientAssertions,
    },
  });
}

export const testAuth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "test-secret-test-secret-test-secret-123",
  database: await database(),
  emailAndPassword: { enabled: true },
  rateLimit: { enabled: false },
  plugins: [organization(), ...mcpOAuthPlugins(testDeps)],
  logger: { disabled: true },
});
