import { decryptOAuthToken, setTokenUtil } from "better-auth/oauth2";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptSecret,
  EncryptionKeyError,
  encrypt,
  encryptSecret,
  SECRET_PREFIX,
} from "@/lib/utils/encryption";
import {
  BackfillAbortedError,
  backfillSecrets,
  describeTarget,
  SECRET_TARGETS,
  type SecretStore,
  type SecretTarget,
} from "../secret-backfill";

const TARGETS: SecretTarget[] = [
  {
    table: "calendar_connections",
    column: "access_token",
    idColumn: "id",
    filter: { column: "provider", equals: "google" },
  },
  { table: "user", column: "billy_api_key", idColumn: "id" },
];

/** In-memory tabeller: key = "table.column" → rækker. */
function createStore(initial: Record<string, Record<string, string>>) {
  const data = structuredClone(initial);
  const store: SecretStore = {
    async listRows(target) {
      const rows = data[`${target.table}.${target.column}`] ?? {};
      return Object.entries(rows).map(([id, value]) => ({ id, value }));
    },
    async updateIfUnchanged(target, id, oldValue, newValue) {
      const rows = data[`${target.table}.${target.column}`];
      if (rows?.[id] !== oldValue) return false;
      rows[id] = newValue;
      return true;
    },
  };
  return { store, data };
}

const originalKey = process.env.ENCRYPTION_KEY;
const originalAuthSecret = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = "c".repeat(64);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.env.ENCRYPTION_KEY = originalKey;
  vi.restoreAllMocks();
});

