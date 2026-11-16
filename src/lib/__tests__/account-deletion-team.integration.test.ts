/**
 * INTEGRATION (#918, #919): kontosletning for teammedlemmer mod det fulde
 * schema (alle FK'er og ON DELETE-regler som i prod). Kører de rigtige
 * tRPC-routere (`user.deleteAccount`, `user.getAccountDeletionInfo`,
 * `organization.transferOwnership`) og admin-vejen (`deleteAllUserData`).
 *
 * - medlem i et team: teamets rækker bevares og peger på en anonymiseret
 *   bruger, solo-orgen slettes, login er umuligt, Apple-token tilbagekaldes;
 * - solo-bruger: alt slettes, også user-rækken;
 * - eneste ejer af et team: afvist med årsag, tilladt efter overdragelse;
 * - admin-vejen giver samme udfald.
 *
 * Kører kun med TEST_DATABASE_URL sat til en kasseret database med repoets
 * schema (`drizzle-kit push`, som CI's Unit Tests-job). Testen skriver i
 * public-schemaet med unikke id'er pr. kørsel og rydder op efter sig.
 */
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

const h = vi.hoisted(() => ({
  db: undefined as unknown,
  activeOrg: null as string | null,
}));

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
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => h.activeOrg),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
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

import {
  AUDIT_RETENTION_TABLES,
  buildDeletionSql,
  deletedUserEmail,
  USER_REFERENCE_POLICY,
} from "@/lib/account-deletion";
import { APPLE_REVOKE_URL } from "@/lib/auth/apple";
import * as schema from "@/lib/db/schema";
import { DELETED_USER_LABEL } from "@/lib/org-audit";
import { betterAuthTokenCodec } from "@/lib/security/oauth-token-crypto";
import { deleteAllUserData } from "@/lib/trpc/routers/admin/shared";
import { organizationRouter } from "@/lib/trpc/routers/organization";
import { userRouter } from "@/lib/trpc/routers/user";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  "kontosletning for teammedlemmer (integration, #918/#919)",
  () => {
    const run = randomUUID().slice(0, 8);
    const id = (name: string) => `kd-${run}-${name}`;
    const pg = testPostgres({ max: 2 });
    const db = drizzle(pg, { schema });
    h.db = db;
    const createdUsers: string[] = [];
    const createdOrgs: string[] = [];
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

    // Alt hemmeligt dannes ved kørsel; intet nøglelignende står i filen
    const envBefore = { ...process.env };
    beforeAll(() => connectTestDb(pg));
    beforeAll(() => {
      const { privateKey } = generateKeyPairSync("ec", {
        namedCurve: "P-256",
      });
      process.env.BETTER_AUTH_SECRET = randomBytes(32).toString("hex");
      delete process.env.BETTER_AUTH_SECRETS;
      process.env.APPLE_TEAM_ID = "TEAMTEST01";
      process.env.APPLE_KEY_ID = "KEYTEST01";
      process.env.APPLE_CLIENT_ID = "dk.timetrack.test.web";
      process.env.APPLE_PRIVATE_KEY = privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString();
      delete process.env.S3_ENDPOINT;
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterAll(async () => {
      vi.unstubAllGlobals();
      process.env = envBefore;
      // Oprydning: tøm testens orgs for medlemmer og slet dem med sletnings-
      // SQL'en (via en rydde-bruger), og slet så de brugere, der er tilbage.
      await pg`DELETE FROM members WHERE organization_id = ANY(${createdOrgs})`;
      const sweeper = await seedUser("rydder");
      await pg.unsafe(buildDeletionSql(sweeper, createdOrgs));
      for (const userId of createdUsers.filter((u) => u !== sweeper)) {
        const [exists] = await pg`SELECT 1 FROM "user" WHERE id = ${userId}`;
        if (exists) await pg.unsafe(buildDeletionSql(userId, []));
      }
      const [left] = await pg`
        SELECT count(*)::int AS n FROM "user" WHERE id LIKE ${`kd-${run}-%`}`;
      expect(left.n).toBe(0);
      await pg.end();
    });

    async function seedUser(name: string, extra: Record<string, unknown> = {}) {
      const userId = id(name);
      createdUsers.push(userId);
      await pg`
        INSERT INTO "user" ${pg({
          id: userId,
          email: `${userId}@example.test`,
          name: `Person ${name}`,
          emailVerified: true,
          image: `https://example.test/${userId}.png`,
          phoneNumber: `+45${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
          billy_api_key: `enc:v1:${randomBytes(8).toString("hex")}`,
          ...extra,
        })}`;
      return userId;
    }

    async function seedOrg(name: string, owner: string, others: string[] = []) {
      const orgId = id(name);
      createdOrgs.push(orgId);
      await pg`INSERT INTO organizations (id, name, slug) VALUES (${orgId}, ${`Org ${name}`}, ${orgId})`;
      await pg`INSERT INTO members (id, organization_id, user_id, role) VALUES (${`${orgId}-${owner}`}, ${orgId}, ${owner}, 'owner')`;
      for (const m of others) {
        await pg`INSERT INTO members (id, organization_id, user_id, role) VALUES (${`${orgId}-${m}`}, ${orgId}, ${m}, 'member')`;
      }
      return orgId;
    }

    /** Teamdata, som medlemmet har registreret i en org. */
    async function seedWork(userId: string, orgId: string) {
      const [client] = await pg`
        INSERT INTO clients (name, user_id, organization_id)
        VALUES ('Kunde', ${userId}, ${orgId}) RETURNING id`;
      const [project] = await pg`
        INSERT INTO projects (name, user_id, organization_id, client_id)
        VALUES ('Projekt', ${userId}, ${orgId}, ${client.id}) RETURNING id`;
      const [pkg] = await pg`
        INSERT INTO prepaid_packages (name, client_id, user_id, organization_id,
          total_hours, remaining_hours, hourly_rate, total_value, purchase_date)
        VALUES ('Klippekort', ${client.id}, ${userId}, ${orgId}, 10, 8, 900, 9000, now())
        RETURNING id`;
      // Fast tidspost: én af posterne er genereret fra skabelonen (NO ACTION-FK)
      const [template] = await pg`
        INSERT INTO recurring_time_templates (name, user_id, organization_id, description, hours, template_type, is_active)
        VALUES ('Fast', ${userId}, ${orgId}, 'Ugentligt møde', 1, 'time_entry', true)
        RETURNING id`;
      await pg`
        INSERT INTO time_entries (user_id, organization_id, project_id, client_id, hours, date, recurring_template_id)
        VALUES (${userId}, ${orgId}, ${project.id}, ${client.id}, 2, now(), ${template.id}),
               (${userId}, ${orgId}, ${project.id}, ${client.id}, 1.5, now(), NULL)`;
      await pg`
        INSERT INTO invoices (invoice_number, client_id, user_id, organization_id, amount, issue_date)
        VALUES (${`F-${randomUUID().slice(0, 6)}`}, ${client.id}, ${userId}, ${orgId}, 1800, now())`;
      const [task] = await pg`
        INSERT INTO tasks (user_id, organization_id, title)
        VALUES (${userId}, ${orgId}, 'Opgave') RETURNING id`;
      await pg`
        INSERT INTO task_comments (task_id, user_id, organization_id, content, content_html)
        VALUES (${task.id}, ${userId}, ${orgId}, '{}'::jsonb, '<p>ok</p>')`;
      await pg`
        INSERT INTO activity_logs (user_id, organization_id, entity_type, entity_id, action)
        VALUES (${userId}, ${orgId}, 'time_entry', ${randomUUID()}, 'create')`;
      await pg`
        INSERT INTO notification_inbox (organization_id, user_id, event, title, body)
        VALUES (${orgId}, ${userId}, 'test', 'Titel', 'Tekst')`;
      return { pkg: pkg.id as string, task: task.id as string };
    }

    /** Login, nøgler og enheder. Apple-tokenet krypteres som better-auth gør. */
    async function seedLogin(userId: string, appleRefreshToken?: string) {
      await pg`INSERT INTO session (id, "userId", token, "expiresAt") VALUES (${`s-${userId}`}, ${userId}, ${randomUUID()}, now() + interval '1 day')`;
      await pg`INSERT INTO account (id, "userId", "accountId", "providerId", password) VALUES (${`a-${userId}`}, ${userId}, ${userId}, 'credential', ${randomUUID()})`;
      if (appleRefreshToken) {
        await pg`INSERT INTO account (id, "userId", "accountId", "providerId", "refreshToken", "accessToken")
          VALUES (${`apple-${userId}`}, ${userId}, ${`apple-sub-${userId}`}, 'apple',
                  ${await betterAuthTokenCodec.encrypt(appleRefreshToken)},
                  ${await betterAuthTokenCodec.encrypt(randomUUID())})`;
      }
      await pg`INSERT INTO passkey (id, "publicKey", "userId", "credentialID") VALUES (${`pk-${userId}`}, ${randomUUID()}, ${userId}, ${randomUUID()})`;
      await pg`INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix) VALUES (${`ak-${userId}`}, ${userId}, 'Nøgle', ${randomUUID()}, 'tt_')`;
      await pg`INSERT INTO mobile_push_tokens (user_id, token, platform) VALUES (${userId}, ${randomUUID()}, 'ios')`;
    }

    const callerFor = <T extends { createCaller: (ctx: never) => unknown }>(
      r: T,
      userId: string,
      activeOrg: string | null,
    ) => {
      h.activeOrg = activeOrg;
      return r.createCaller({
        session: {
          user: { id: userId, email: `${userId}@example.test` },
          session: { id: `s-${userId}`, userId },
        },
        db,
        headers: new Headers(),
      } as never) as ReturnType<T["createCaller"]>;
    };

    async function count(table: string, col: string, value: string) {
      const [row] = await pg.unsafe(
        `SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`,
        [value],
      );
      return row.n as number;
    }

    /** Alle FK-kolonner mod "user".id (som sletnings-SQL'en ser dem). */
    async function userForeignKeys() {
      return pg<{ tbl: string; relname: string; col: string }[]>`
        SELECT c.conrelid::regclass::text AS tbl, cl.relname, a.attname AS col
        FROM pg_constraint c
        JOIN pg_class cl ON cl.oid = c.conrelid
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.confrelid = '"user"'::regclass AND c.contype = 'f'
          AND array_length(c.conkey, 1) = 1
          AND c.conrelid <> '"user"'::regclass`;
    }

    async function referencesTo(userId: string) {
      const hits: string[] = [];
      for (const fk of await userForeignKeys()) {
        if (
          (await count(fk.tbl, `"${fk.col}"`, userId)) > 0 &&
          !hits.includes(`${fk.relname}.${fk.col}`)
        ) {
          hits.push(`${fk.relname}.${fk.col}`);
        }
      }
      return hits.sort();
    }

    async function expectAnonymized(userId: string) {
      const [u] = await pg`SELECT * FROM "user" WHERE id = ${userId}`;
      expect(u).toMatchObject({
        name: DELETED_USER_LABEL,
        email: deletedUserEmail(userId),
        emailVerified: false,
        image: null,
        phoneNumber: null,
        billy_api_key: null,
        banned: true,
        role: null,
      });
      // Login er umuligt: ingen adgangsveje tilbage
      for (const [table, col] of [
        ["session", '"userId"'],
        ["account", '"userId"'],
        ["passkey", '"userId"'],
        ['"twoFactor"', '"userId"'],
        ["api_keys", "user_id"],
        ["extension_tokens", "user_id"],
        ["mobile_push_tokens", "user_id"],
        ["members", "user_id"],
        ["notification_inbox", "user_id"],
      ]) {
        expect(await count(table, col, userId), table).toBe(0);
      }
    }

    it("hver FK mod user har en bevidst valgt politik", async () => {
      const retention = new Set<string>(AUDIT_RETENTION_TABLES);
      const inDb = (await userForeignKeys())
        .filter((fk) => !retention.has(fk.relname))
        .map((fk) => `${fk.relname}.${fk.col}`);
      const missing = inDb.filter((key) => !(key in USER_REFERENCE_POLICY));
      expect(missing, "tilføj til USER_REFERENCE_POLICY").toEqual([]);
      const stale = Object.keys(USER_REFERENCE_POLICY).filter(
        (key) => !inDb.includes(key),
      );
      expect(stale, "findes ikke længere i schemaet").toEqual([]);
    });

    it("medlem i et team: teamets data bevares, brugeren anonymiseres, Apple tilbagekaldes", async () => {
      const boss = await seedUser("chef1");
      const member = await seedUser("medlem1");
      const team = await seedOrg("team1", boss, [member]);
      const solo = await seedOrg("solo1", member);
      await seedWork(member, team);
      await seedWork(member, solo);
      await seedWork(boss, team);
      const appleToken = `apple-${randomUUID()}`;
      await seedLogin(member, appleToken);
      await seedLogin(boss);
      // Chefens fravær godkendt af medlemmet (aktørreference)
      const [type] = await pg`
        INSERT INTO absence_types (organization_id, name) VALUES (${team}, 'Ferie') RETURNING id`;
      await pg`
        INSERT INTO absence_requests (organization_id, user_id, absence_type_id, start_date, approved_by)
        VALUES (${team}, ${boss}, ${type.id}, now()::date, ${member})`;

      // Ældre hændelse om medlemmet med navnet i metadata
      await pg`
        INSERT INTO org_audit_logs (organization_id, actor_id, actor_label, action, target_user_id, metadata)
        VALUES (${team}, ${boss}, 'Chef', 'member_role_changed', ${member},
                ${JSON.stringify({ name: "Person medlem1", oldRole: "member", newRole: "admin" })}::jsonb)`;

      const caller = callerFor(userRouter, member, team);
      await expect(caller.getAccountDeletionInfo()).resolves.toMatchObject({
        canDelete: true,
        blockReason: null,
        teamCount: 1,
      });
      fetchMock.mockClear();
      await expect(
        caller.deleteAccount({ confirmEmail: `${member}@example.test` }),
      ).resolves.toEqual({ success: true });

      // Teamets rækker består og peger på den anonymiserede bruger
      expect(await count("time_entries", "user_id", member)).toBe(2);
      expect(await count("invoices", "user_id", member)).toBe(1);
      expect(await count("prepaid_packages", "user_id", member)).toBe(1);
      expect(await count("tasks", "user_id", member)).toBe(1);
      expect(await count("task_comments", "user_id", member)).toBe(1);
      expect(await count("activity_logs", "user_id", member)).toBe(1);
      expect(await count("projects", "user_id", member)).toBe(1);
      expect(await count("clients", "user_id", member)).toBe(1);
      expect(await count("absence_requests", "approved_by", member)).toBe(1);
      // Teamets hændelseslog viser, at medlemmet forlod teamet
      const audit = await pg`
        SELECT actor_id, actor_label, target_email, metadata FROM org_audit_logs
         WHERE organization_id = ${team} AND action = 'member_removed'`;
      expect(audit).toEqual([
        {
          actor_id: null,
          actor_label: DELETED_USER_LABEL,
          target_email: DELETED_USER_LABEL,
          metadata: { name: DELETED_USER_LABEL, reason: "account_deleted" },
        },
      ]);
      const [roleChange] = await pg`
        SELECT metadata FROM org_audit_logs
         WHERE organization_id = ${team} AND action = 'member_role_changed'`;
      expect(roleChange.metadata).toEqual({
        name: DELETED_USER_LABEL,
        oldRole: "member",
        newRole: "admin",
      });
      // Den faste skabelon består (posten peger på den) men er slået fra
      const templates = await pg`
        SELECT is_active FROM recurring_time_templates WHERE user_id = ${member}`;
      expect(templates).toEqual([{ is_active: false }]);
      const [{ n: teamEntries }] =
        await pg`SELECT count(*)::int AS n FROM time_entries WHERE organization_id = ${team}`;
      expect(teamEntries).toBe(4);
      // Solo-orgen er væk med alt i den
      expect(await count("organizations", "id", solo)).toBe(0);
      expect(await count("time_entries", "organization_id", solo)).toBe(0);
      expect(await count("organizations", "id", team)).toBe(1);
      expect(await count("members", "user_id", boss)).toBe(1);
      expect(await count("session", '"userId"', boss)).toBe(1);
      await expectAnonymized(member);

      // Apple: det rigtige (dekrypterede) refresh-token, mod Apples endpoint
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe(APPLE_REVOKE_URL);
      const body = new URLSearchParams(String(init.body));
      expect(body.get("token")).toBe(appleToken);
      expect(body.get("token_type_hint")).toBe("refresh_token");
      expect(body.get("client_id")).toBe("dk.timetrack.test.web");
      expect(body.get("client_secret")?.split(".")).toHaveLength(3);
    });

    it("login er umuligt efter anonymisering (rigtigt better-auth-login)", async () => {
      const { hashPassword } = await import("better-auth/crypto");
      const { auth } = await import("@/lib/auth");
      const boss = await seedUser("chef7");
      const member = await seedUser("medlem7");
      const team = await seedOrg("team7", boss, [member]);
      await seedWork(member, team);
      const password = randomUUID();
      await pg`INSERT INTO account (id, "userId", "accountId", "providerId", password)
        VALUES (${`a-${member}`}, ${member}, ${member}, 'credential', ${await hashPassword(password)})`;
      const signIn = (email: string) =>
        auth.api.signInEmail({ body: { email, password } });

      // Kontrol: login virker før sletningen, så testen kan fange en fejl
      await expect(signIn(`${member}@example.test`)).resolves.toMatchObject({
        user: { id: member },
      });

      await deleteAllUserData(db as never, member);

      await expect(signIn(`${member}@example.test`)).rejects.toThrow();
      await expect(signIn(deletedUserEmail(member))).rejects.toThrow();
      await expectAnonymized(member);
      // Kold import af auth + tre scrypt-kald overskrider 5 s på en travl runner
    }, 30_000);

    it("fejler Apples revoke, er kontoen alligevel slettet og fejlen logget uden token", async () => {
      const boss = await seedUser("chef5");
      const member = await seedUser("medlem5");
      const team = await seedOrg("team5", boss, [member]);
      await seedWork(member, team);
      const appleToken = `apple-${randomUUID()}`;
      await seedLogin(member, appleToken);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));

      await deleteAllUserData(db as never, member);

      await expectAnonymized(member);
      const logged = error.mock.calls.map((c) => c.map(String).join(" "));
      expect(logged.some((l) => l.includes("MANUEL OPFØLGNING"))).toBe(true);
      expect(logged.some((l) => l.includes(appleToken))).toBe(false);
      error.mockRestore();
    });

    it("medlem uden registreringer i teamet slettes helt", async () => {
      const boss = await seedUser("chef6");
      const member = await seedUser("medlem6");
      const team = await seedOrg("team6", boss, [member]);
      await seedLogin(member);

      await expect(deleteAllUserData(db as never, member)).resolves.toEqual({
        outcome: "deleted",
      });
      expect(await count('"user"', "id", member)).toBe(0);
      expect(await count("members", "organization_id", team)).toBe(1);
    });

    it("solo-bruger: alt slettes, også user-rækken", async () => {
      const soloUser = await seedUser("solo2");
      const solo = await seedOrg("solo2", soloUser);
      await seedWork(soloUser, solo);
      await seedLogin(soloUser, `apple-${randomUUID()}`);

      await expect(
        callerFor(userRouter, soloUser, solo).deleteAccount({
          confirmEmail: `${soloUser}@example.test`,
        }),
      ).resolves.toEqual({ success: true });

      expect(await count('"user"', "id", soloUser)).toBe(0);
      expect(await count("organizations", "id", solo)).toBe(0);
      expect(await referencesTo(soloUser)).toEqual([]);
    });

    it("eneste ejer af et team: afvist med årsag — tilladt efter overdragelse", async () => {
      const owner = await seedUser("ejer3");
      const colleague = await seedUser("kollega3");
      const team = await seedOrg("team3", owner, [colleague]);
      await seedWork(owner, team);
      await seedLogin(owner);

      const caller = callerFor(userRouter, owner, team);
      await expect(caller.getAccountDeletionInfo()).resolves.toMatchObject({
        canDelete: false,
        blockReason: "owner_must_transfer",
        blockingOrgs: [{ id: team, name: "Org team3" }],
      });
      await expect(
        caller.deleteAccount({ confirmEmail: `${owner}@example.test` }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("Overdrag ejerskabet"),
      });
      expect(await count("members", "user_id", owner)).toBe(1);

      // Overdragelse via den rigtige router (ejer → admin, kollega → ejer)
      await callerFor(organizationRouter, owner, team).transferOwnership({
        targetUserId: colleague,
      });
      const roles = await pg`
        SELECT user_id, role FROM members WHERE organization_id = ${team} ORDER BY role`;
      expect(roles).toEqual([
        { user_id: owner, role: "admin" },
        { user_id: colleague, role: "owner" },
      ]);

      await expect(
        callerFor(userRouter, owner, team).getAccountDeletionInfo(),
      ).resolves.toMatchObject({ canDelete: true, blockReason: null });
      await expect(
        callerFor(userRouter, owner, team).deleteAccount({
          confirmEmail: `${owner}@example.test`,
        }),
      ).resolves.toEqual({ success: true });

      await expectAnonymized(owner);
      expect(await count("time_entries", "user_id", owner)).toBe(2);
      expect(await count("organizations", "id", team)).toBe(1);
      expect(await count("members", "user_id", colleague)).toBe(1);
    });

    it("TOCTOU-guard: en forældet plan afbrydes i transaktionen og intet ændres", async () => {
      const owner = await seedUser("ejer8");
      const colleague = await seedUser("kollega8");
      const team = await seedOrg("team8", owner, [colleague]);
      const solo = await seedOrg("solo8", owner);
      await seedWork(owner, team);
      await seedLogin(owner);

      // Planen tror, brugeren kan forlade teamet, men brugeren er eneste ejer
      await expect(
        pg.unsafe(buildDeletionSql(owner, [solo], [team])),
      ).rejects.toThrow(/eneste ejer/);
      // Solo-orgen fik et nyt medlem efter planen blev lavet
      await pg`UPDATE members SET role = 'owner' WHERE organization_id = ${team} AND user_id = ${colleague}`;
      await pg`INSERT INTO members (id, organization_id, user_id, role) VALUES (${`${solo}-ny`}, ${solo}, ${colleague}, 'member')`;
      await expect(
        pg.unsafe(buildDeletionSql(owner, [solo], [team])),
      ).rejects.toThrow(/fik andre medlemmer/);

      // Alt rullet tilbage
      expect(await count("organizations", "id", solo)).toBe(1);
      expect(await count("members", "user_id", owner)).toBe(2);
      expect(await count("session", '"userId"', owner)).toBe(1);
      const [u] = await pg`SELECT name FROM "user" WHERE id = ${owner}`;
      expect(u.name).toBe("Person ejer8");
    });

    it("admin-vejen: samme udfald — teamets poster bevares, solo-data slettes, ejer afvises", async () => {
      const boss = await seedUser("chef4");
      const member = await seedUser("medlem4");
      const team = await seedOrg("team4", boss, [member]);
      const solo = await seedOrg("solo4", member);
      await seedWork(member, team);
      await seedWork(member, solo);
      await seedLogin(member);

      // Chefen er eneste ejer af et team med andre medlemmer
      await expect(deleteAllUserData(db as never, boss)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await count("members", "user_id", boss)).toBe(1);

      await expect(deleteAllUserData(db as never, member)).resolves.toEqual({
        outcome: "anonymized",
      });
      expect(await count("time_entries", "user_id", member)).toBe(2);
      expect(await count("invoices", "user_id", member)).toBe(1);
      expect(await count("prepaid_packages", "user_id", member)).toBe(1);
      expect(await count("organizations", "id", solo)).toBe(0);
      expect(await count("time_entries", "organization_id", solo)).toBe(0);
      await expectAnonymized(member);

      // En anonymiseret bruger kan slettes igen uden at noget ændres
      await expect(deleteAllUserData(db as never, member)).resolves.toEqual({
        outcome: "anonymized",
      });
      expect(await count("time_entries", "user_id", member)).toBe(2);
    });
  },
);
