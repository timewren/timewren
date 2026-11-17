/**
 * INTEGRATION: signup på tværs af brands MED mailbekræftelse (som i Cloud).
 * host-auth.integration.test.ts kører uden mailkrav; her er flaget ikke sat,
 * så auth.ts kræver bekræftelse, og bekræftelsesmails fanges af en mock.
 *
 * - en bekræftet konto på det andet brand giver det generiske signup-svar
 *   (samme form som en ny adresse) og ændres ikke;
 * - en ubekræftet, ubrugt konto på det andet brand afløses, og den nye konto
 *   skal bekræftes, før den kan logge ind.
 *
 * Kører kun med TEST_DATABASE_URL sat til en kasseret database med repoets
 * schema (`drizzle-kit push`, som CI's Unit Tests-job). Filen får sin egen
 * klon af den (isolatedTestDatabase), som slettes bagefter.
 */
import { randomBytes, randomUUID } from "node:crypto";
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
  process.env.NEXT_PUBLIC_APP_URL = "https://timetrack.dk";
  process.env.NEXT_PUBLIC_BRAND = "timetrack";
  delete process.env.REQUIRE_EMAIL_VERIFICATION;
  delete process.env.RESEND_API_KEY;
  delete process.env.SMTP_HOST;
  delete process.env.MAIL_TRANSPORT;
  return {
    db: undefined as unknown,
    mails: [] as string[],
    verifyLinks: {} as Record<string, string>,
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
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/auth/admin-bootstrap", () => ({ bootstrapAdmin: vi.fn() }));
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
  sendMagicLinkEmail: mail("magic_link"),
}));
vi.mock("@/lib/email/verification", () => ({
  sendVerificationEmail: async (args: {
    to: string;
    verificationUrl: string;
  }) => {
    h.verifyLinks[args.to] = args.verificationUrl;
    await mail("verification")(args);
  },
}));

import * as schema from "@/lib/db/schema";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  "signup på tværs af brands med mailkrav (integration)",
  () => {
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
      return `hostverify-${run}-${name}@example.test`;
    };

    const headers = (host: string) => ({
      host,
      origin: `https://${host}`,
      "content-type": "application/json",
      "x-forwarded-for": `192.0.2.${++ip % 250}`,
    });

    async function call(host: string, path: string, body: unknown) {
      const { POST } = await import("@/app/api/auth/[...all]/route");
      return POST(
        new Request(`https://${host}/api/auth${path}`, {
          method: "POST",
          headers: headers(host),
          body: JSON.stringify(body),
        }),
      );
    }

    const signUp = (host: string, email: string) =>
      call(host, "/sign-up/email", { email, password, name: "Test" });
    const signIn = (host: string, email: string) =>
      call(host, "/sign-in/email", { email, password });

    async function verify(host: string, email: string) {
      const link = h.verifyLinks[email];
      expect(link).toBeDefined();
      const url = new URL(link);
      const { GET } = await import("@/app/api/auth/[...all]/route");
      return GET(
        new Request(`https://${host}${url.pathname}${url.search}`, {
          headers: headers(host),
        }),
      );
    }

    async function userRow(email: string) {
      const [u] = await pg<{ id: string; brand: string; verified: boolean }[]>`
      SELECT id, brand, "emailVerified" AS verified FROM "user" WHERE email = ${email}`;
      return u;
    }

    /** Shape af et signup-svar uden id'er og tidsstempler. */
    const shape = async (res: Response) => ({
      status: res.status,
      cookies: res.headers.getSetCookie().length,
      body: Object.keys((await res.json()) as object).sort(),
    });

    it("bekræftet konto på det andet brand: generisk svar, kontoen uændret", async () => {
      const email = newEmail("verified-tw");
      expect((await signUp("timewren.com", email)).status).toBe(200);
      expect((await verify("timewren.com", email)).status).toBeLessThan(400);
      const before = await userRow(email);
      expect(before).toMatchObject({ brand: "timewren", verified: true });

      h.mails = [];
      const dup = await shape(await signUp("timetrack.dk", email));
      const fresh = await shape(
        await signUp("timetrack.dk", newEmail("fresh-tt")),
      );
      expect(dup).toEqual(fresh);
      expect(dup.status).toBe(200);
      expect(dup.cookies).toBe(0);
      expect(await userRow(email)).toEqual(before);
      expect(h.mails).not.toContain(`verification:${email}`);
    });

    it("ubekræftet konto på det andet brand afløses, og den nye skal bekræftes", async () => {
      const email = newEmail("squat-tw");
      expect((await signUp("timewren.com", email)).status).toBe(200);
      const squatter = await userRow(email);
      expect(squatter).toMatchObject({ brand: "timewren", verified: false });
      delete h.verifyLinks[email];

      h.mails = [];
      const res = await signUp("timetrack.dk", email);
      expect(res.status).toBe(200);
      expect(res.headers.getSetCookie()).toEqual([]);
      const replaced = await userRow(email);
      expect(replaced.id).not.toBe(squatter.id);
      expect(replaced).toMatchObject({ brand: "timetrack", verified: false });
      expect(h.mails).toContain(`verification:${email}`);

      // Ingen login før bekræftelse.
      const early = await signIn("timetrack.dk", email);
      expect(early.status).toBe(403);
      expect(((await early.json()) as { code?: string }).code).toBe(
        "EMAIL_NOT_VERIFIED",
      );

      expect((await verify("timetrack.dk", email)).status).toBeLessThan(400);
      expect((await userRow(email)).verified).toBe(true);
      expect((await signIn("timetrack.dk", email)).status).toBe(200);
    });
  },
);