describe("backfillSecrets", () => {
  it("krypterer kun klartekst og bevarer alle tokens (round-trip)", async () => {
    const legacy = encrypt("legacy-billy");
    const already = encryptSecret("ya29.already");
    const { store, data } = createStore({
      "calendar_connections.access_token": {
        c1: "ya29.plain-access",
        c2: already,
      },
      "user.billy_api_key": { u1: "billy-plain", u2: legacy },
    });

    const report = await backfillSecrets(store, {
      apply: true,
      targets: TARGETS,
    });

    expect(report.totals).toMatchObject({
      scanned: 4,
      plaintext: 2,
      encrypted: 2,
      alreadyEncrypted: 1,
      legacyEncrypted: 1,
      failed: 0,
    });
    const cal = data["calendar_connections.access_token"];
    expect(cal.c1.startsWith(SECRET_PREFIX)).toBe(true);
    expect(decryptSecret(cal.c1)).toBe("ya29.plain-access");
    expect(cal.c2).toBe(already);
    const users = data["user.billy_api_key"];
    expect(decryptSecret(users.u1)).toBe("billy-plain");
    expect(users.u2).toBe(legacy);
  });

  it("er idempotent: anden kørsel ændrer intet", async () => {
    const { store, data } = createStore({
      "calendar_connections.access_token": { c1: "ya29.one", c2: "ya29.two" },
      "user.billy_api_key": { u1: "billy" },
    });

    await backfillSecrets(store, {
      apply: true,
      targets: TARGETS,
      allowUnverifiedKey: true,
    });
    const afterFirst = structuredClone(data);
    const second = await backfillSecrets(store, {
      apply: true,
      targets: TARGETS,
    });

    expect(second.totals.plaintext).toBe(0);
    expect(second.totals.encrypted).toBe(0);
    expect(second.totals.alreadyEncrypted).toBe(3);
    expect(data).toEqual(afterFirst);
  });

  it("dry-run tæller men skriver intet", async () => {
    const { store, data } = createStore({
      "calendar_connections.access_token": { c1: "ya29.one" },
    });
    const update = vi.spyOn(store, "updateIfUnchanged");

    const report = await backfillSecrets(store, {
      apply: false,
      targets: TARGETS,
    });

    expect(report.totals.plaintext).toBe(1);
    expect(report.totals.encrypted).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(data["calendar_connections.access_token"].c1).toBe("ya29.one");
  });

  it("overskriver ikke en række der ændrede sig undervejs", async () => {
    const { store, data } = createStore({
      "user.billy_api_key": { u1: "billy-old" },
    });
    const original = store.updateIfUnchanged;
    store.updateIfUnchanged = async (target, id, oldValue, newValue) => {
      // Simulér en samtidig skrivning (fx brugeren gemmer en ny nøgle).
      data["user.billy_api_key"].u1 = encryptSecret("billy-new");
      return original(target, id, oldValue, newValue);
    };

    const report = await backfillSecrets(store, {
      apply: true,
      targets: [TARGETS[1]],
      allowUnverifiedKey: true,
    });

    expect(report.totals.changedConcurrently).toBe(1);
    expect(report.totals.encrypted).toBe(0);
    expect(decryptSecret(data["user.billy_api_key"].u1)).toBe("billy-new");
  });

  it("afbryder før første række uden ENCRYPTION_KEY", async () => {
    delete process.env.ENCRYPTION_KEY;
    const { store, data } = createStore({
      "user.billy_api_key": { u1: "billy" },
    });
    const list = vi.spyOn(store, "listRows");

    await expect(
      backfillSecrets(store, { apply: true, targets: TARGETS }),
    ).rejects.toBeInstanceOf(EncryptionKeyError);
    expect(list).not.toHaveBeenCalled();
    expect(data["user.billy_api_key"].u1).toBe("billy");
  });

  it("afbryder --apply når eksisterende krypterede rækker ikke kan dekrypteres (forkert nøgle)", async () => {
    const encryptedWithAppKey = encryptSecret("billy-from-app");
    process.env.ENCRYPTION_KEY = "d".repeat(64); // forkert nøgle
    const { store, data } = createStore({
      "calendar_connections.access_token": { c1: "ya29.plain" },
      "user.billy_api_key": { u1: encryptedWithAppKey },
    });
    const update = vi.spyOn(store, "updateIfUnchanged");

    const err = await backfillSecrets(store, {
      apply: true,
      targets: TARGETS,
      allowUnverifiedKey: true,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(BackfillAbortedError);
    expect((err as BackfillAbortedError).report.unreadableRows).toEqual([
      "user.billy_api_key id=u1",
    ]);
    expect(update).not.toHaveBeenCalled();
    expect(data["calendar_connections.access_token"].c1).toBe("ya29.plain");
  });

  it("kræver --allow-unverified-key når ingen række kan bevise nøglen", async () => {
    const { store } = createStore({
      "user.billy_api_key": { u1: "billy" },
    });
    const update = vi.spyOn(store, "updateIfUnchanged");

    await expect(
      backfillSecrets(store, { apply: true, targets: TARGETS }),
    ).rejects.toBeInstanceOf(BackfillAbortedError);
    expect(update).not.toHaveBeenCalled();
  });

  describe("OAuth-login-tokens og webhook-secret (#710/#712)", () => {
    const AUTH_SECRET = "backfill-".repeat(5);
    const ctx = {
      options: { account: { encryptOAuthTokens: true } },
      secretConfig: AUTH_SECRET,
    } as unknown as Parameters<typeof decryptOAuthToken>[1];
    const accountTargets = SECRET_TARGETS.filter(
      (t) => t.table === "account" || t.table === "outgoing_webhooks",
    );

    beforeEach(() => {
      process.env.BETTER_AUTH_SECRET = AUTH_SECRET;
    });
    afterEach(() => {
      process.env.BETTER_AUTH_SECRET = originalAuthSecret;
    });

    it("dækker account-tokens og outgoing_webhooks.secret", () => {
      expect(accountTargets.map(describeTarget)).toEqual([
        "outgoing_webhooks.secret",
        "account.accessToken",
        "account.refreshToken",
        "account.idToken",
      ]);
    });

    it("krypterer access/refresh i better-auths format og idToken/secret med ENCRYPTION_KEY", async () => {
      const loginEncrypted = await setTokenUtil("ya29.new-login", ctx);
      const { store, data } = createStore({
        "account.accessToken": { a1: "ya29.old", a2: loginEncrypted as string },
        "account.refreshToken": { a1: "1//refresh-old" },
        "account.idToken": { a1: "eyJhbGciOi.eyJ0aWQiOiJ0In0.sig" },
        "outgoing_webhooks.secret": {
          w1: "whsec_abc",
          w2: encryptSecret("whsec_new"),
        },
      });

      const report = await backfillSecrets(store, {
        apply: true,
        targets: accountTargets,
      });

      expect(report.totals).toMatchObject({ plaintext: 4, encrypted: 4 });
      // better-auth (encryptOAuthTokens) kan læse det backfill skrev.
      expect(await decryptOAuthToken(data["account.accessToken"].a1, ctx)).toBe(
        "ya29.old",
      );
      expect(
        await decryptOAuthToken(data["account.refreshToken"].a1, ctx),
      ).toBe("1//refresh-old");
      expect(data["account.accessToken"].a2).toBe(loginEncrypted);
      expect(decryptSecret(data["account.idToken"].a1)).toBe(
        "eyJhbGciOi.eyJ0aWQiOiJ0In0.sig",
      );
      expect(decryptSecret(data["outgoing_webhooks.secret"].w1)).toBe(
        "whsec_abc",
      );
    });

    it("verificerer BETTER_AUTH_SECRET separat: ENCRYPTION_KEY-rækker beviser ikke den", async () => {
      const { store } = createStore({
        "account.accessToken": { a1: "ya29.old" },
        "outgoing_webhooks.secret": { w1: encryptSecret("whsec_x") },
      });
      const update = vi.spyOn(store, "updateIfUnchanged");

      const err = await backfillSecrets(store, {
        apply: true,
        targets: accountTargets,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(BackfillAbortedError);
      expect((err as Error).message).toContain("BETTER_AUTH_SECRET");
      expect(update).not.toHaveBeenCalled();
    });

    it("afbryder når login-krypterede tokens ikke kan læses med scriptets BETTER_AUTH_SECRET", async () => {
      const loginEncrypted = (await setTokenUtil("ya29.x", ctx)) as string;
      process.env.BETTER_AUTH_SECRET = "forkert-".repeat(5);
      const { store, data } = createStore({
        "account.accessToken": { a1: "ya29.old", a2: loginEncrypted },
      });

      const err = await backfillSecrets(store, {
        apply: true,
        targets: accountTargets,
        allowUnverifiedKey: true,
      }).catch((e) => e);

      expect(err).toBeInstanceOf(BackfillAbortedError);
      expect(data["account.accessToken"].a1).toBe("ya29.old");
    });
  });

  it("verifyOnly-mål bruges til nøgle-tjek, men klartekst røres ikke", async () => {
    const { store, data } = createStore({
      "calendar_connections.access_token": {
        a1: encrypt("icloud-password"),
        a2: "unexpected-plain",
      },
      "user.billy_api_key": { u1: "billy" },
    });

    const report = await backfillSecrets(store, {
      apply: true,
      targets: [{ ...TARGETS[0], verifyOnly: true }, TARGETS[1]],
    });

    expect(report.keyVerifiedRows).toBe(1);
    expect(data["calendar_connections.access_token"].a2).toBe(
      "unexpected-plain",
    );
    expect(decryptSecret(data["user.billy_api_key"].u1)).toBe("billy");
  });
});
