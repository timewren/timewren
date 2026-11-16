import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  microsoftEntra,
  microsoftProfileEmail,
  resolveMicrosoftAccountId,
} from "../microsoft-entra";

// Hele Microsoft-flowet gennem better-auth 1.7's rigtige endpoints
// (/sign-in/social → /callback/:id, /link-social), med Microsofts token- og
// nøgle-endpoints mocket og en id_token signeret med vores egen nøgle.

const BASE = "http://localhost:3000";
const CLIENT_ID = "00000000-1111-2222-3333-444444444444";
const TENANT = "72f988bf-86f1-41af-91ab-2d7cd011db47";
const KID = "test-kid";

let privateKey: CryptoKey;
let publicJwk: JWK;
let foreignKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: "RS256" };
  foreignKey = (await generateKeyPair("RS256")).privateKey;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type Claims = {
  oid: string;
  sub: string;
  email?: string;
  preferred_username?: string;
  name?: string;
};

async function idToken(claims: Claims, key = privateKey) {
  return new SignJWT({
    ...claims,
    tid: TENANT,
  })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(`https://login.microsoftonline.com/${TENANT}/v2.0`)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(key);
}

/** Stubber fetch, så token- og nøgle-endpoints svarer som Microsoft. */
function mockMicrosoft(token: string) {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://login.microsoftonline.com/")) {
        calls.push(url);
        if (url.includes("/oauth2/v2.0/token")) {
          return Response.json({
            access_token: "at",
            id_token: token,
            token_type: "Bearer",
            expires_in: 3600,
          });
        }
        if (url.includes("/discovery/v2.0/keys")) {
          return Response.json({ keys: [publicJwk] });
        }
        return new Response("not found", { status: 404 });
      }
      return realFetch(input, init);
    },
  );
  return calls;
}

function setup() {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: BASE,
    secret: "t".repeat(48),
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    // better-auth slår origin-/callbackURL-tjekket fra under NODE_ENV=test;
    // tving det til som i prod.
    advanced: { disableOriginCheck: false },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "github", "discord"],
      },
    },
    plugins: [
      microsoftEntra({
        clientId: CLIENT_ID,
        clientSecret: "secret",
        tenantId: "common",
        hasLegacyAccount: async (sub) =>
          db.account.some(
            (a) => a.providerId === "microsoft-entra-id" && a.accountId === sub,
          ),
      }),
    ],
  });
  return { auth, db };
}

function cookiesFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function startFlow(
  auth: ReturnType<typeof setup>["auth"],
  path: "/sign-in/social" | "/link-social",
  cookie = "",
) {
  const res = await auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({
        provider: "microsoft-entra-id",
        callbackURL: "/dashboard",
        disableRedirect: true,
      }),
    }),
  );
  expect(res.status).toBe(200);
  const { url } = (await res.json()) as { url: string };
  return {
    url: new URL(url),
    cookie: [cookie, cookiesFrom(res)].filter(Boolean).join("; "),
  };
}

function stateOf(url: URL): string {
  const state = url.searchParams.get("state");
  if (!state) throw new Error("state mangler i authorize-URL'en");
  return state;
}

async function finishFlow(
  auth: ReturnType<typeof setup>["auth"],
  state: string,
  cookie: string,
) {
  return auth.handler(
    new Request(
      `${BASE}/api/auth/callback/microsoft-entra-id?code=abc&state=${state}`,
      { headers: { cookie } },
    ),
  );
}

async function signUpWithPassword(
  auth: ReturnType<typeof setup>["auth"],
  db: ReturnType<typeof setup>["db"],
  email: string,
) {
  await auth.api.signUpEmail({
    body: { email, password: "kodeord".repeat(3), name: "Test" },
  });
  const user = db.user.find((u) => u.email === email);
  if (!user) throw new Error("bruger ikke oprettet");
  return user;
}

