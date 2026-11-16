import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Kontrakttest for desktop-indstillingerne: de er det ENESTE sted serveren
// sender en integrationsnøgle til en enhed, så adgangskontrollen skal kunne
// fejle hårdt. Ruten kaldes med rigtige device-tokens (fra desktop-auth), så
// 401'en testes mod den ægte verifikation.

const USER = "user-1";
const ORG = "org-1";

const state = vi.hoisted(() => ({
  /** Brugerens række i `user`-tabellen. */
  userRow: null as Record<string, unknown> | null,
  /** Device-tokenets medlemskab (null = ikke medlem af nogen org). */
  membership: null as { organizationId: string; role: string | null } | null,
  /** `set()`-værdierne i hvert update-kald. */
  updates: [] as Record<string, unknown>[],
  /** Værdierne i `where()` på hvert update-kald. */
  updateTargets: [] as unknown[][],
  /** Værdierne i `where()` på hvert select på `user`. */
  userLookups: [] as unknown[][],
}));

vi.mock("@/lib/desktop-org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/desktop-org")>();
  return {
    ...actual,
    getDesktopMembership: vi.fn(async () => state.membership),
  };
});

vi.mock("@/lib/desktop-rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  getClientIp: vi.fn(() => "test-ip"),
  rateLimitResponse: vi.fn(
    () =>
      new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 }),
  ),
}));

vi.mock("@/lib/db", () => {
  // Param-værdier i et drizzle-condition-træ (eq/and pakker dem i Param).
  function conditionParams(node: unknown, out: unknown[] = []): unknown[] {
    if (!node || typeof node !== "object") return out;
    const chunk = node as {
      constructor?: { name?: string };
      queryChunks?: unknown[];
    };
    if (chunk.constructor?.name === "Param") {
      out.push((node as { value: unknown }).value);
      return out;
    }
    for (const child of chunk.queryChunks ?? []) conditionParams(child, out);
    return out;
  }

  function selectFrom() {
    return {
      // Rækkerne er kun brugerens egne: et opslag på et andet id giver intet,
      // ellers ville mocken finde en nøgle hos hvem som helst.
      where: (condition: unknown) => {
        const params = conditionParams(condition);
        state.userLookups.push(params);
        const rows = () =>
          params.includes(USER) && state.userRow ? [state.userRow] : [];
        // Ruten gør `.where(...).limit(1)`, så kæden skal have begge led.
        const query = Promise.resolve(rows()) as Promise<unknown[]> & {
          limit: () => Promise<unknown[]>;
        };
        query.limit = () => Promise.resolve(rows());
        return query;
      },
    };
  }

  return {
    db: {
      select: () => ({ from: selectFrom }),
      update: () => ({
        set: (values: Record<string, unknown>) => {
          state.updates.push(values);
          return {
            where: (condition: unknown) => {
              state.updateTargets.push(conditionParams(condition));
              return Promise.resolve();
            },
          };
        },
      }),
    },
  };
});

const { GET, PUT } = await import("./route");
const { generateDeviceToken } = await import("@/lib/desktop-auth");
const { decryptSecret, encryptSecret } = await import("@/lib/utils/encryption");

const BILLY_KEY = "billy-secret-key-abc123"; // gitleaks:allow (testværdi)
const DINERO_KEY = "dinero-key-xyz789"; // gitleaks:allow (testværdi)

function userRow() {
  return {
    id: USER,
    // Krypteret som skrivevejene gemmer den (enc:v1); Dinero-nøglen står i
    // klartekst som en række fra før backfill — begge skal kunne læses.
    billyApiKey: encryptSecret(BILLY_KEY),
    billyOrganizationId: "billy-org-42",
    billyDefaultAccountId: "acc-1",
    billyDefaultProductId: "prod-1",
    billyKlippekortProductId: "prod-2",
    billyLineType: "per_entry",
    billyLineTemplate: "{{beskrivelse}}",
    dineroApiKey: DINERO_KEY,
    dineroOrganizationId: "dinero-org-9",
    dineroOrgName: "Test ApS",
    dineroRefreshToken: "oauth-refresh-token",
    dineroTokenExpiry: new Date(Date.now() + 86_400_000),
    dineroDefaultAccountNumber: 5821,
    dineroProductGuidTime: "guid-time",
    dineroProductGuidKlippekort: "guid-klippekort",
    dineroLineType: "per_entry",
    dineroLineTemplate: "{{beskrivelse}}",
    economicAppSecretToken: null,
    economicAgreementGrantToken: null,
    economicDefaultLayoutNumber: null,
    economicDefaultProductNumber: null,
    economicKlippekortProductNumber: null,
    economicDefaultPaymentTermsNumber: null,
    economicLineType: "per_entry",
    economicLineTemplate: "{{beskrivelse}}",
    timeopsApiKey: null,
  };
}

