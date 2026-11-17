/**
 * INTEGRATION: auth pr. host (TimeWren Cloud, docs/specs/timewren-cloud.md → 5)
 * mod det fulde schema. Kører den rigtige src/lib/auth.ts og route-handleren
 * /api/auth med Host-headeren som i prod:
 *
 * - signup på timewren.com stempler user.brand og organizations.brand i samme
 *   insert; signup på timetrack.dk er uændret (kolonnens default);
 * - en TimeWren-konto kan ikke logge ind på timetrack.dk og omvendt, med en
 *   neutral fejl;
 * - TimeWren-cookies er host-only, også med AUTH_COOKIE_DOMAIN=.timetrack.dk;
 * - uden flagene går timewren.com gennem standardinstansen som før.
 *
 * Kører kun med TEST_DATABASE_URL sat til en kasseret database med repoets
 * schema (`drizzle-kit push`, som CI's Unit Tests-job). Filen får sin egen
 * klon af den (isolatedTestDatabase), som slettes bagefter.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  connectTestDb,
  isolatedTestDatabase,
  testPostgres,
} from "@/test/test-db";

const h = vi.hoisted(() => {
  // Modulniveau-værdier i auth.ts læses ved import.
  process.env.NEXT_PUBLIC_APP_URL = "https://timetrack.dk";
  process.env.NEXT_PUBLIC_BRAND = "timetrack";
  process.env.REQUIRE_EMAIL_VERIFICATION = "false";
  process.env.AUTH_COOKIE_DOMAIN = ".timetrack.dk";
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_TRANSPORT;
  return {
    db: undefined as unknown,
    mails: [] as string[],
    magicLinks: {} as Record<string, string>,
    activeOrg: null as string | null,
  };
});

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        const real = h.db as Record<string | symbol, unknown>;
        const value = real[prop];
        return typeof value === "function" ? value.bind(real) : value;
      },
    },
  ),
}));
vi.mock("@/lib/notifications/admin", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => h.activeOrg),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/auth/admin-bootstrap", () => ({ bootstrapAdmin: vi.fn() }));
// Pladsloft og Alunta-udvidelse: ægte som standard, styres pr. test.
const seats = vi.hoisted(() => ({
  policy: vi.fn(),
  expand: vi.fn(),
}));
vi.mock("@/lib/org-seats", async (importActual) => {
  const real = await importActual<typeof import("@/lib/org-seats")>();
  seats.policy.mockImplementation(real.resolveOrgSeatPolicy);
  return { ...real, resolveOrgSeatPolicy: seats.policy };
});
vi.mock("@/lib/billing/auto-seats", async (importActual) => {
  const real = await importActual<typeof import("@/lib/billing/auto-seats")>();
  seats.expand.mockImplementation(real.tryAutoExpandSeats);
  return { ...real, tryAutoExpandSeats: seats.expand };
});
const mail = (name: string) => async (args: { to?: string }) => {
  h.mails.push(`${name}:${args?.to}`);
};
vi.mock("@/lib/email/welcome", () => ({ sendWelcomeEmail: mail("welcome") }));
vi.mock("@/lib/email/drip", () => ({
  sendDripWelcomeEmail: mail("drip_welcome"),
}));
vi.mock("@/lib/email/security", () => ({
  sendNewLoginEmail: mail("new_login"),
  sendPasswordChangedEmail: mail("password_changed"),
  sendTwoFactorCodeEmail: mail("two_factor"),
}));
vi.mock("@/lib/email/password-reset", () => ({
  sendPasswordResetEmail: mail("password_reset"),
}));
vi.mock("@/lib/email/magic-link", () => ({
  sendMagicLinkEmail: async (args: { to: string; magicLinkUrl: string }) => {
    h.magicLinks[args.to] = args.magicLinkUrl;
    await mail("magic_link")(args);
  },
}));
vi.mock("@/lib/email/verification", () => ({
  sendVerificationEmail: mail("verification"),
}));

import * as schema from "@/lib/db/schema";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("auth pr. host (integration)", () => {
  const run = randomUUID().slice(0, 8);
  const testDb = isolatedTestDatabase();
  const pg = testPostgres({ max: 2, database: testDb.name });
  h.db = drizzle(pg, { schema });
  const password = `pw-${randomBytes(9).toString("hex")}`;
  let ip = 0;

  beforeAll(async () => {
    await testDb.create();
    await connectTestDb(pg);
  });

  beforeEach(() => {
    vi.stubEnv("MULTIBRAND_ENABLED", "1");
    vi.stubEnv("TIMEWREN_APP_ENABLED", "1");
    vi.stubEnv("BRANDS_CONFIG", "");
    h.mails = [];
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await pg.end();
    await testDb.drop();
  });

  const newEmail = (name: string) => {
    return `hostauth-${run}-${name}@example.test`;
  };

  async function call(host: string, path: string, body: unknown) {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    return POST(
      new Request(`https://${host}/api/auth${path}`, {
        method: "POST",
        headers: {
          host,
          origin: `https://${host}`,
          "content-type": "application/json",
          "x-forwarded-for": `192.0.2.${++ip % 250}`,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  const signUp = (host: string, email: string) =>
    call(host, "/sign-up/email", { email, password, name: "Test" });
  const signIn = (host: string, email: string) =>
    call(host, "/sign-in/email", { email, password });

  async function brandOf(email: string) {
    const [u] = await pg<{ id: string; brand: string }[]>`
      SELECT id, brand FROM "user" WHERE email = ${email}`;
    const orgs = await pg<{ brand: string }[]>`
      SELECT o.brand FROM organizations o
      JOIN members m ON m.organization_id = o.id
      WHERE m.user_id = ${u.id}`;
    return { user: u.brand, orgs: orgs.map((o) => o.brand) };
  }

  it("signup på timewren.com stempler konto og workspace som timewren", async () => {
    const email = newEmail("tw");
    const res = await signUp("timewren.com", email);
    expect(res.status).toBe(200);
    expect(await brandOf(email)).toEqual({
      user: "timewren",
      orgs: ["timewren"],
    });
    // Brand-bevidst velkomstmail, ikke TimeTracks drip-velkomst.
    expect(h.mails).toContain(`welcome:${email}`);
    expect(h.mails).not.toContain(`drip_welcome:${email}`);
  });

  it("signup på timetrack.dk er uændret: timetrack via kolonnens default", async () => {
    const email = newEmail("tt");
    const res = await signUp("timetrack.dk", email);
    expect(res.status).toBe(200);
    expect(await brandOf(email)).toEqual({
      user: "timetrack",
      orgs: ["timetrack"],
    });
    expect(h.mails).toContain(`drip_welcome:${email}`);
  });

  it("TimeWren-konto: login på timewren.com, afvist på timetrack.dk", async () => {
    const email = newEmail("tw-login");
    await signUp("timewren.com", email);

    const ok = await signIn("timewren.com", email);
    expect(ok.status).toBe(200);
    const cookies = ok.headers.getSetCookie();
    expect(cookies.some((c) => c.includes("session_token"))).toBe(true);
    // Host-only: AUTH_COOKIE_DOMAIN=.timetrack.dk må aldrig gælde her.
    for (const c of cookies) expect(c.toLowerCase()).not.toContain("domain=");

    // Rigtig adgangskode på det andet brand: præcis samme svar som en
    // forkert adgangskode, så adgangskoden ikke kan afprøves dér.
    const denied = await signIn("timetrack.dk", email);
    const wrong = await call("timetrack.dk", "/sign-in/email", {
      email,
      password: `${password}-forkert`,
    });
    expect(denied.status).toBe(401);
    expect(wrong.status).toBe(401);
    const body = (await denied.json()) as { code?: string; message?: string };
    expect(body).toEqual(await wrong.json());
    expect(body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(body.message).not.toMatch(/timewren|timetrack/i);
    expect(denied.headers.getSetCookie()).toEqual([]);
  });

  it("TimeTrack-konto: afvist på timewren.com, login på timetrack.dk som før", async () => {
    const email = newEmail("tt-login");
    await signUp("timetrack.dk", email);

    const denied = await signIn("timewren.com", email);
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { code?: string }).code).toBe(
      "INVALID_EMAIL_OR_PASSWORD",
    );

    const ok = await signIn("timetrack.dk", email);
    expect(ok.status).toBe(200);
    // Standardinstansen beholder AUTH_COOKIE_DOMAIN (uændret for timetrack).
    expect(
      ok.headers
        .getSetCookie()
        .some((c) => c.toLowerCase().includes("domain=.timetrack.dk")),
    ).toBe(true);
  });

  it("forkert brand og forkert adgangskode lækker ikke, om kontoen findes", async () => {
    const res = await call("timetrack.dk", "/sign-in/email", {
      email: newEmail("findes-ikke"),
      password,
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "INVALID_EMAIL_OR_PASSWORD",
    );
  });

  it("ubekræftet konto på et andet brand: samme svar som en ukendt adresse", async () => {
    const email = newEmail("tt-unverified");
    await signUp("timetrack.dk", email);
    await pg`UPDATE "user" SET "emailVerified" = false WHERE email = ${email}`;
    h.mails = [];
    const res = await signIn("timewren.com", email);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "INVALID_EMAIL_OR_PASSWORD",
    );
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(h.mails).toEqual([]);
  });

  /** Konto på `host`, ubekræftet og uden session (som ved signup med mailkrav). */
  async function unverifiedOn(host: string, name: string) {
    const email = newEmail(name);
    expect((await signUp(host, email)).status).toBe(200);
    const [u] = await pg<{ id: string; org: string }[]>`
      UPDATE "user" SET "emailVerified" = false WHERE email = ${email}
      RETURNING id, (SELECT organization_id FROM members WHERE user_id = "user".id) AS org`;
    // Med mailkrav logger signup ikke ind; testmiljøet gør (autoSignIn).
    await pg`DELETE FROM session WHERE "userId" = ${u.id}`;
    return { email, ...u };
  }

  it("ubekræftet, ubrugt konto på det andet brand afløses ved signup", async () => {
    const tw = await unverifiedOn("timewren.com", "squat-tw");
    const res = await signUp("timetrack.dk", tw.email);
    expect(res.status).toBe(200);
    const [u] = await pg<{ id: string; brand: string }[]>`
      SELECT id, brand FROM "user" WHERE email = ${tw.email}`;
    expect(u.brand).toBe("timetrack");
    expect(u.id).not.toBe(tw.id);
    // Den gamle konto og dens tomme workspace er væk.
    const [old] = await pg`SELECT 1 FROM "user" WHERE id = ${tw.id}`;
    expect(old).toBeUndefined();
    const [org] = await pg`SELECT 1 FROM organizations WHERE id = ${tw.org}`;
    expect(org).toBeUndefined();
    expect(await brandOf(tw.email)).toEqual({
      user: "timetrack",
      orgs: ["timetrack"],
    });

    // Og omvendt: timetrack.dk-konto afløses ved signup på timewren.com.
    const tt = await unverifiedOn("timetrack.dk", "squat-tt");
    expect((await signUp("timewren.com", tt.email)).status).toBe(200);
    expect((await brandOf(tt.email)).user).toBe("timewren");
  });

  it("bekræftet konto på det andet brand røres ikke ved signup", async () => {
    const email = newEmail("squat-verified");
    await signUp("timewren.com", email);
    const [before] = await pg<{ id: string }[]>`
      SELECT id FROM "user" WHERE email = ${email} AND "emailVerified" = true`;
    expect(before).toBeDefined();
    const res = await signUp("timetrack.dk", email);
    // Uden mailkrav (denne fil) er dubletsvaret 422; med mailkrav et
    // generisk 200 uden ny konto (host-auth-verification.integration.test.ts).
    // Begge: kontoen er uændret.
    expect(res.status).toBe(422);
    const [after] = await pg<{ id: string; brand: string }[]>`
      SELECT id, brand FROM "user" WHERE email = ${email}`;
    expect(after).toEqual({ id: before.id, brand: "timewren" });
  });

  it("ubekræftet konto med en session afløses ikke", async () => {
    const tw = await unverifiedOn("timewren.com", "squat-session");
    await pg`
      INSERT INTO session (id, "userId", token, "expiresAt")
      VALUES (${randomUUID()}, ${tw.id}, ${randomUUID()}, now() + interval '1 day')`;
    expect((await signUp("timetrack.dk", tw.email)).status).toBe(422);
    const [u] = await pg<{ id: string; brand: string }[]>`
      SELECT id, brand FROM "user" WHERE email = ${tw.email}`;
    expect(u).toEqual({ id: tw.id, brand: "timewren" });
  });

  it("ubekræftet konto med forretningsdata, telefon eller andet login afløses ikke", async () => {
    const kept = async (tw: { email: string; id: string }) => {
      expect((await signUp("timetrack.dk", tw.email)).status).toBe(422);
      const [u] = await pg<{ id: string; brand: string }[]>`
        SELECT id, brand FROM "user" WHERE email = ${tw.email}`;
      expect(u).toEqual({ id: tw.id, brand: "timewren" });
    };

    // Kunde i workspacet (peger på både kontoen og organisationen).
    const withClient = await unverifiedOn("timewren.com", "squat-client");
    await pg`
      INSERT INTO clients (name, user_id, organization_id)
      VALUES ('Kunde', ${withClient.id}, ${withClient.org})`;
    await kept(withClient);

    // Data, der kun peger på organisationen.
    const withDomain = await unverifiedOn("timewren.com", "squat-domain");
    await pg`
      INSERT INTO org_verified_domains (organization_id, domain, verification_token)
      VALUES (${withDomain.org}, ${`squat-${run}.example.test`}, ${randomUUID().replace(/-/g, "")})`;
    await kept(withDomain);

    // SMS-konto (logger ind uden mailbekræftelse).
    const withPhone = await unverifiedOn("timewren.com", "squat-phone");
    await pg`
      UPDATE "user" SET "phoneNumber" = ${`+4520${run.replace(/\D/g, "").padEnd(6, "0").slice(0, 6)}`}
      WHERE id = ${withPhone.id}`;
    await kept(withPhone);

    // Andet login end adgangskode.
    const withOAuth = await unverifiedOn("timewren.com", "squat-oauth");
    await pg`
      INSERT INTO account (id, "accountId", "providerId", "userId", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${randomUUID()}, 'google', ${withOAuth.id}, now(), now())`;
    await kept(withOAuth);
  });

  it("en session oprettet under kontrollen genkontrolleres efter låsen", async () => {
    const tw = await unverifiedOn("timewren.com", "squat-race");
    // En samtidig transaktion (fx SMS-login) har indsat en session, men ikke
    // committet. Oprydningen må vente på låsen og så se sessionen.
    const other = testPostgres({ max: 1, database: testDb.name });
    try {
      const conn = await other.reserve();
      await conn`BEGIN`;
      await conn`
        INSERT INTO session (id, "userId", token, "expiresAt")
        VALUES (${randomUUID()}, ${tw.id}, ${randomUUID()}, now() + interval '1 day')`;
      let settled = false;
      const pending = signUp("timetrack.dk", tw.email).finally(() => {
        settled = true;
      });
      // Oprydningen står på låsen, så længe den anden transaktion er åben.
      await new Promise((r) => setTimeout(r, 500));
      expect(settled).toBe(false);
      await conn`COMMIT`;
      conn.release();
      expect((await pending).status).toBe(422);
      const [u] = await pg<{ id: string; brand: string }[]>`
        SELECT id, brand FROM "user" WHERE email = ${tw.email}`;
      expect(u).toEqual({ id: tw.id, brand: "timewren" });
    } finally {
      await other.end();
    }
  });

  it("magic link når frem, når adressen kun er spærret af en ubekræftet konto", async () => {
    const tw = await unverifiedOn("timewren.com", "squat-ml");
    h.mails = [];
    const res = await call("timetrack.dk", "/sign-in/magic-link", {
      email: tw.email,
      callbackURL: "/dashboard",
    });
    expect(res.status).toBe(200);
    expect(h.mails).toEqual([`magic_link:${tw.email}`]);
    const [old] = await pg`SELECT 1 FROM "user" WHERE id = ${tw.id}`;
    expect(old).toBeUndefined();
  });

  it("nulstilling og magic link sendes ikke til en konto på et andet brand", async () => {
    const email = newEmail("tw-reset");
    await signUp("timewren.com", email);
    h.mails = [];
    const reset = await call("timetrack.dk", "/request-password-reset", {
      email,
      redirectTo: "/auth/reset-password",
    });
    expect(reset.status).toBe(200);
    const link = await call("timetrack.dk", "/sign-in/magic-link", {
      email,
      callbackURL: "/dashboard",
    });
    expect(link.status).toBe(200);
    expect(h.mails).toEqual([]);

    // På eget brand sendes begge.
    await call("timewren.com", "/request-password-reset", {
      email,
      redirectTo: "/auth/reset-password",
    });
    await call("timewren.com", "/sign-in/magic-link", {
      email,
      callbackURL: "/dashboard",
    });
    expect(h.mails).toEqual([`password_reset:${email}`, `magic_link:${email}`]);
  });

  it("magic link til en konto på et andet brand: redirect med account_not_here", async () => {
    // Linket sendes, mens adressen er ukendt; kontoen oprettes så på
    // timetrack.dk, før linket åbnes på timewren.com.
    const email = newEmail("ml-redirect");
    const sent = await call("timewren.com", "/sign-in/magic-link", {
      email,
      callbackURL: "/dashboard",
    });
    expect(sent.status).toBe(200);
    const url = h.magicLinks[email];
    expect(url).toBeTruthy();
    await signUp("timetrack.dk", email);

    const { GET } = await import("@/app/api/auth/[...all]/route");
    const res = await GET(
      new Request(url, { headers: { host: "timewren.com" } }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=account_not_here");
    expect(
      res.headers.getSetCookie().some((c) => c.includes("session_token")),
    ).toBe(false);
  });

  it("ny organisation får ejerens brand i samme insert", async () => {
    const email = newEmail("tw-org");
    await signUp("timewren.com", email);
    const login = await signIn("timewren.com", email);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const res = await POST(
      new Request("https://timewren.com/api/auth/organization/create", {
        method: "POST",
        headers: {
          host: "timewren.com",
          origin: "https://timewren.com",
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify({ name: "Firma", slug: `hostauth-${run}-org` }),
      }),
    );
    expect(res.status).toBe(200);
    // Brandet er ikke en del af svaret (returned: false).
    expect(JSON.stringify(await res.json())).not.toContain("timewren");
    const [org] = await pg<{ brand: string }[]>`
      SELECT brand FROM organizations WHERE slug = ${`hostauth-${run}-org`}`;
    expect(org.brand).toBe("timewren");
  });

  it("tRPC enterprise.organization.create: ejerens brand i samme insert", async () => {
    const { enterpriseOrganizationRouter } = await import(
      "@/lib/trpc/routers/enterprise/organization"
    );
    const created: Record<string, string> = {};
    for (const [host, name] of [
      ["timewren.com", "trpc-tw"],
      ["timetrack.dk", "trpc-tt"],
    ]) {
      const email = newEmail(name);
      await signUp(host, email);
      const [u] = await pg<{ id: string; org: string }[]>`
        SELECT u.id, m.organization_id AS org FROM "user" u
        JOIN members m ON m.user_id = u.id WHERE u.email = ${email}`;
      h.activeOrg = u.org;
      const caller = enterpriseOrganizationRouter.createCaller({
        session: {
          user: { id: u.id, email },
          session: { id: `s-${u.id}`, userId: u.id },
        },
        db: h.db,
        headers: new Headers(),
      } as never);
      const slug = `hostauth-${run}-${name}`;
      await caller.create({ name, slug });
      const [org] = await pg<{ id: string; brand: string }[]>`
        SELECT id, brand FROM organizations WHERE slug = ${slug}`;
      // Med i oprydningen (kun medlemmers orgs ryddes ellers).
      await pg`INSERT INTO members (id, organization_id, user_id, role)
        SELECT ${randomUUID()}, ${org.id}, ${u.id}, 'owner'
        WHERE NOT EXISTS (SELECT 1 FROM members WHERE organization_id = ${org.id})`;
      created[host] = org.brand;
    }
    expect(created).toEqual({
      "timewren.com": "timewren",
      "timetrack.dk": "timetrack",
    });
  });

  /** Ejerens personlige organisation (brand fra signup-hosten). */
  async function ownerOrg(host: string, name: string) {
    const email = newEmail(name);
    await signUp(host, email);
    const [row] = await pg<{ org: string; owner: string }[]>`
      SELECT m.organization_id AS org, u.id AS owner FROM members m
      JOIN "user" u ON u.id = m.user_id WHERE u.email = ${email}`;
    return row;
  }

  async function invite(o: { org: string; owner: string }, email: string) {
    const id = randomUUID();
    await pg`
      INSERT INTO invitations (id, organization_id, email, role, status, inviter_id, expires_at)
      VALUES (${id}, ${o.org}, ${email}, 'member', 'pending', ${o.owner}, now() + interval '2 days')`;
    return id;
  }

  async function membersOf(email: string) {
    const rows = await pg<{ org: string; brand: string }[]>`
      SELECT o.id AS org, o.brand FROM organizations o
      JOIN members m ON m.organization_id = o.id
      JOIN "user" u ON u.id = m.user_id WHERE u.email = ${email}`;
    return rows;
  }

  const inviteStatus = async (id: string) =>
    (
      await pg<{ status: string }[]>`
      SELECT status FROM invitations WHERE id = ${id}`
    )[0]?.status;

  it("TimeTrack-invitation bruges ikke ved signup på timewren.com", async () => {
    const tt = await ownerOrg("timetrack.dk", "inv-tt-owner");
    const email = newEmail("inv-tw-signup");
    const inv = await invite(tt, email);

    expect((await signUp("timewren.com", email)).status).toBe(200);
    // Egen TimeWren-workspace, ingen plads i kundens organisation.
    const orgs = await membersOf(email);
    expect(orgs.map((o) => o.brand)).toEqual(["timewren"]);
    expect(orgs.map((o) => o.org)).not.toContain(tt.org);
    expect(await inviteStatus(inv)).toBe("pending");
  });

  it("TimeWren-invitation bruges ikke ved signup på timetrack.dk", async () => {
    const tw = await ownerOrg("timewren.com", "inv-tw-owner");
    const email = newEmail("inv-tt-signup");
    const inv = await invite(tw, email);

    expect((await signUp("timetrack.dk", email)).status).toBe(200);
    const orgs = await membersOf(email);
    expect(orgs.map((o) => o.brand)).toEqual(["timetrack"]);
    expect(orgs.map((o) => o.org)).not.toContain(tw.org);
    expect(await inviteStatus(inv)).toBe("pending");
  });

  it("invitation på eget brand accepteres ved signup som før", async () => {
    // Ingen pladsgrænse (billing slået fra): her testes kun brandet.
    vi.stubEnv("ALUNTA_API_KEY", "");
    for (const host of ["timetrack.dk", "timewren.com"]) {
      const o = await ownerOrg(host, `inv-same-owner-${host}`);
      const email = newEmail(`inv-same-${host}`);
      const inv = await invite(o, email);
      expect((await signUp(host, email)).status).toBe(200);
      expect((await membersOf(email)).map((m) => m.org)).toEqual([o.org]);
      expect(await inviteStatus(inv)).toBe("accepted");
    }
  });

  it("accept-invitation afviser en organisation på et andet brand", async () => {
    const tt = await ownerOrg("timetrack.dk", "acc-tt-owner");
    const email = newEmail("acc-tw");
    await signUp("timewren.com", email);
    const inv = await invite(tt, email);
    const login = await signIn("timewren.com", email);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const res = await POST(
      new Request(
        "https://timewren.com/api/auth/organization/accept-invitation",
        {
          method: "POST",
          headers: {
            host: "timewren.com",
            origin: "https://timewren.com",
            "content-type": "application/json",
            cookie,
          },
          body: JSON.stringify({ invitationId: inv }),
        },
      ),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe(
      "ACCOUNT_NOT_ON_THIS_SITE",
    );
    expect((await membersOf(email)).map((m) => m.org)).not.toContain(tt.org);
    expect(await inviteStatus(inv)).toBe("pending");
  });

  /** POST til /api/auth som en indlogget konto. */
  async function callAs(
    host: string,
    email: string,
    path: string,
    body: unknown,
  ) {
    const login = await signIn(host, email);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const { POST } = await import("@/app/api/auth/[...all]/route");
    return POST(
      new Request(`https://${host}/api/auth${path}`, {
        method: "POST",
        headers: {
          host,
          origin: `https://${host}`,
          "content-type": "application/json",
          cookie,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it("invitation til en konto på et andet brand afvises uden at købe en plads", async () => {
    const tt = await ownerOrg("timetrack.dk", "seat-tt-owner");
    const [{ email: ownerEmail }] = await pg<{ email: string }[]>`
      SELECT email FROM "user" WHERE id = ${tt.owner}`;
    const twEmail = newEmail("seat-tw");
    await signUp("timewren.com", twEmail);
    // Organisationen er på pladsloftet: næste invitation ville udvide i Alunta.
    seats.policy.mockResolvedValue({ maxSeats: 1, isFree: false });
    seats.expand.mockClear();
    seats.expand.mockResolvedValue({
      expanded: true,
      newMaxSeats: 2,
      newQuantity: 2,
    });
    try {
      const res = await callAs(
        "timetrack.dk",
        ownerEmail,
        "/organization/invite-member",
        {
          email: twEmail.toUpperCase(),
          role: "member",
          organizationId: tt.org,
        },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { message?: string };
      expect(body.message).toBe(
        "Denne email-adresse kan ikke inviteres til organisationen. Brug en anden adresse.",
      );
      expect(seats.expand).not.toHaveBeenCalled();
      const [n] = await pg<{ n: number }[]>`
        SELECT count(*)::int AS n FROM invitations
        WHERE organization_id = ${tt.org} AND lower(email) = ${twEmail}`;
      expect(n.n).toBe(0);

      // Kontrol: en ny adresse på samme loft udvider som før.
      const fresh = newEmail("seat-new");
      const ok = await callAs(
        "timetrack.dk",
        ownerEmail,
        "/organization/invite-member",
        {
          email: fresh,
          role: "member",
          organizationId: tt.org,
        },
      );
      expect(ok.status).toBe(200);
      expect(seats.expand).toHaveBeenCalledWith(tt.org);
    } finally {
      const real =
        await vi.importActual<typeof import("@/lib/org-seats")>(
          "@/lib/org-seats",
        );
      seats.policy.mockReset();
      seats.policy.mockImplementation(real.resolveOrgSeatPolicy);
      const realExpand = await vi.importActual<
        typeof import("@/lib/billing/auto-seats")
      >("@/lib/billing/auto-seats");
      seats.expand.mockReset();
      seats.expand.mockImplementation(realExpand.tryAutoExpandSeats);
    }
  });

  it("domæne-auto-join kun til en organisation på kontoens brand", async () => {
    // Ingen pladsgrænse (billing slået fra): her testes kun brandet.
    vi.stubEnv("ALUNTA_API_KEY", "");
    const domain = `hostauth-${run}.example.test`;
    const tt = await ownerOrg("timetrack.dk", "dom-tt-owner");
    await pg`
      INSERT INTO org_verified_domains (organization_id, domain, verification_token, status, verified_at)
      VALUES (${tt.org}, ${domain}, ${randomUUID().replace(/-/g, "")}, 'verified', now())`;

    // TimeWren: egen workspace, heller ikke joinet ved login.
    const twEmail = `tw-${run}@${domain}`;
    expect((await signUp("timewren.com", twEmail)).status).toBe(200);
    expect((await signIn("timewren.com", twEmail)).status).toBe(200);
    const twOrgs = await membersOf(twEmail);
    expect(twOrgs.map((o) => o.brand)).toEqual(["timewren"]);

    // TimeTrack: joines som før (ingen personlig workspace).
    const ttEmail = `tt-${run}@${domain}`;
    expect((await signUp("timetrack.dk", ttEmail)).status).toBe(200);
    expect((await signIn("timetrack.dk", ttEmail)).status).toBe(200);
    expect((await membersOf(ttEmail)).map((o) => o.org)).toEqual([tt.org]);
  });

  it("session og API-nøgle gælder kun på kontoens eget brand (tRPC og /api/v1)", async () => {
    const email = newEmail("tw-crossuse");
    await signUp("timewren.com", email);
    const login = await signIn("timewren.com", email);
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    const { GET: trpc } = await import("@/app/api/trpc/[trpc]/route");
    const theme = (host: string) =>
      trpc(
        new Request(`https://${host}/api/trpc/user.getTheme`, {
          headers: { host, cookie },
        }),
      );
    expect((await theme("timewren.com")).status).toBe(200);
    expect((await theme("timetrack.dk")).status).toBe(401);

    const [u] = await pg<{ id: string }[]>`
      SELECT id FROM "user" WHERE email = ${email}`;

    // Admin-impersonation (support fra timetrack.dk) gælder på begge hosts,
    // men kun når den er udstedt af en admin.
    const adminEmail = newEmail("tt-admin");
    await signUp("timetrack.dk", adminEmail);
    const [admin] = await pg<{ id: string }[]>`
      UPDATE "user" SET role = 'admin' WHERE email = ${adminEmail} RETURNING id`;
    const sessionToken = randomUUID();
    await pg`
      INSERT INTO session (id, "userId", token, "expiresAt", "impersonatedBy")
      VALUES (${randomUUID()}, ${u.id}, ${sessionToken}, now() + interval '1 hour', ${admin.id})`;
    const { makeSignature } = await import("better-auth/crypto");
    const sessionCookieName = cookie
      .split("; ")
      .map((c) => c.split("=")[0])
      .find((n) => n.endsWith("session_token"));
    expect(sessionCookieName).toBeDefined();
    const signed = `${sessionToken}.${await makeSignature(sessionToken, process.env.BETTER_AUTH_SECRET ?? "")}`;
    const asImpersonation = (host: string) =>
      trpc(
        new Request(`https://${host}/api/trpc/user.getTheme`, {
          headers: {
            host,
            cookie: `${sessionCookieName}=${encodeURIComponent(signed)}`,
          },
        }),
      );
    expect((await asImpersonation("timetrack.dk")).status).toBe(200);
    await pg`UPDATE "user" SET role = 'user' WHERE id = ${admin.id}`;
    expect((await asImpersonation("timetrack.dk")).status).toBe(401);
    const token = `tk_live_${randomBytes(16).toString("hex")}`;
    await pg`
      INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix)
      VALUES (${randomUUID()}, ${u.id}, 'test', ${createHash("sha256").update(token).digest("hex")}, ${token.slice(0, 16)})`;
    const { NextRequest } = await import("next/server");
    const { GET: me } = await import("@/app/api/v1/me/route");
    const meOn = (host: string) =>
      me(
        new NextRequest(`https://${host}/api/v1/me`, {
          headers: {
            host,
            authorization: `Bearer ${token}`,
            "x-forwarded-for": `198.51.100.${++ip % 250}`,
          },
        }),
      );
    expect((await meOn("timewren.com")).status).toBe(200);
    const denied = await meOn("timetrack.dk");
    expect(denied.status).toBe(401);
    expect(JSON.stringify(await denied.json())).toContain("Invalid API key");
  });

  it("butikskøb og desktop-licens afvises for TimeWren-konti som Alunta-checkout", async () => {
    vi.stubEnv("STORE_BILLING_ENABLED", "1");
    const { storeBillingRouter } = await import(
      "@/lib/trpc/routers/storeBilling"
    );
    const { desktopRouter } = await import("@/lib/trpc/routers/desktop");
    const refusal = "Betaling er ikke åben her endnu. Du er på Gratis-planen.";
    const result: Record<string, unknown> = {};
    for (const [host, name] of [
      ["timewren.com", "store-tw"],
      ["timetrack.dk", "store-tt"],
    ]) {
      const owner = await ownerOrg(host, name);
      const [{ email }] = await pg<{ email: string }[]>`
        SELECT email FROM "user" WHERE id = ${owner.owner}`;
      h.activeOrg = owner.org;
      const headers = new Headers({ host });
      const store = storeBillingRouter.createCaller({
        session: {
          user: { id: owner.owner, email },
          session: { id: `s-${owner.owner}`, userId: owner.owner },
        },
        db: h.db,
        headers,
      } as never);
      const desktop = desktopRouter.createCaller({
        session: null,
        db: h.db,
        headers,
      } as never);
      const message = (p: Promise<unknown>) =>
        p.then(
          () => "ok",
          (e: Error) => e.message,
        );
      result[host] = {
        enabled: (await store.config()).enabled,
        apple: await message(store.verifyApple({ signedTransaction: "x" })),
        google: await message(
          store.verifyGoogle({ productId: "p", purchaseToken: "t" }),
        ),
        desktop: await message(desktop.createLifetimeCheckout({ email })),
      };
    }
    expect(result["timewren.com"]).toEqual({
      enabled: false,
      apple: refusal,
      google: refusal,
      desktop: refusal,
    });
    // TimeTrack: forbi brand-tjekket som før (fejler først senere: ingen
    // rigtig kvittering, ingen Stripe-pris i testmiljøet).
    const tt = result["timetrack.dk"] as Record<string, unknown>;
    expect(tt.enabled).toBe(true);
    for (const k of ["apple", "google", "desktop"]) {
      expect(tt[k]).not.toBe(refusal);
    }

    // Desktop-licens til en TimeWren-adresse købt fra timetrack.dk: afvist.
    const twEmail = newEmail("store-tw-addr");
    await signUp("timewren.com", twEmail);
    const desktop = desktopRouter.createCaller({
      session: null,
      db: h.db,
      headers: new Headers({ host: "timetrack.dk" }),
    } as never);
    await expect(
      desktop.createLifetimeCheckout({ email: twEmail.toUpperCase() }),
    ).rejects.toThrow(refusal);
  });

  it("klienten kan ikke selv sætte brand ved signup", async () => {
    const email = newEmail("tt-spoof");
    const res = await call("timetrack.dk", "/sign-up/email", {
      email,
      password,
      name: "Test",
      brand: "timewren",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const [u] = await pg`SELECT brand FROM "user" WHERE email = ${email}`;
    expect(u).toBeUndefined();
  });

  it("uden TIMEWREN_APP_ENABLED stemples intet: timewren.com går gennem standardinstansen", async () => {
    vi.stubEnv("TIMEWREN_APP_ENABLED", "");
    const email = newEmail("flag-off");
    const res = await signUp("timewren.com", email);
    expect(res.status).toBe(200);
    expect(await brandOf(email)).toEqual({
      user: "timetrack",
      orgs: ["timetrack"],
    });
  });

  it("betroede origins pr. instans", async () => {
    const { auth, authForHost } = await import("@/lib/auth");
    const tw = await authForHost("timewren.com").$context;
    expect(tw.trustedOrigins).toContain("https://timewren.com");
    expect(tw.trustedOrigins).toContain("https://www.timewren.com");
    expect(tw.trustedOrigins).not.toContain("https://timetrack.dk");
    const tt = await auth.$context;
    expect(tt.trustedOrigins).toContain("https://timetrack.dk");
    expect(tt.trustedOrigins.join(" ")).not.toContain("timewren");
  });

  it("uden flagene kan en TimeWren-konto logge ind på timetrack.dk (ingen afvisning)", async () => {
    const email = newEmail("tw-flag-off");
    await signUp("timewren.com", email);
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    const ok = await signIn("timetrack.dk", email);
    expect(ok.status).toBe(200);
  });
});
