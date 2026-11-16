import { createHash, randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Hele OAuth-flowet til MCP (#912) mod en rigtig better-auth-instans med
// oauth-provider + organization-plugin på en hukommelsesdatabase:
// DCR → authorize (PKCE S256) → samtykke med org-valg → token → MCP-kald med
// Bearer, refresh, revoke og planafvisning. Kun Postgres-tjenesterne
// (medlemskab/plan i Drizzle) og tRPC-calleren er erstattet.

process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";

const state = vi.hoisted(() => ({ apiKeyFindFirst: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    query: { apiKeys: { findFirst: state.apiKeyFindFirst } },
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  },
}));

const caller = vi.hoisted(() => ({
  clients: {
    listPage: async () => ({
      clients: [{ id: "c1", name: "Bageriet" }],
      total: 1,
    }),
  },
}));
vi.mock("@/lib/trpc/routers/index", () => ({
  appRouter: { createCaller: () => caller },
}));

vi.mock("@/lib/auth", async () => ({
  auth: (await import("./mcp-oauth-test-auth")).testAuth,
}));

vi.mock("@/lib/auth/mcp-oauth-access", async () => {
  const { testDeps, isMember } = await import("./mcp-oauth-test-auth");
  return {
    isOrgMember: isMember,
    mcpPlanDenial: testDeps.planDenial,
    mcpOAuthDeps: testDeps,
  };
});

import { GET as authServerMetadata } from "@/app/.well-known/oauth-authorization-server/[[...path]]/route";
import { GET as protectedResourceMetadata } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { POST as mcpPost } from "@/app/api/v1/mcp/route";
import { verifyMcpToken } from "@/lib/api/mcp-auth";
import { authorizePathFromSignedQuery } from "../mcp-oauth-query";
import { testAuth, testState } from "./mcp-oauth-test-auth";

const ORIGIN = "http://localhost:3000";
const MCP_URL = `${ORIGIN}/api/v1/mcp`;
const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

type Jar = Map<string, string>;

async function call(
  path: string,
  init: RequestInit & {
    jar?: Jar;
    json?: unknown;
    form?: Record<string, string>;
  } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("origin", ORIGIN);
  if (init.jar?.size) {
    headers.set(
      "cookie",
      [...init.jar].map(([k, v]) => `${k}=${v}`).join("; "),
    );
  }
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (init.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form).toString();
  }
  const res = await testAuth.handler(
    new Request(`${ORIGIN}${path}`, {
      method: init.method ?? (body ? "POST" : "GET"),
      headers,
      body,
    }),
  );
  if (init.jar) {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      init.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  return res;
}

async function signUp(email: string): Promise<Jar> {
  const jar: Jar = new Map();
  const res = await call("/api/auth/sign-up/email", {
    jar,
    json: { email, password: "Kodeord-123456!", name: "Test" },
  });
  expect(res.status).toBe(200);
  return jar;
}

async function createOrg(jar: Jar, name: string): Promise<string> {
  const res = await call("/api/auth/organization/create", {
    jar,
    json: {
      name,
      slug: `${name.toLowerCase()}-${randomBytes(3).toString("hex")}`,
    },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

async function setActive(jar: Jar, organizationId: string) {
  const res = await call("/api/auth/organization/set-active", {
    jar,
    json: { organizationId },
  });
  expect(res.status).toBe(200);
}

async function registerClient(): Promise<string> {
  const res = await call("/api/auth/oauth2/register", {
    json: {
      client_name: "Claude",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { client_id: string };
  expect(body.client_id).toBeTruthy();
  return body.client_id;
}

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorizeQuery(clientId: string, challenge: string) {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "clients:read time:write offline_access",
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: MCP_URL,
  });
}

/** authorize → samtykkeside → godkend. Returnerer koden fra redirect_uri. */
async function authorizeAndConsent(
  jar: Jar,
  clientId: string,
  challenge: string,
): Promise<{ code: string | null; consentRes: Response }> {
  const auth = await call(
    `/api/auth/oauth2/authorize?${authorizeQuery(clientId, challenge)}`,
    { jar },
  );
  expect(auth.status).toBe(302);
  const location = new URL(auth.headers.get("location") ?? "", ORIGIN);
  if (location.pathname !== "/auth/oauth/consent") {
    // Samtykke fandtes allerede: koden kommer direkte.
    return { code: location.searchParams.get("code"), consentRes: auth };
  }
  const consentRes = await call("/api/auth/oauth2/consent", {
    jar,
    headers: { accept: "application/json" },
    json: { accept: true, oauth_query: location.search.slice(1) },
  });
  if (consentRes.status !== 200) return { code: null, consentRes };
  const { url } = (await consentRes.clone().json()) as { url: string };
  const redirect = new URL(url);
  expect(redirect.origin + redirect.pathname).toBe(REDIRECT_URI);
  expect(redirect.searchParams.get("state")).toBe("xyz");
  return { code: redirect.searchParams.get("code"), consentRes };
}

async function exchange(clientId: string, code: string, verifier: string) {
  const res = await call("/api/auth/oauth2/token", {
    form: {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
      resource: MCP_URL,
    },
  });
  const body = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    error?: string;
  };
  return { status: res.status, body };
}

async function mcp(method: string, token: string | null, params = {}) {
  const res = await mcpPost(
    new Request(MCP_URL, {
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
  const json = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5);
  return {
    status: res.status,
    headers: res.headers,
    body: json ? JSON.parse(json) : null,
  };
}

/** Bruger med en betalende org, forbundet. Returnerer tokens og org. */
async function connectedUser(email: string) {
  const jar = await signUp(email);
  const orgId = await createOrg(jar, "Firma");
  testState.paidOrgs.add(orgId);
  const clientId = await registerClient();
  const { verifier, challenge } = pkce();
  const { code } = await authorizeAndConsent(jar, clientId, challenge);
  expect(code).toBeTruthy();
  const tokens = await exchange(clientId, code as string, verifier);
  expect(tokens.status).toBe(200);
  return { jar, orgId, clientId, tokens: tokens.body };
}

describe("OAuth-discovery (RFC 8414/9728)", () => {
  it("autorisationsserverens metadata har DCR, PKCE S256 og scopes", async () => {
    const res = await authServerMetadata(
      new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`),
    );
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.issuer).toBe(`${ORIGIN}/api/auth`);
    expect(meta.authorization_endpoint).toBe(
      `${ORIGIN}/api/auth/oauth2/authorize`,
    );
    expect(meta.token_endpoint).toBe(`${ORIGIN}/api/auth/oauth2/token`);
    expect(meta.registration_endpoint).toBe(
      `${ORIGIN}/api/auth/oauth2/register`,
    );
    expect(meta.revocation_endpoint).toBe(`${ORIGIN}/api/auth/oauth2/revoke`);
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
    expect(meta.grant_types_supported).toEqual(
      expect.arrayContaining(["authorization_code", "refresh_token"]),
    );
    expect(meta.grant_types_supported).not.toContain("client_credentials");
    expect(meta.token_endpoint_auth_methods_supported).toContain("none");
    expect(meta.scopes_supported).toEqual(
      expect.arrayContaining(["time:write", "clients:read", "offline_access"]),
    );
    expect(meta.client_id_metadata_document_supported).toBe(true);
  });

  it("ressourcens metadata peger på MCP-URL'en og autorisationsserveren", async () => {
    const res = await protectedResourceMetadata();
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.resource).toBe(MCP_URL);
    expect(meta.authorization_servers).toEqual([`${ORIGIN}/api/auth`]);
    expect(meta.scopes_supported).toContain("time:write");
    expect(meta.scopes_supported).not.toContain("*");
  });

  it("MCP svarer 401 med resource_metadata i WWW-Authenticate", async () => {
    const res = await mcp("tools/list", null);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/v1/mcp"`,
    );
  });
});

describe("OAuth-flowet til MCP", () => {
  beforeAll(() => {
    testState.paidOrgs.clear();
  });
  beforeEach(() => {
    testState.audit.length = 0;
  });

  it("uden login sendes brugeren til login-siden med signeret forespørgsel", async () => {
    const clientId = await registerClient();
    const res = await call(
      `/api/auth/oauth2/authorize?${authorizeQuery(clientId, pkce().challenge)}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location") ?? "", ORIGIN);
    expect(location.pathname).toBe("/auth/oauth/login");
    expect(location.searchParams.get("sig")).toBeTruthy();
    // Login-siden fortsætter /oauth2/authorize uden signeringsparametre
    const back = authorizePathFromSignedQuery(location.searchParams);
    expect(back.startsWith("/api/auth/oauth2/authorize?")).toBe(true);
    const params = new URLSearchParams(back.split("?")[1]);
    expect(params.get("client_id")).toBe(clientId);
    expect(params.get("sig")).toBeNull();
  });

  it("DCR → authorize (PKCE) → samtykke → token → tools/list med Bearer", async () => {
    const { orgId, tokens } = await connectedUser("flow@example.com");
    expect(tokens.access_token?.startsWith("tt_at_")).toBe(true);
    expect(tokens.refresh_token?.startsWith("tt_rt_")).toBe(true);
    expect(testState.audit).toEqual([{ action: "mcp_app_connected", orgId }]);

    const list = await mcp("tools/list", tokens.access_token as string);
    expect(list.status).toBe(200);
    expect(
      list.body.result.tools.map((t: { name: string }) => t.name),
    ).toContain("list_clients");

    const who = await mcp("tools/call", tokens.access_token as string, {
      name: "whoami",
      arguments: {},
    });
    const info = JSON.parse(who.body.result.content[0].text);
    expect(info.organizationId).toBe(orgId);
    expect(info.scopes).toEqual([
      "clients:read",
      "time:write",
      "offline_access",
    ]);

    // Scopes håndhæves: invoices:read er ikke givet
    const denied = await mcp("tools/call", tokens.access_token as string, {
      name: "list_invoices",
      arguments: {},
    });
    expect(denied.body.result.isError).toBe(true);
    const allowed = await mcp("tools/call", tokens.access_token as string, {
      name: "list_clients",
      arguments: {},
    });
    expect(allowed.body.result.isError).toBeFalsy();
  });

  it("forkert PKCE-verifier afvises ved token-udveksling", async () => {
    const jar = await signUp("pkce@example.com");
    const orgId = await createOrg(jar, "Pkce");
    testState.paidOrgs.add(orgId);
    const clientId = await registerClient();
    const { challenge } = pkce();
    const { code } = await authorizeAndConsent(jar, clientId, challenge);
    const res = await exchange(clientId, code as string, pkce().verifier);
    expect(res.status).toBe(400);
    expect(res.body.access_token).toBeUndefined();
  });

  it("refresh token roterer og giver et nyt brugbart adgangstoken", async () => {
    const { clientId, tokens } = await connectedUser("refresh@example.com");
    const res = await call("/api/auth/oauth2/token", {
      form: {
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token as string,
        client_id: clientId,
        resource: MCP_URL,
      },
    });
    expect(res.status).toBe(200);
    const next = (await res.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcp("tools/list", next.access_token)).status).toBe(200);
  });

  it("revoke gør adgangstokenet ugyldigt med det samme", async () => {
    const { clientId, tokens } = await connectedUser("revoke@example.com");
    expect(
      (await mcp("tools/list", tokens.access_token as string)).status,
    ).toBe(200);
    const res = await call("/api/auth/oauth2/revoke", {
      form: {
        token: tokens.access_token as string,
        token_type_hint: "access_token",
        client_id: clientId,
      },
    });
    expect(res.status).toBe(200);
    expect(
      (await mcp("tools/list", tokens.access_token as string)).status,
    ).toBe(401);
  });

  it("gratis plan: samtykket afvises med dansk fejl", async () => {
    const jar = await signUp("gratis@example.com");
    await createOrg(jar, "Gratis"); // ikke i paidOrgs
    const clientId = await registerClient();
    const { code, consentRes } = await authorizeAndConsent(
      jar,
      clientId,
      pkce().challenge,
    );
    expect(code).toBeNull();
    expect(consentRes.status).toBe(403);
    const body = (await consentRes.json()) as { message: string };
    expect(body.message).toContain("betalt abonnement");
    expect(testState.audit).toEqual([]);
  });

  it("plan der udløber efter forbindelsen: MCP svarer 403, ikke 401", async () => {
    const { orgId, tokens } = await connectedUser("udloeb@example.com");
    testState.paidOrgs.delete(orgId);
    const res = await mcp("tools/list", tokens.access_token as string);
    expect(res.status).toBe(403);
    expect(res.body.error_description).toContain("betalt abonnement");
  });

  it("org-valg: tokenet bindes til den valgte organisation", async () => {
    const jar = await signUp("toorg@example.com");
    const orgA = await createOrg(jar, "Alfa");
    const orgB = await createOrg(jar, "Beta");
    testState.paidOrgs.add(orgA);
    testState.paidOrgs.add(orgB);
    // Samtykkeskærmen sætter den valgte org aktiv før samtykket
    await setActive(jar, orgA);
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const { code } = await authorizeAndConsent(jar, clientId, challenge);
    const { body } = await exchange(clientId, code as string, verifier);
    const info = await verifyMcpToken(new Request(MCP_URL), body.access_token);
    expect(info?.extra?.organizationId).toBe(orgA);
  });

  it("forkert org: et medlemskab der er væk afviser tokenet", async () => {
    const { orgId, tokens } = await connectedUser("fjernet@example.com");
    const ctx = await testAuth.$context;
    await ctx.adapter.deleteMany({
      model: "member",
      where: [{ field: "organizationId", value: orgId }],
    });
    expect(
      (await mcp("tools/list", tokens.access_token as string)).status,
    ).toBe(401);
  });

  it("forkert org: en fremmed org kan ikke vælges", async () => {
    const owner = await signUp("ejer@example.com");
    const foreignOrg = await createOrg(owner, "Fremmed");
    const jar = await signUp("udefra@example.com");
    const res = await call("/api/auth/organization/set-active", {
      jar,
      json: { organizationId: foreignOrg },
    });
    expect(res.status).not.toBe(200);
  });

  it("et token til en anden ressource afvises", async () => {
    const { tokens } = await connectedUser("ressource@example.com");
    const ctx = await testAuth.$context;
    const raw = (tokens.access_token as string).slice("tt_at_".length);
    const hash = createHash("sha256").update(raw).digest("hex");
    await ctx.adapter.update({
      model: "oauthAccessToken",
      where: [{ field: "token", value: hash }],
      update: { resources: ["https://evil.example/mcp"] },
    });
    expect(
      (await mcp("tools/list", tokens.access_token as string)).status,
    ).toBe(401);
  });
});

// "Forbundne apps" er ren Drizzle-SQL og kører derfor kun mod Postgres
// (MCP_OAUTH_TEST_PG_URL, se mcp-oauth-test-auth.ts).
describe.runIf(process.env.MCP_OAUTH_TEST_PG_URL)(
  "Forbundne apps (Postgres)",
  () => {
    it("viser forbindelsen og afbryder den, så tokenet straks afvises", async () => {
      const { orgId, tokens } = await connectedUser("forbundet@example.com");
      const [
        { drizzle },
        { default: postgres },
        schema,
        { connectedAppsRouter },
      ] = await Promise.all([
        import("drizzle-orm/postgres-js"),
        import("postgres"),
        import("@/lib/db/schema"),
        import("@/lib/trpc/routers/connectedApps"),
      ]);
      const pg = drizzle(
        postgres(process.env.MCP_OAUTH_TEST_PG_URL as string),
        {
          schema,
        },
      );
      const info = await verifyMcpToken(
        new Request(MCP_URL),
        tokens.access_token,
      );
      const userId = String(info?.extra?.userId);
      const apps = connectedAppsRouter.createCaller({
        // biome-ignore lint/suspicious/noExplicitAny: minimal session som isAuthed læser
        session: { user: { id: userId }, activeOrganizationId: orgId } as any,
        db: pg as never,
        headers: new Headers(),
      });

      const list = await apps.list();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        clientName: "Claude",
        organizationId: orgId,
        organizationName: "Firma",
      });
      expect(list[0].lastUsedAt).toBeInstanceOf(Date);

      await apps.revoke({ id: list[0].id });
      expect(await apps.list()).toEqual([]);
      expect(
        (await mcp("tools/list", tokens.access_token as string)).status,
      ).toBe(401);
      const refresh = await call("/api/auth/oauth2/token", {
        form: {
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token as string,
          client_id: list[0].clientId,
        },
      });
      expect(refresh.status).not.toBe(200);
      const audit = await pg
        .select({ action: schema.orgAuditLogs.action })
        .from(schema.orgAuditLogs);
      expect(audit.map((a) => a.action)).toContain("mcp_app_revoked");
    });
  },
);

describe("tk_live_-nøgler virker uændret", () => {
  it("en gyldig nøgle giver adgang med nøglens scopes og org", async () => {
    state.apiKeyFindFirst.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      organizationId: "org-1",
      scopes: ["clients:read"],
      isRevoked: false,
      expiresAt: null,
      lastUsedAt: new Date(),
    });
    const res = await mcp("tools/call", "tk_live_abc", {
      name: "whoami",
      arguments: {},
    });
    expect(res.status).toBe(200);
    const info = JSON.parse(res.body.result.content[0].text);
    expect(info).toEqual({
      userId: "user-1",
      organizationId: "org-1",
      scopes: ["clients:read"],
    });
  });

  it("en tilbagekaldt nøgle afvises med 401", async () => {
    state.apiKeyFindFirst.mockResolvedValue({
      id: "key-1",
      userId: "user-1",
      isRevoked: true,
    });
    expect((await mcp("tools/list", "tk_live_abc")).status).toBe(401);
  });
});
