import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Apple-tokens tilbagekaldes best effort efter kontosletning (#919): en fejl
// må aldrig kaste, skal logges til manuel opfølgning, og tokenet må aldrig
// stå i loggen. Native iOS-login gemmer intet token; dér byttes appens
// authorization code til et token (5.1.1(v)), udstedt til appens bundle-id.

const {
  APPLE_REVOKE_URL,
  APPLE_TOKEN_URL,
  collectAppleTokens,
  exchangeAppleAuthorizationCode,
  getAppleAppBundleId,
  getAppleClientSecret,
  revokeAppleTokens,
} = await import("@/lib/auth/apple");

function configureApple() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  vi.stubEnv("APPLE_TEAM_ID", "TEAMTEST01");
  vi.stubEnv("APPLE_KEY_ID", "KEYTEST01");
  vi.stubEnv("APPLE_CLIENT_ID", "dk.timetrack.test.web");
  vi.stubEnv("APPLE_APP_BUNDLE_IDENTIFIER", "dk.timetrack.test.app");
  vi.stubEnv(
    "APPLE_PRIVATE_KEY",
    privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  );
}

function logged(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => c.map(String).join(" "));
}

/** En del (0 = header, 1 = claims) af en JWT, dekodet til tekst. */
function jwtPart(jwt: string, index: number): string {
  return Buffer.from(jwt.split(".")[index], "base64url").toString("utf8");
}

