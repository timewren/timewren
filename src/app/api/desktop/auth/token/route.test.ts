import { hashPassword } from "better-auth/crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Option A (e-mail + adgangskode) skal verificere mod better-auths egne
// scrypt-hashes. Før brugte ruten bcrypt.compare, så login fejlede altid
// (#935). Og ruten må ikke blive en omvej uden om 2FA, e-mailbekræftelse
// eller organisationens kun-SSO-politik.

const PASSWORD = "kodeord".repeat(3);

type User = {
  id: string;
  name: string;
  email: string;
  banned: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
};

const state: {
  user: User | undefined;
  account: { password: string | null } | undefined;
  ssoRequired: boolean;
} = { user: undefined, account: undefined, ssoRequired: false };

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: async () => state.user },
      accounts: { findFirst: async () => state.account },
      desktopLicenses: { findFirst: async () => undefined },
      desktopDevices: { findFirst: async () => ({ id: "enhed-1" }) },
    },
  },
}));

vi.mock("@/lib/enterprise/sso/auto-join", () => ({
  findVerifiedOrgForEmail: async () =>
    state.ssoRequired ? { requireSsoForDomains: true } : null,
}));

vi.mock("@/lib/desktop-auth", () => ({
  generateDeviceToken: async () => "device-token",
}));

const { POST } = await import("./route");

let ipCounter = 0;
function login(password: string) {
  ipCounter++;
  return POST(
    new Request("https://app.timetrack.dk/api/desktop/auth/token", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.0.${ipCounter}`,
      },
      body: JSON.stringify({
        email: "bruger@example.test",
        password,
        machineId: "maskine-1",
      }),
    }),
  );
}

let hash: string;
beforeAll(async () => {
  hash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  vi.stubEnv("MICROSOFT_CLIENT_ID", "");
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", "");
  state.user = {
    id: "bruger-1",
    name: "Bruger",
    email: "bruger@example.test",
    banned: false,
    emailVerified: true,
    twoFactorEnabled: false,
  };
  state.account = { password: hash };
  state.ssoRequired = false;
});

describe("POST /api/desktop/auth/token — e-mail og adgangskode (#935)", () => {
  it("udsteder token for rigtig adgangskode mod en better-auth-hash", async () => {
    const res = await login(PASSWORD);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("device-token");
    expect(body.user.id).toBe("bruger-1");
  });

  it("afviser forkert adgangskode", async () => {
    const res = await login(`${PASSWORD}x`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid credentials" });
  });

  it("lader ikke 2FA-brugere omgå 2FA", async () => {
    if (state.user) state.user.twoFactorEnabled = true;
    const res = await login(PASSWORD);
    expect(res.status).toBe(403);
    expect((await res.json()).token).toBeUndefined();
  });

  it("afslører ikke 2FA-status ved forkert adgangskode", async () => {
    if (state.user) state.user.twoFactorEnabled = true;
    const res = await login(`${PASSWORD}x`);
    expect(res.status).toBe(401);
  });

  it("kræver bekræftet e-mail som web-login", async () => {
    if (state.user) state.user.emailVerified = false;
    const res = await login(PASSWORD);
    expect(res.status).toBe(403);
  });

  it("respekterer kun-SSO når Microsoft-login er sat op", async () => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", "id");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "hemmelighed");
    state.ssoRequired = true;
    const res = await login(PASSWORD);
    expect(res.status).toBe(403);
  });
});