describe("resolveMicrosoftAccountId", () => {
  it("bruger oid for nye konti", async () => {
    const lookup = vi.fn(async () => false);
    expect(
      await resolveMicrosoftAccountId({ oid: "o1", sub: "s1" }, lookup),
    ).toBe("o1");
    expect(lookup).toHaveBeenCalledWith("s1");
  });
  it("genbruger sub når 1.6 gemte kontoen på sub", async () => {
    expect(
      await resolveMicrosoftAccountId(
        { oid: "o1", sub: "s1" },
        async () => true,
      ),
    ).toBe("s1");
  });
  it("slår ikke op når sub mangler eller er lig oid", async () => {
    const lookup = vi.fn(async () => true);
    expect(
      await resolveMicrosoftAccountId({ oid: "o1", sub: "o1" }, lookup),
    ).toBe("o1");
    expect(
      await resolveMicrosoftAccountId(
        { oid: "o1" } as { oid: string; sub: string },
        lookup,
      ),
    ).toBe("o1");
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("microsoftProfileEmail", () => {
  it("falder tilbage til preferred_username", () => {
    expect(microsoftProfileEmail({ email: "a@b.dk" })).toBe("a@b.dk");
    expect(
      microsoftProfileEmail({ email: "", preferred_username: "upn@b.dk" }),
    ).toBe("upn@b.dk");
    expect(microsoftProfileEmail({})).toBeUndefined();
  });
});

describe("Microsoft Entra-login via better-auth 1.7", () => {
  it("sender brugeren til common-tenant med den nye callback-URI", async () => {
    const { auth } = setup();
    const { url } = await startFlow(auth, "/sign-in/social");
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${BASE}/api/auth/callback/microsoft-entra-id`,
    );
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([
      "email",
      "openid",
      "profile",
    ]);
  });

  it("opretter en ny bruger nøglet på oid", async () => {
    const { auth, db } = setup();
    mockMicrosoft(
      await idToken({
        oid: "oid-ny",
        sub: "sub-ny",
        email: "ny@example.dk",
        name: "Ny",
      }),
    );
    const { url, cookie } = await startFlow(auth, "/sign-in/social");
    const res = await finishFlow(auth, stateOf(url), cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(db.account).toHaveLength(1);
    expect(db.account[0]).toMatchObject({
      providerId: "microsoft-entra-id",
      accountId: "oid-ny",
    });
    expect(db.user[0]).toMatchObject({ email: "ny@example.dk" });
  });

  it("finder en konto som 1.6 gemte på sub (ingen ny bruger)", async () => {
    const { auth, db } = setup();
    const user = await signUpWithPassword(auth, db, "gammel@example.dk");
    db.account.push({
      id: "legacy-acc",
      userId: user.id,
      providerId: "microsoft-entra-id",
      accountId: "sub-gammel",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockMicrosoft(
      await idToken({
        oid: "oid-gammel",
        sub: "sub-gammel",
        email: "gammel@example.dk",
      }),
    );
    const { url, cookie } = await startFlow(auth, "/sign-in/social");
    const res = await finishFlow(auth, stateOf(url), cookie);
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(db.user).toHaveLength(1);
    expect(
      db.account.filter((a) => a.providerId === "microsoft-entra-id"),
    ).toEqual([
      expect.objectContaining({ id: "legacy-acc", accountId: "sub-gammel" }),
    ]);
    expect(db.session.some((s) => s.userId === user.id)).toBe(true);
  });

  it("auto-linker ikke en eksisterende e-mailbruger ved login (nOAuth)", async () => {
    const { auth, db } = setup();
    await signUpWithPassword(auth, db, "offer@example.dk");
    const sessionsBefore = db.session.length;
    mockMicrosoft(
      await idToken({
        oid: "oid-angriber",
        sub: "sub-angriber",
        email: "offer@example.dk",
      }),
    );
    const { url, cookie } = await startFlow(auth, "/sign-in/social");
    const res = await finishFlow(auth, stateOf(url), cookie);
    expect(res.headers.get("location")).toContain("error=");
    expect(db.account.some((a) => a.providerId === "microsoft-entra-id")).toBe(
      false,
    );
    expect(db.session).toHaveLength(sessionsBefore);
  });

  it("lader ikke klienten forfalske link-state via additionalData", async () => {
    const { auth, db } = setup();
    const victim = await signUpWithPassword(auth, db, "offer@example.dk");
    mockMicrosoft(
      await idToken({
        oid: "oid-angriber",
        sub: "sub-angriber",
        email: "offer@example.dk",
      }),
    );
    const start = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({
          provider: "microsoft-entra-id",
          callbackURL: "/dashboard",
          disableRedirect: true,
          additionalData: {
            link: { userId: victim.id, email: "offer@example.dk" },
          },
        }),
      }),
    );
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const res = await finishFlow(
      auth,
      stateOf(new URL(url)),
      cookiesFrom(start),
    );
    expect(res.headers.get("location")).toContain("error=");
    expect(db.account.some((a) => a.providerId === "microsoft-entra-id")).toBe(
      false,
    );
  });

  it("kobler Microsoft til en indlogget bruger fra Indstillinger", async () => {
    const { auth, db } = setup();
    const user = await signUpWithPassword(auth, db, "ejer@example.dk");
    user.emailVerified = true;
    const signIn = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({
          email: "ejer@example.dk",
          password: "kodeord".repeat(3),
        }),
      }),
    );
    expect(signIn.status).toBe(200);
    mockMicrosoft(
      await idToken({
        oid: "oid-ejer",
        sub: "sub-ejer",
        email: "ejer@example.dk",
      }),
    );
    const { url, cookie } = await startFlow(
      auth,
      "/link-social",
      cookiesFrom(signIn),
    );
    const res = await finishFlow(auth, stateOf(url), cookie);
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(
      db.account.find((a) => a.providerId === "microsoft-entra-id"),
    ).toMatchObject({
      userId: user.id,
      accountId: "oid-ejer",
    });
  });

  it("afviser kobling når Microsoft-e-mailen ikke matcher kontoen", async () => {
    const { auth, db } = setup();
    const user = await signUpWithPassword(auth, db, "ejer@example.dk");
    user.emailVerified = true;
    const signIn = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({
          email: "ejer@example.dk",
          password: "kodeord".repeat(3),
        }),
      }),
    );
    mockMicrosoft(
      await idToken({ oid: "oid-x", sub: "sub-x", email: "anden@example.dk" }),
    );
    const { url, cookie } = await startFlow(
      auth,
      "/link-social",
      cookiesFrom(signIn),
    );
    const res = await finishFlow(auth, stateOf(url), cookie);
    expect(res.headers.get("location")).toContain("error=");
    expect(db.account.some((a) => a.providerId === "microsoft-entra-id")).toBe(
      false,
    );
  });

  it("afviser en id_token signeret med en fremmed nøgle", async () => {
    const { auth, db } = setup();
    mockMicrosoft(
      await idToken(
        { oid: "oid-falsk", sub: "sub-falsk", email: "falsk@example.dk" },
        foreignKey,
      ),
    );
    const { url, cookie } = await startFlow(auth, "/sign-in/social");
    const res = await finishFlow(auth, stateOf(url), cookie);
    expect(res.headers.get("location")).toContain("error=");
    expect(db.user).toHaveLength(0);
  });

  it("bevarer 1.6's /sign-in/oauth2 for udgivne mobil-builds", async () => {
    const { auth, db } = setup();
    mockMicrosoft(
      await idToken({
        oid: "oid-app",
        sub: "sub-app",
        email: "app@example.dk",
      }),
    );
    const start = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/oauth2`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({
          providerId: "microsoft-entra-id",
          callbackURL: "/dashboard",
        }),
      }),
    );
    expect(start.status).toBe(200);
    const body = (await start.json()) as { url: string; redirect: boolean };
    expect(body.redirect).toBe(true);
    const url = new URL(body.url);
    expect(url.searchParams.get("redirect_uri")).toBe(
      `${BASE}/api/auth/callback/microsoft-entra-id`,
    );
    const res = await finishFlow(auth, stateOf(url), cookiesFrom(start));
    expect(res.headers.get("location")).toBe("/dashboard");
    expect(db.account[0]).toMatchObject({ accountId: "oid-app" });
  });

  it("afviser /sign-in/oauth2 for andre providers og fremmede callbackURLs", async () => {
    const { auth } = setup();
    const call = (body: Record<string, string>) =>
      auth.handler(
        new Request(`${BASE}/api/auth/sign-in/oauth2`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE },
          body: JSON.stringify(body),
        }),
      );
    expect((await call({ providerId: "okta" })).status).toBe(404);
    expect(
      (
        await call({
          providerId: "microsoft-entra-id",
          callbackURL: "https://evil.example/steal",
        })
      ).status,
    ).toBe(403);
  });

  it("tillader ikke id_token-login direkte fra klienten", async () => {
    const { auth } = setup();
    const res = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify({
          provider: "microsoft-entra-id",
          idToken: {
            token: await idToken({ oid: "o", sub: "s", email: "x@example.dk" }),
          },
        }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