function jwtClaims(jwt: string): Record<string, unknown> {
  return JSON.parse(jwtPart(jwt, 1));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("revokeAppleTokens", () => {
  let error: { mock: { calls: unknown[][] } };
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gør intet uden tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await revokeAppleTokens([], "u1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uden Apple-konfiguration: intet kald, men manuel opfølgning", async () => {
    vi.stubEnv("APPLE_CLIENT_ID", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const token = randomUUID();
    await revokeAppleTokens([{ token, hint: "refresh_token" }], "u1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged(error).some((l) => l.includes("MANUEL OPFØLGNING"))).toBe(
      true,
    );
    expect(logged(error).some((l) => l.includes(token))).toBe(false);
  });

  it("netværksfejl kaster ikke og logger ikke tokenet", async () => {
    configureApple();
    const token = randomUUID();
    const fetchMock = vi.fn(async () => {
      throw new Error("timeout");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      revokeAppleTokens([{ token, hint: "refresh_token" }], "u1"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(APPLE_REVOKE_URL, expect.anything());
    expect(logged(error).some((l) => l.includes("MANUEL OPFØLGNING"))).toBe(
      true,
    );
    expect(logged(error).some((l) => l.includes(token))).toBe(false);
  });
});

describe("revokeAppleTokens: client-id pr. token", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function revokeBodies(fetchMock: { mock: { calls: unknown[][] } }) {
    return fetchMock.mock.calls.map((call) => {
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe(APPLE_REVOKE_URL);
      return new URLSearchParams(String(init.body));
    });
  }

  it("et native token tilbagekaldes med tokenets bundle-id og en secret med sub = bundle-id", async () => {
    configureApple();
    const token = randomUUID();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeAppleTokens(
      [{ token, hint: "refresh_token", clientId: "dk.timetrack.test.app" }],
      "u1",
    );

    const [body] = revokeBodies(fetchMock);
    expect(body.get("client_id")).toBe("dk.timetrack.test.app");
    expect(jwtClaims(String(body.get("client_secret"))).sub).toBe(
      "dk.timetrack.test.app",
    );
    expect(body.get("token")).toBe(token);
    expect(body.get("token_type_hint")).toBe("refresh_token");
  });

  it("et token uden clientId (web-login) bruger stadig Services ID'et", async () => {
    configureApple();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeAppleTokens(
      [{ token: randomUUID(), hint: "access_token" }],
      "u1",
    );

    const [body] = revokeBodies(fetchMock);
    expect(body.get("client_id")).toBe("dk.timetrack.test.web");
    expect(jwtClaims(String(body.get("client_secret"))).sub).toBe(
      "dk.timetrack.test.web",
    );
  });

  it("web- og native token i samme kald får hver sit client-id og sin secret", async () => {
    configureApple();
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeAppleTokens(
      [
        { token: randomUUID(), hint: "refresh_token" },
        {
          token: randomUUID(),
          hint: "refresh_token",
          clientId: "dk.timetrack.test.app",
        },
      ],
      "u1",
    );

    const bodies = revokeBodies(fetchMock);
    expect(bodies.map((b) => b.get("client_id"))).toEqual([
      "dk.timetrack.test.web",
      "dk.timetrack.test.app",
    ]);
    expect(
      bodies.map((b) => jwtClaims(String(b.get("client_secret"))).sub),
    ).toEqual(["dk.timetrack.test.web", "dk.timetrack.test.app"]);
  });

  it("uden APPLE_CLIENT_ID kan et native token stadig tilbagekaldes", async () => {
    configureApple();
    vi.stubEnv("APPLE_CLIENT_ID", "");
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeAppleTokens(
      [
        { token: randomUUID(), hint: "refresh_token" },
        {
          token: randomUUID(),
          hint: "refresh_token",
          clientId: "dk.timetrack.test.app",
        },
      ],
      "u1",
    );

    // Web-tokenet kan ikke (intet Services ID), det native kan
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(revokeBodies(fetchMock)[0].get("client_id")).toBe(
      "dk.timetrack.test.app",
    );
  });
});

describe("getAppleClientSecret", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uden argument gælder secreten Services ID'et (web-login uændret)", () => {
    configureApple();
    const claims = jwtClaims(getAppleClientSecret());
    expect(claims.sub).toBe("dk.timetrack.test.web");
    expect(claims.iss).toBe("TEAMTEST01");
    expect(claims.aud).toBe("https://appleid.apple.com");
  });

  it("med argument er sub det givne client-id, med samme team og nøgle", () => {
    configureApple();
    const secret = getAppleClientSecret("dk.timetrack.test.app");
    expect(jwtClaims(secret)).toMatchObject({
      sub: "dk.timetrack.test.app",
      iss: "TEAMTEST01",
    });
    expect(JSON.parse(jwtPart(secret, 0))).toMatchObject({
      alg: "ES256",
      kid: "KEYTEST01",
    });
    expect(secret.split(".")).toHaveLength(3);
  });

  it("er tom uden konfiguration og caches ikke, så en senere konfiguration slår igennem", () => {
    vi.stubEnv("APPLE_PRIVATE_KEY", "");
    expect(getAppleClientSecret("dk.timetrack.cache.test")).toBe("");
    configureApple();
    expect(jwtClaims(getAppleClientSecret("dk.timetrack.cache.test")).sub).toBe(
      "dk.timetrack.cache.test",
    );
  });

  it("appens bundle-id har en default og kan overstyres", () => {
    vi.stubEnv("APPLE_APP_BUNDLE_IDENTIFIER", "");
    expect(getAppleAppBundleId()).toBe("dk.timetrack.app");
    vi.stubEnv("APPLE_APP_BUNDLE_IDENTIFIER", "dk.timetrack.test.app");
    expect(getAppleAppBundleId()).toBe("dk.timetrack.test.app");
  });
});

describe("exchangeAppleAuthorizationCode", () => {
  let error: { mock: { calls: unknown[][] } };
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bytter koden med bundle-id som client_id og en secret med sub = bundle-id", async () => {
    configureApple();
    const code = randomUUID();
    const refresh = randomUUID();
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        access_token: randomUUID(),
        refresh_token: refresh,
        token_type: "Bearer",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeAppleAuthorizationCode(code, "u1");

    expect(result).toEqual({
      token: refresh,
      hint: "refresh_token",
      clientId: "dk.timetrack.test.app",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(APPLE_TOKEN_URL);
    expect(init.method).toBe("POST");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("client_id")).toBe("dk.timetrack.test.app");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe(code);
    expect(body.has("redirect_uri")).toBe(false);
    expect(jwtClaims(String(body.get("client_secret"))).sub).toBe(
      "dk.timetrack.test.app",
    );
    // Services ID'et bruges aldrig til native koder
    expect(body.get("client_id")).not.toBe("dk.timetrack.test.web");
  });

  it("falder tilbage til access-tokenet, når Apple ikke sender et refresh-token", async () => {
    configureApple();
    const access = randomUUID();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ access_token: access })),
    );
    await expect(exchangeAppleAuthorizationCode(randomUUID())).resolves.toEqual(
      {
        token: access,
        hint: "access_token",
        clientId: "dk.timetrack.test.app",
      },
    );
  });

  it("uden APPLE_APP_BUNDLE_IDENTIFIER bruges default-bundle-id'et", async () => {
    configureApple();
    vi.stubEnv("APPLE_APP_BUNDLE_IDENTIFIER", "");
    const fetchMock = vi.fn(async () =>
      jsonResponse({ refresh_token: randomUUID() }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await exchangeAppleAuthorizationCode(randomUUID());
    expect(result?.clientId).toBe("dk.timetrack.app");
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(new URLSearchParams(String(init.body)).get("client_id")).toBe(
      "dk.timetrack.app",
    );
  });

  it("HTTP-fejl giver null og logger status og Apples fejlkode, aldrig kode eller tokens", async () => {
    configureApple();
    const code = randomUUID();
    const leaked = randomUUID();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: "invalid_grant",
            error_description: `code ${code} er brugt`,
            refresh_token: leaked,
          },
          400,
        ),
      ),
    );
    await expect(
      exchangeAppleAuthorizationCode(code, "u1"),
    ).resolves.toBeNull();
    const lines = logged(error);
    expect(lines.some((l) => l.includes("MANUEL OPFØLGNING"))).toBe(true);
    expect(lines.some((l) => l.includes("HTTP 400"))).toBe(true);
    expect(lines.some((l) => l.includes("invalid_grant"))).toBe(true);
    expect(lines.some((l) => l.includes(code))).toBe(false);
    expect(lines.some((l) => l.includes(leaked))).toBe(false);
  });

  it("netværksfejl og timeout kaster ikke og giver null uden kode i loggen", async () => {
    configureApple();
    const code = randomUUID();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("timeout");
      }),
    );
    await expect(
      exchangeAppleAuthorizationCode(code, "u1"),
    ).resolves.toBeNull();
    const lines = logged(error);
    expect(lines.some((l) => l.includes("MANUEL OPFØLGNING"))).toBe(true);
    expect(lines.some((l) => l.includes(code))).toBe(false);
  });

  it("svar uden token, uden JSON eller med tomt token giver null", async () => {
    configureApple();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ id_token: randomUUID() }))
        .mockResolvedValueOnce(new Response("ikke json", { status: 200 }))
        .mockResolvedValueOnce(jsonResponse({ refresh_token: "" })),
    );
    await expect(exchangeAppleAuthorizationCode("c1")).resolves.toBeNull();
    await expect(exchangeAppleAuthorizationCode("c2")).resolves.toBeNull();
    await expect(exchangeAppleAuthorizationCode("c3")).resolves.toBeNull();
    expect(
      logged(error).filter((l) => l.includes("MANUEL OPFØLGNING")),
    ).toHaveLength(3);
  });

  it("uden Apple-konfiguration: intet kald og null", async () => {
    vi.stubEnv("APPLE_PRIVATE_KEY", "");
    // Eget bundle-id, så en cachet secret fra en tidligere test ikke genbruges
    vi.stubEnv("APPLE_APP_BUNDLE_IDENTIFIER", "dk.timetrack.unconfigured.app");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      exchangeAppleAuthorizationCode("c1", "u1"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged(error).some((l) => l.includes("MANUEL OPFØLGNING"))).toBe(
      true,
    );
  });
});