async function authedRequest(
  method: "GET" | "PUT",
  body?: unknown,
  token?: string,
  query = "",
): Promise<Request> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const jwt = token ?? (await generateDeviceToken(USER, "device-1", "pro"));
  headers.Authorization = `Bearer ${jwt}`;
  return new Request(`https://app.timetrack.dk/api/desktop/settings${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(() => {
  // Fast nøgle: encryptSecret kaster uden ENCRYPTION_KEY.
  process.env.ENCRYPTION_KEY = "c".repeat(64);
});

beforeEach(() => {
  state.userRow = userRow();
  state.membership = { organizationId: ORG, role: "owner" };
  state.updates = [];
  state.updateTargets = [];
  state.userLookups = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/desktop/settings", () => {
  it("giver 401 uden gyldigt device-token", async () => {
    const res = await GET(
      new Request("https://app.timetrack.dk/api/desktop/settings") as never,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("error");
  });

  it("giver 401 for et token der ikke er underskrevet af serveren", async () => {
    const res = await GET(
      (await authedRequest(
        "GET",
        undefined,
        "bearer-kan-helst-ikke-bruges",
      )) as never,
    );
    expect(res.status).toBe(401);
  });

  it("svarer med nøgler, mappings og den organisation enheden arbejder i", async () => {
    const res = await GET((await authedRequest("GET")) as never);
    expect(res.status).toBe(200);
    // Nøglerne må aldrig ligge i et cache-lag på vejen.
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const body = await res.json();
    expect(body.organizationId).toBe(ORG);
    expect(body.settings.billy.apiKey).toBe(BILLY_KEY);
    expect(body.settings.billy.organizationId).toBe("billy-org-42");
    expect(body.settings.billy.defaultAccountId).toBe("acc-1");
    expect(body.settings.billy.klippekortProductId).toBe("prod-2");
    expect(body.settings.dinero.apiKey).toBe(DINERO_KEY);
    expect(body.settings.dinero.isOAuth).toBe(true);
    expect(body.settings.dinero.tokenExpired).toBe(false);
    expect(body.settings.dinero.defaultAccountNumber).toBe(5821);
    expect(body.settings.economic.appSecretToken).toBeNull();
  });

  it("sender aldrig ciphertext ud når en nøgle ikke kan dekrypteres", async () => {
    // Krypteret med en anden nøgle end serverens (fx efter nøgleskift).
    const key = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = "d".repeat(64);
    const foreign = encryptSecret("fremmed-nøgle");
    process.env.ENCRYPTION_KEY = key;
    state.userRow = { ...userRow(), billyApiKey: foreign };

    const res = await GET((await authedRequest("GET")) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings.billy.apiKey).toBeNull();
    // Resten af indstillingerne er stadig læselige.
    expect(body.settings.dinero.apiKey).toBe(DINERO_KEY);
  });

  it("sender aldrig OAuth-refresh-tokenet ud til enheden", async () => {
    const res = await GET((await authedRequest("GET")) as never);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain("oauth-refresh-token");
    expect(raw).not.toContain("dineroRefreshToken");
  });

  it("læser kun den bruger tokenet er udstedt til", async () => {
    await GET((await authedRequest("GET")) as never);
    expect(state.userLookups).toEqual([[USER]]);
  });

  it("giver 403 for en organisation brugeren ikke arbejder i", async () => {
    const res = await GET(
      (await authedRequest(
        "GET",
        undefined,
        undefined,
        "?organizationId=org-2",
      )) as never,
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain(BILLY_KEY);
  });

  it("logger aldrig svaret — heller ikke nøglerne i det", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(" "));
      });
    }

    // Bevis at spy'en er monteret, så en stille test ikke bare betyder, at
    // loggen aldrig bliver læst.
    console.warn("probe");
    expect(logs).toEqual(["probe"]);

    await GET((await authedRequest("GET")) as never);
    await PUT(
      (await authedRequest("PUT", { billyApiKey: BILLY_KEY })) as never,
    );

    const dump = logs.join("\n");
    expect(dump).not.toContain(BILLY_KEY);
    expect(dump).not.toContain(DINERO_KEY);
  });
});

describe("PUT /api/desktop/settings", () => {
  it("giver 401 uden gyldigt device-token", async () => {
    const res = await PUT(
      new Request("https://app.timetrack.dk/api/desktop/settings", {
        method: "PUT",
        body: JSON.stringify({ billyApiKey: BILLY_KEY }),
      }) as never,
    );
    expect(res.status).toBe(401);
    expect(state.updates).toHaveLength(0);
  });

  it("giver 403 for en medarbejder — en almindelig medlem læser men ikke skriver", async () => {
    state.membership = { organizationId: ORG, role: "member" };
    const res = await PUT(
      (await authedRequest("PUT", { billyApiKey: BILLY_KEY })) as never,
    );
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("giver 403 når brugeren ikke er medlem af nogen organisation", async () => {
    state.membership = null;
    const res = await PUT(
      (await authedRequest("PUT", { billyApiKey: BILLY_KEY })) as never,
    );
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("giver 403 for en organisation brugeren ikke er medlem af", async () => {
    const res = await PUT(
      (await authedRequest(
        "PUT",
        { billyApiKey: BILLY_KEY },
        undefined,
        "?organizationId=org-2",
      )) as never,
    );
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("gemmer nøglerne for en admin på tokenets egen bruger", async () => {
    state.membership = { organizationId: ORG, role: "admin" };
    const res = await PUT(
      (await authedRequest("PUT", {
        billyApiKey: "ny-nøgle",
        dineroApiKey: "",
      })) as never,
    );

    expect(res.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    // Skrivningen krypterer (enc:v1), så intet lander i klartekst i `user`.
    const stored = state.updates[0].billyApiKey as string;
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("ny-nøgle");
    expect(decryptSecret(stored)).toBe("ny-nøgle");
    // Tom streng rydder nøglen, som webens updateIntegrations gør.
    expect(state.updates[0].dineroApiKey).toBeNull();
    expect(state.updates[0].updatedAt).toBeInstanceOf(Date);
    expect(state.updateTargets).toEqual([[USER]]);
  });

  it("krypterer hver nøgle, men lader organisations-id'er i klartekst", async () => {
    const plain = {
      billyApiKey: "billy-nøgle",
      dineroApiKey: "dinero-nøgle",
      economicAppSecretToken: "app-secret",
      economicAgreementGrantToken: "agreement-grant",
      timeopsApiKey: "timeops-nøgle",
    };
    const res = await PUT(
      (await authedRequest("PUT", {
        ...plain,
        billyOrganizationId: "billy-org-42",
        dineroOrganizationId: "dinero-org-9",
      })) as never,
    );

    expect(res.status).toBe(200);
    const written = state.updates[0];
    for (const [field, value] of Object.entries(plain)) {
      const stored = written[field] as string;
      expect(stored.startsWith("enc:v1:")).toBe(true);
      expect(stored).not.toContain(value);
      expect(decryptSecret(stored)).toBe(value);
    }
    expect(written.billyOrganizationId).toBe("billy-org-42");
    expect(written.dineroOrganizationId).toBe("dinero-org-9");
  });

  it("afviser en allerede krypteret nøgle i stedet for at dobbeltkryptere", async () => {
    const res = await PUT(
      (await authedRequest("PUT", {
        billyApiKey: encryptSecret("billy-nøgle"),
      })) as never,
    );
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("gemmer intet når ENCRYPTION_KEY mangler", async () => {
    const key = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await PUT(
        (await authedRequest("PUT", { billyApiKey: "ny-nøgle" })) as never,
      );
      expect(res.status).toBe(500);
      expect(state.updates).toHaveLength(0);
    } finally {
      process.env.ENCRYPTION_KEY = key;
    }
  });

  it("giver 400 på en krop der ikke er JSON", async () => {
    const req = await authedRequest("PUT", undefined);
    const res = await PUT(
      new Request(req.url, {
        method: "PUT",
        headers: req.headers,
        body: "{ikke json",
      }) as never,
    );
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });

  it("accepterer rollen 'owner,admin' på samme måde som 'admin'", async () => {
    state.membership = { organizationId: ORG, role: "owner,admin" };
    const res = await PUT(
      (await authedRequest("PUT", { billyApiKey: "ny-nøgle" })) as never,
    );
    expect(res.status).toBe(200);
  });

  it("kan ikke skrive en anden brugers nøgle eller give sig selv rettigheder", async () => {
    const res = await PUT(
      (await authedRequest("PUT", {
        userId: "user-2",
        role: "owner",
        organizationId: "org-2",
        billyApiKey: "ny-nøgle",
      })) as never,
    );

    expect(res.status).toBe(200);
    const written = state.updates[0];
    expect(written).not.toHaveProperty("userId");
    expect(written).not.toHaveProperty("role");
    expect(written).not.toHaveProperty("organizationId");
    expect(state.updateTargets).toEqual([[USER]]);
  });

  it("giver 400 på et kropsobjekt der ikke er gyldigt", async () => {
    const res = await PUT(
      (await authedRequest("PUT", { billyApiKey: { hack: true } })) as never,
    );
    expect(res.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
