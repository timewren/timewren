/**
 * INTEGRATION: tilbagekald af Google Calendar mod det fulde schema. Kører den
 * rigtige `calendar.disconnect`-router, kontosletningen og
 * `saveCalendarConnection` (callbackens gem) med fetch mocket. Reglen: der
 * tilbagekaldes kun, når rækken har et Google-konto-id, og ingen anden række
 * (enhver bruger, ethvert brand) har samme konto; ellers slettes der kun
 * lokalt.
 *
 * - den eneste forbindelse til kontoen tilbagekaldes én gang med rækkens eget
 *   token, først efter commit; Google-rækkerne (inkl. børn) slettes, Outlook
 *   bliver stående;
 * - fejler Google (500, timeout), slettes der alligevel, og tokenet logges
 *   ikke;
 * - en række uden konto-id tilbagekaldes ikke, og en anden brugers række uden
 *   konto-id blokerer ikke for den eneste forbindelse til en kendt konto;
 * - samme bruger med to primære rækker til samme konto: ingen tilbagekaldes;
 * - ruller frakobling eller kontosletning tilbage, også først ved COMMIT, er
 *   Google ikke kaldt;
 * - callbacken genbruger aldrig det gemte refresh-token;
 * - en tokenfornyelse, der var i gang, mens callbacken gemte en anden konto,
 *   skriver ikke den gamle kontos token på rækken;
 * - efter en tokenfornyelse gemmes konto-id'et på en ældre række;
 * - to lokale brugere med samme Google-konto (forskellige brands): frakobling
 *   eller kontosletning af den ene tilbagekalder ikke og lader den anden stå;
 * - frakobling (bruger A) og en callback, der gemmer samme Google-konto for
 *   bruger B, venter på hinanden på kontoens lås; har B gemt efter A's
 *   commit, tilbagekaldes der ikke, og under selve kaldet venter B;
 * - en callback under kontosletningen venter på brugerens lås og gemmer intet.
 *
 * Kører kun med TEST_DATABASE_URL sat til en kasseret database med repoets
 * schema (`npm run db:migrate`). Filen får sin egen klon (isolatedTestDatabase).
 */
import { randomUUID } from "node:crypto";
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
  process.env.GOOGLE_CLIENT_ID = "tt-g-id";
  process.env.GOOGLE_CLIENT_SECRET = ["tt", "secret"].join("-");
  const refreshAccessToken = vi.fn();
  const request = vi.fn(async () => {
    throw new Error("ikke mocket");
  });
  /** Kun tokenfornyelse og userinfo; Google kaldes aldrig. */
  class FakeOAuth2 {
    transporter = { defaults: {} };
    setCredentials() {}
    refreshAccessToken = refreshAccessToken;
    request = request;
  }
  return { db: undefined as unknown, refreshAccessToken, request, FakeOAuth2 };
});

