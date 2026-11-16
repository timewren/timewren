import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { magicLink } from "better-auth/plugins";
import { describe, expect, it } from "vitest";

// GHSA-965c-763c-88jm: i better-auth 1.6.25 kunne en OAuth state-værdi
// bruges som magic link-token. Vi kører 1.7 med samme magicLink-opsætning
// som src/lib/auth.ts (storeToken "hashed", 15 min) og prøver angrebet.

const BASE = "http://localhost:3000";

function setup() {
  const db: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const sent: string[] = [];
  const auth = betterAuth({
    baseURL: BASE,
    secret: "t".repeat(48),
    database: memoryAdapter(db),
    advanced: { disableOriginCheck: false },
    socialProviders: {
      github: { clientId: "gh-client", clientSecret: "gh-secret" },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ url }) => {
          sent.push(url);
        },
        expiresIn: 60 * 15,
        storeToken: "hashed",
      }),
    ],
  });
  return { auth, db, sent };
}

async function post(
  auth: ReturnType<typeof setup>["auth"],
  path: string,
  body: unknown,
) {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify(body),
    }),
  );
}

describe("magic link på better-auth 1.7", () => {
  it("logger ind med et rigtigt link og gemmer kun tokenets hash", async () => {
    const { auth, db, sent } = setup();
    const res = await post(auth, "/sign-in/magic-link", {
      email: "kunde@example.dk",
      callbackURL: "/dashboard",
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const token = new URL(sent[0]).searchParams.get("token");
    expect(token).toBeTruthy();
    expect(
      db.verification.some((v) => String(v.identifier).includes(String(token))),
    ).toBe(false);

    const verify = await auth.handler(new Request(sent[0]));
    expect(verify.status).toBe(302);
    expect(verify.headers.get("location")).toBe(`${BASE}/dashboard`);
    expect(db.session).toHaveLength(1);

    // Engangslink: andet forsøg giver ingen ny session.
    await auth.handler(new Request(sent[0]));
    expect(db.session).toHaveLength(1);
  });

  it("afviser en OAuth state-værdi som magic link-token", async () => {
    const { auth, db } = setup();
    const start = await post(auth, "/sign-in/social", {
      provider: "github",
      callbackURL: "/dashboard",
      disableRedirect: true,
    });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state");
    expect(state).toBeTruthy();
    expect(db.verification.length).toBeGreaterThan(0);

    const verify = await auth.handler(
      new Request(
        `${BASE}/api/auth/magic-link/verify?token=${state}&callbackURL=/dashboard`,
      ),
    );
    expect(verify.headers.get("location")).toContain("error=");
    expect(db.session).toHaveLength(0);
    expect(db.user).toHaveLength(0);
  });
});