describe("collectAppleTokens", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function dbWith(rows: Array<Record<string, unknown>>, brand = "timetrack") {
    return {
      query: {
        accounts: { findMany: vi.fn(async () => rows) },
        users: { findFirst: vi.fn(async () => ({ brand })) },
      },
    };
  }

  it("en TimeWren-konto får TimeWrens Services ID på tokenet, TimeTrack-konti intet", async () => {
    vi.stubEnv("TIMEWREN_APPLE_CLIENT_ID", "com.timewren.test.web");
    const refresh = randomUUID();
    await expect(
      collectAppleTokens(
        dbWith(
          [{ refreshToken: refresh, accessToken: null }],
          "timewren",
        ) as never,
        "u1",
      ),
    ).resolves.toEqual([
      {
        token: refresh,
        hint: "refresh_token",
        clientId: "com.timewren.test.web",
      },
    ]);
    await expect(
      collectAppleTokens(
        dbWith([{ refreshToken: refresh, accessToken: null }]) as never,
        "u2",
      ),
    ).resolves.toEqual([{ token: refresh, hint: "refresh_token" }]);
  });

  it("TimeWren- og TimeTrack-tokens tilbagekaldes med hvert sit Services ID", async () => {
    configureApple();
    vi.stubEnv("TIMEWREN_APPLE_CLIENT_ID", "com.timewren.test.web");
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const wren = await collectAppleTokens(
      dbWith([{ refreshToken: randomUUID() }], "timewren") as never,
      "u1",
    );
    const track = await collectAppleTokens(
      dbWith([{ refreshToken: randomUUID() }]) as never,
      "u2",
    );
    await revokeAppleTokens(wren, "u1");
    await revokeAppleTokens(track, "u2");

    const bodies = fetchMock.mock.calls.map(
      (call) =>
        new URLSearchParams(
          String((call as unknown as [string, RequestInit])[1].body),
        ),
    );
    expect(bodies.map((b) => b.get("client_id"))).toEqual([
      "com.timewren.test.web",
      "dk.timetrack.test.web",
    ]);
    expect(
      bodies.map((b) => jwtClaims(String(b.get("client_secret"))).sub),
    ).toEqual(["com.timewren.test.web", "dk.timetrack.test.web"]);
  });

  it("en TimeWren-konto uden TimeWren-klient tilbagekaldes aldrig med TimeTracks klient", async () => {
    configureApple();
    vi.stubEnv("TIMEWREN_APPLE_CLIENT_ID", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const tokens = await collectAppleTokens(
      dbWith([{ refreshToken: randomUUID() }], "timewren") as never,
      "u1",
    );
    await revokeAppleTokens(tokens, "u1");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(logged(error).some((l) => l.includes("MANUEL OPFØLGNING"))).toBe(
      true,
    );
  });

  it("foretrækker refresh-token og springer native login uden token over", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refresh = randomUUID();
    const access = randomUUID();
    const db = dbWith([
      { refreshToken: refresh, accessToken: access },
      { refreshToken: null, accessToken: access },
      { refreshToken: null, accessToken: null },
    ]);
    await expect(collectAppleTokens(db as never, "u1")).resolves.toEqual([
      { token: refresh, hint: "refresh_token" },
      { token: access, hint: "access_token" },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("native login"));
  });

  it("native login uden gemt token er ikke et ufuldført arbejde, når koden er ombyttet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const db = dbWith([{ refreshToken: null, accessToken: null }]);
    await expect(
      collectAppleTokens(db as never, "u1", { nativeTokenObtained: true }),
    ).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(logged(info).some((l) => l.includes("native login"))).toBe(true);
  });
});