vi.mock("google-auth-library", () => ({ OAuth2Client: h.FakeOAuth2 }));

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
vi.mock("@/lib/alunta", () => ({
  alunta: { subscriptions: { cancel: vi.fn(async () => ({})) } },
}));
vi.mock("@/lib/trpc/routers/enterprise/middleware", () => ({
  resolveModules: vi.fn(async () => ({})),
  makePermissiveModules: vi.fn(() => ({})),
}));
vi.mock("@/lib/notifications/admin", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { deleteUserAccountCompletely } from "@/lib/account-deletion";
import * as schema from "@/lib/db/schema";
import {
  getAuthenticatedClient,
  saveCalendarConnection,
} from "@/lib/integrations/google-calendar";
import { GOOGLE_REVOKE_URL } from "@/lib/integrations/google-calendar-revoke";
import { calendarRouter } from "@/lib/trpc/routers/calendar";
import { decryptSecret, encryptSecret } from "@/lib/utils/encryption";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  "tilbagekald af Google Calendar (integration)",
  () => {
    const run = randomUUID().slice(0, 8);
    const id = (name: string) => `gr-${run}-${name}`;
    const testDb = isolatedTestDatabase();
    const pg = testPostgres({ max: 6, database: testDb.name });
    const db = drizzle(pg, { schema });
    h.db = db;
    const fetchMock = vi.fn();
    const envBefore = { ...process.env };
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      await testDb.create();
      await connectTestDb(pg);
      process.env.ENCRYPTION_KEY = "a".repeat(64);
      delete process.env.S3_ENDPOINT;
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    beforeEach(() => {
      fetchMock.mockReset();
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      errorSpy.mockClear();
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      process.env = envBefore;
      await pg.end();
      await testDb.drop();
    });

    async function seedUser(name: string) {
      const userId = id(name);
      await pg`
        INSERT INTO "user" ${pg({
          id: userId,
          email: `${userId}@example.test`,
          name: `Person ${name}`,
          emailVerified: true,
        })}`;
      const orgId = id(`${name}-org`);
      await pg`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, ${`Org ${name}`}, ${orgId})`;
      await pg`INSERT INTO members (id, organization_id, user_id, role) VALUES (${`${orgId}-m`}, ${orgId}, ${userId}, 'owner')`;
      return userId;
    }

    /**
     * Primær Google-forbindelse (med et barn uden tokens) og, med `outlook`,
     * en Outlook-forbindelse.
     */
    async function seedGoogle(
      userId: string,
      v: { brand: string; sub: string | null; refresh: string },
      { outlook = false } = {},
    ) {
      const [parent] = await pg`
        INSERT INTO calendar_connections
          (user_id, provider, oauth_brand, provider_account_sub, access_token,
           refresh_token, calendar_id)
        VALUES (${userId}, 'google', ${v.brand}, ${v.sub},
                ${encryptSecret(`ya29.${randomUUID()}`)},
                ${encryptSecret(v.refresh)}, 'primary')
        RETURNING id`;
      await pg`
        INSERT INTO calendar_connections
          (user_id, provider, oauth_brand, calendar_id, parent_connection_id)
        VALUES (${userId}, 'google', ${v.brand}, 'work', ${parent.id})`;
      if (outlook) {
        await pg`
          INSERT INTO calendar_connections
            (user_id, provider, oauth_brand, access_token, refresh_token, calendar_id)
          VALUES (${userId}, 'outlook', 'timewren', ${encryptSecret("eyJ.outlook")},
                  ${encryptSecret("M.outlook-refresh")}, 'primary')`;
      }
    }

    async function providers(userId: string) {
      const rows = await pg<{ provider: string }[]>`
        SELECT provider FROM calendar_connections WHERE user_id = ${userId}
        ORDER BY provider`;
      return rows.map((r) => r.provider);
    }

    function revoked() {
      return fetchMock.mock.calls
        .filter(([url]) => url === GOOGLE_REVOKE_URL)
        .map(([, init]) => new URLSearchParams(String(init.body)).get("token"));
    }

    const callerFor = (userId: string) =>
      calendarRouter.createCaller({
        session: {
          user: { id: userId, email: `${userId}@example.test` },
          session: { id: `s-${userId}`, userId },
        },
        db,
        headers: new Headers(),
      } as never);

    /**
     * Hold `calendar_connections` i SHARE-tilstand fra en anden forbindelse,
     * så frakobling eller kontosletning står ved sin DELETE med låsene taget
     * og transaktionen åben (Google kaldes først efter commit). `FOR UPDATE`
     * og optællingen går igennem.
     */
    async function blockConnectionDeletes() {
      const blocker = await pg.reserve();
      await blocker`BEGIN`;
      await blocker`LOCK TABLE calendar_connections IN SHARE MODE`;
      return async () => {
        await blocker`COMMIT`;
        blocker.release();
      };
    }

    /**
     * Vent, til PostgreSQL viser en forbindelse i denne database, der venter
     * på en lås af typen `event` (`advisory` eller `relation`). Et uafsluttet
     * løfte alene beviser ikke ventetiden (forbindelsen kan bare åbne
     * langsomt).
     */
    async function waitForLockWait(event: "advisory" | "relation") {
      for (let i = 0; i < 200; i++) {
        const [{ waiting }] = await pg<{ waiting: number }[]>`
          SELECT count(*)::int AS waiting FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND wait_event = ${event}`;
        if (waiting > 0) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`ingen forbindelse venter på en ${event}-lås`);
    }

    /**
     * Lad sletningen af `userId`s Google-rækker fejle først ved COMMIT (en
     * udskudt constraint-trigger), efter alle DELETE-statements er gået
     * igennem.
     */
    async function failAtCommit(userId: string) {
      const fn = `fail_commit_${run.replace(/-/g, "")}`;
      await pg.unsafe(`
        CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $f$
        BEGIN
          IF OLD.user_id = '${userId}' THEN RAISE EXCEPTION 'afvist ved commit'; END IF;
          RETURN NULL;
        END $f$`);
      await pg.unsafe(
        `CREATE CONSTRAINT TRIGGER ${fn} AFTER DELETE ON calendar_connections
         DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ${fn}()`,
      );
      return async () => {
        await pg.unsafe(`DROP TRIGGER ${fn} ON calendar_connections`);
        await pg.unsafe(`DROP FUNCTION ${fn}()`);
      };
    }

    it("frakobling af den eneste forbindelse til kontoen tilbagekalder én gang og sletter kun Google", async () => {
      const userId = await seedUser("sole");
      await seedGoogle(
        userId,
        { brand: "timewren", sub: `sub-${run}-sole`, refresh: "1//sole" },
        { outlook: true },
      );
      // Hvad en anden forbindelse ser, mens Google kaldes: først efter commit
      let seenAtRevoke: string[] = [];
      fetchMock.mockImplementation(async () => {
        seenAtRevoke = await providers(userId);
        return new Response(null, { status: 200 });
      });

      await expect(callerFor(userId).disconnect()).resolves.toEqual({
        success: true,
      });

      expect(revoked()).toEqual(["1//sole"]);
      expect(seenAtRevoke).toEqual(["outlook"]);
      expect(await providers(userId)).toEqual(["outlook"]);
    });

    it.each([
      ["500", () => Promise.resolve(new Response(null, { status: 500 }))],
      [
        "timeout",
        () =>
          Promise.reject(
            Object.assign(new Error("The operation timed out"), {
              name: "TimeoutError",
            }),
          ),
      ],
    ])(
      "frakobler alligevel, når Google svarer %s, og logger uden token",
      async (label, response) => {
        const userId = await seedUser(`fails-${label}`);
        const refresh = `1//fails-${label}`;
        await seedGoogle(userId, {
          brand: "timetrack",
          sub: `sub-${run}-fails-${label}`,
          refresh,
        });
        fetchMock.mockImplementation(response);

        await expect(callerFor(userId).disconnect()).resolves.toEqual({
          success: true,
        });

        expect(revoked()).toEqual([refresh]);
        expect(await providers(userId)).toEqual([]);
        const logged = JSON.stringify(errorSpy.mock.calls);
        expect(logged).toContain("calendar_revoke_failed");
        expect(logged).not.toContain(refresh);
      },
    );

    it("tilbagekalder ikke en række uden Google-konto-id", async () => {
      const userId = await seedUser("no-sub");
      await seedGoogle(userId, {
        brand: "timetrack",
        sub: null,
        refresh: "1//no-sub",
      });

      await callerFor(userId).disconnect();

      expect(revoked()).toEqual([]);
      expect(await providers(userId)).toEqual([]);
    });

    it("en anden brugers række uden konto-id blokerer ikke tilbagekaldet af den eneste forbindelse til kontoen", async () => {
      const a = await seedUser("unknown-a");
      const b = await seedUser("unknown-b");
      await seedGoogle(a, {
        brand: "timetrack",
        sub: `sub-${run}-unknown`,
        refresh: "1//unknown-a",
      });
      // B's række er fra før konto-id'et blev gemt
      await seedGoogle(b, {
        brand: "timetrack",
        sub: null,
        refresh: "1//unknown-b",
      });

      await callerFor(a).disconnect();

      expect(revoked()).toEqual(["1//unknown-a"]);
      expect(await providers(a)).toEqual([]);
      expect(await providers(b)).toEqual(["google", "google"]);
    });

    it("samme bruger med to primære rækker til samme konto: ingen af dem tilbagekaldes", async () => {
      const userId = await seedUser("twice");
      const sub = `sub-${run}-twice`;
      await seedGoogle(userId, {
        brand: "timetrack",
        sub,
        refresh: "1//twice-1",
      });
      await seedGoogle(userId, {
        brand: "timewren",
        sub,
        refresh: "1//twice-2",
      });

      await callerFor(userId).disconnect();

      expect(revoked()).toEqual([]);
      expect(await providers(userId)).toEqual([]);
    });

    it.each([
      ["frakobling", (userId: string) => callerFor(userId).disconnect()],
      [
        "kontosletning",
        (userId: string) => deleteUserAccountCompletely(db, userId),
      ],
    ])(
      "%s kalder ikke Google, når transaktionen først ruller tilbage ved COMMIT",
      async (label, remove) => {
        const userId = await seedUser(`commit-${label}`);
        await seedGoogle(userId, {
          brand: "timetrack",
          sub: `sub-${run}-commit-${label}`,
          refresh: `1//commit-${label}`,
        });
        const drop = await failAtCommit(userId);
        try {
          // Fejlen skal komme fra den udskudte trigger, altså ved COMMIT
          // efter alle DELETE-statements, ikke fra et tidligere statement
          await expect(remove(userId)).rejects.toThrow(/afvist ved commit/);
        } finally {
          await drop();
        }

        expect(revoked()).toEqual([]);
        expect(await providers(userId)).toEqual(["google", "google"]);
      },
    );

    it("callbacken genbruger aldrig det gemte refresh-token", async () => {
      const userId = await seedUser("switch");
      const x = `sub-${run}-switch-x`;
      await seedGoogle(userId, { brand: "timetrack", sub: x, refresh: "1//x" });
      const save = (sub: string, brand: "timetrack" | "timewren") =>
        saveCalendarConnection(
          userId,
          {
            accessToken: `ya29.${sub}`,
            refreshToken: undefined,
            tokenExpiry: null,
            accountEmail: null,
            accountSub: sub,
          },
          brand,
        );
      const refreshOf = async () => {
        const [row] = await pg<{ refresh_token: string | null }[]>`
          SELECT refresh_token FROM calendar_connections
          WHERE user_id = ${userId} AND parent_connection_id IS NULL`;
        return row.refresh_token ? decryptSecret(row.refresh_token) : null;
      };

      const restore = () => pg`
        UPDATE calendar_connections SET refresh_token = ${encryptSecret("1//x")},
          oauth_brand = 'timetrack', provider_account_sub = ${x}
        WHERE user_id = ${userId} AND parent_connection_id IS NULL`;

      // Samme konto og brand kan stadig være et skiftet klient-id
      await save(x, "timetrack");
      expect(await refreshOf()).toBeNull();

      await restore();
      await save(x, "timewren");
      expect(await refreshOf()).toBeNull();

      await restore();
      await save(`sub-${run}-switch-y`, "timetrack");
      expect(await refreshOf()).toBeNull();
    });

    it("en tokenfornyelse skriver ikke den gamle kontos token på en forbindelse, callbacken har erstattet", async () => {
      const userId = await seedUser("refresh-race");
      const other = await seedUser("refresh-race-other");
      const x = `sub-${run}-refresh-x`;
      const y = `sub-${run}-refresh-y`;
      // En anden bruger er stadig forbundet til X
      await seedGoogle(other, { brand: "timetrack", sub: x, refresh: "1//rx" });
      await pg`
        INSERT INTO calendar_connections
          (user_id, provider, provider_account_sub, access_token, refresh_token,
           token_expiry, calendar_id)
        VALUES (${userId}, 'google', ${x}, ${encryptSecret("ya29.x-old")},
                ${encryptSecret("1//x")}, now() - interval '1 minute', 'primary')`;
      // Mens synken venter på Google, gemmer callbacken konto Y uden nyt
      // refresh-token
      h.refreshAccessToken.mockImplementationOnce(async () => {
        await saveCalendarConnection(
          userId,
          {
            accessToken: "ya29.y",
            refreshToken: undefined,
            tokenExpiry: new Date(Date.now() + 3_600_000),
            accountEmail: null,
            accountSub: y,
          },
          "timetrack",
        );
        return { credentials: { access_token: "ya29.x-new", expiry_date: 1 } };
      });

      await expect(getAuthenticatedClient(userId)).resolves.toBeNull();

      const [row] = await pg<
        { access_token: string; provider_account_sub: string }[]
      >`
        SELECT access_token, provider_account_sub FROM calendar_connections
        WHERE user_id = ${userId}`;
      expect(decryptSecret(row.access_token)).toBe("ya29.y");
      expect(row.provider_account_sub).toBe(y);

      // Frakoblingen tilbagekalder kun Y's eget token, aldrig X's bevilling
      await callerFor(userId).disconnect();
      expect(revoked()).toEqual(["ya29.y"]);
      expect(await providers(other)).toEqual(["google", "google"]);
    });

    it("efter en tokenfornyelse gemmes konto-id'et på en ældre række", async () => {
      const userId = await seedUser("refresh-sub");
      const sub = `sub-${run}-refresh-sub`;
      await pg`
        INSERT INTO calendar_connections
          (user_id, provider, access_token, refresh_token, token_expiry,
           calendar_id)
        VALUES (${userId}, 'google', ${encryptSecret("ya29.old")},
                ${encryptSecret("1//refresh-sub")}, now() - interval '1 minute',
                'primary')`;
      h.refreshAccessToken.mockResolvedValueOnce({
        credentials: {
          access_token: "ya29.new",
          expiry_date: Date.now() + 3_600_000,
        },
      });
      h.request.mockResolvedValueOnce({ data: { id: sub } } as never);

      await expect(getAuthenticatedClient(userId)).resolves.not.toBeNull();

      const [row] = await pg<
        { access_token: string; provider_account_sub: string | null }[]
      >`
        SELECT access_token, provider_account_sub FROM calendar_connections
        WHERE user_id = ${userId}`;
      expect(decryptSecret(row.access_token)).toBe("ya29.new");
      expect(row.provider_account_sub).toBe(sub);
    });

    it("to lokale brugere med samme Google-konto: frakobling af den ene tilbagekalder ikke", async () => {
      const a = await seedUser("shared-a");
      const b = await seedUser("shared-b");
      const sub = `sub-${run}-shared`;
      // Samme Google-konto, forskellige brands
      await seedGoogle(a, { brand: "timetrack", sub, refresh: "1//shared-a" });
      await seedGoogle(b, { brand: "timewren", sub, refresh: "1//shared-b" });

      await callerFor(a).disconnect();

      expect(revoked()).toEqual([]);
      expect(await providers(a)).toEqual([]);
      expect(await providers(b)).toEqual(["google", "google"]);
    });

    it("kontosletning tilbagekalder den eneste forbindelse og ikke en delt", async () => {
      const sole = await seedUser("del-sole");
      await seedGoogle(sole, {
        brand: "timewren",
        sub: `sub-${run}-del-sole`,
        refresh: "1//del-sole",
      });
      await expect(deleteUserAccountCompletely(db, sole)).resolves.toEqual({
        outcome: "deleted",
      });
      expect(revoked()).toEqual(["1//del-sole"]);
      expect(await providers(sole)).toEqual([]);

      fetchMock.mockClear();
      const a = await seedUser("del-shared-a");
      const b = await seedUser("del-shared-b");
      const sub = `sub-${run}-del-shared`;
      await seedGoogle(a, { brand: "timetrack", sub, refresh: "1//del-a" });
      await seedGoogle(b, { brand: "timewren", sub, refresh: "1//del-b" });
      await expect(deleteUserAccountCompletely(db, a)).resolves.toEqual({
        outcome: "deleted",
      });
      expect(revoked()).toEqual([]);
      expect(await providers(b)).toEqual(["google", "google"]);
    });

    it("frakobling (A) og en callback, der gemmer samme Google-konto for B, venter på kontoens lås, og B's gem efter A's commit stopper tilbagekaldet", async () => {
      const a = await seedUser("lock-a");
      const b = await seedUser("lock-b");
      const sub = `sub-${run}-lock`;
      await seedGoogle(a, { brand: "timetrack", sub, refresh: "1//lock-a" });
      const release = await blockConnectionDeletes();

      // A er den eneste med kontoen og står ved sin DELETE med låsene taget
      const disconnect = callerFor(a).disconnect();
      disconnect.catch(() => {});
      await waitForLockWait("relation");

      // B's callback gemmer samme Google-konto og må vente på kontoens lås
      const callback = saveCalendarConnection(
        b,
        {
          accessToken: "ya29.lock-b",
          refreshToken: "1//lock-b",
          tokenExpiry: null,
          accountEmail: `${run}-lock@example.test`,
          accountSub: sub,
        },
        "timewren",
      );
      callback.catch(() => {});
      try {
        await waitForLockWait("advisory");
        expect(await providers(b)).toEqual([]);
      } finally {
        await release();
      }
      await expect(disconnect).resolves.toEqual({ success: true });
      await expect(callback).resolves.toEqual(expect.any(String));
      // B gemte efter A's commit og før Google blev kaldt: A's tilbagekald
      // ville slå B's forbindelse ihjel og sendes derfor ikke
      expect(revoked()).toEqual([]);
      expect(await providers(a)).toEqual([]);
      expect(await providers(b)).toEqual(["google"]);
    });

    it("en callback for samme Google-konto venter, mens Google kaldes", async () => {
      const a = await seedUser("during-a");
      const b = await seedUser("during-b");
      const sub = `sub-${run}-during`;
      await seedGoogle(a, { brand: "timetrack", sub, refresh: "1//during-a" });
      let callback: Promise<string> | undefined;
      // Sættes kun, når B beviseligt venter på en lås under kaldet (en fejl
      // i fetch-mocken ville ellers blot ligne en netværksfejl)
      let savedDuringRevoke: string[] | undefined;
      fetchMock.mockImplementation(async () => {
        callback = saveCalendarConnection(
          b,
          {
            accessToken: "ya29.during-b",
            refreshToken: "1//during-b",
            tokenExpiry: null,
            accountEmail: null,
            accountSub: sub,
          },
          "timewren",
        );
        callback.catch(() => {});
        await waitForLockWait("advisory");
        savedDuringRevoke = await providers(b);
        return new Response(null, { status: 200 });
      });

      await expect(callerFor(a).disconnect()).resolves.toEqual({
        success: true,
      });
      await expect(callback).resolves.toEqual(expect.any(String));
      expect(revoked()).toEqual(["1//during-a"]);
      expect(savedDuringRevoke).toEqual([]);
      expect(await providers(b)).toEqual(["google"]);
    });

    it("en callback under kontosletningen venter på brugerens lås og gemmer intet", async () => {
      const userId = await seedUser("race-deletion");
      await seedGoogle(userId, {
        brand: "timetrack",
        sub: `sub-${run}-race-deletion`,
        refresh: "1//race-deletion-old",
      });
      const release = await blockConnectionDeletes();

      const deletion = deleteUserAccountCompletely(db, userId);
      deletion.catch(() => {});
      await waitForLockWait("relation");

      const callback = saveCalendarConnection(
        userId,
        {
          accessToken: "ya29.race-deletion-new",
          refreshToken: "1//race-deletion-new",
          tokenExpiry: null,
          accountEmail: `${run}-race-deletion-ny@example.test`,
          accountSub: `sub-${run}-race-deletion-ny`,
        },
        "timetrack",
      );
      callback.catch(() => {});
      try {
        await waitForLockWait("advisory");
      } finally {
        await release();
      }
      await expect(deletion).resolves.toEqual({ outcome: "deleted" });
      // Brugeren er væk: indsættelsen fejler på fremmednøglen
      await expect(callback).rejects.toThrow();
      expect(await providers(userId)).toEqual([]);
      expect(revoked()).toEqual(["1//race-deletion-old"]);
    });
  },
);
