/**
 * INTEGRATION: baggrundssynken må ikke overskrive "forbind igen". Når Google
 * afviser fornyelsen med invalid_grant (fx efter et forsinket tilbagekald),
 * slår token-laget forbindelsen fra med en "reconnect"-besked. Synken
 * returnerer derefter "Not connected to Google Calendar", og cron skal bevare
 * token-lagets besked, så CalendarReconnectBanner viser "forbind igen" og
 * ikke "Prøv igen". Kører den rigtige cron-rute og synk mod det fulde schema;
 * kun Googles OAuth-klient er mocket.
 *
 * Kører kun med TEST_DATABASE_URL (se google-calendar-revoke.integration.test.ts).
 */
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  connectTestDb,
  isolatedTestDatabase,
  testPostgres,
} from "@/test/test-db";

const h = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client";
  process.env.GOOGLE_CLIENT_SECRET = ["test", "secret"].join("-");
  const refreshAccessToken = vi.fn(async () => {
    throw Object.assign(new Error("invalid_grant"), {
      name: "GaxiosError",
      response: { status: 400, data: { error: "invalid_grant" } },
    });
  });
  class FakeOAuth2 {
    transporter = { defaults: {} };
    setCredentials() {}
    refreshAccessToken = refreshAccessToken;
    request = vi.fn(async () => ({ data: {} }));
  }
  return { db: undefined as unknown, FakeOAuth2, refreshAccessToken };
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
vi.mock("google-auth-library", () => ({ OAuth2Client: h.FakeOAuth2 }));
vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging:
    (_name: string, handler: (request: Request) => Promise<unknown>) =>
    (request: Request) =>
      handler(request),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { GET } from "@/app/api/cron/calendar-sync/route";
import * as schema from "@/lib/db/schema";
import { getCalendarConnectionStatus } from "@/lib/integrations/google-calendar";
import { encryptSecret } from "@/lib/utils/encryption";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  "kalendersynk-cron og invalid_grant (integration)",
  () => {
    const run = randomUUID().slice(0, 8);
    const testDb = isolatedTestDatabase();
    const pg = testPostgres({ max: 4, database: testDb.name });
    h.db = drizzle(pg, { schema });
    const envBefore = { ...process.env };

    beforeAll(async () => {
      await testDb.create();
      await connectTestDb(pg);
      process.env.ENCRYPTION_KEY = "a".repeat(64);
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterAll(async () => {
      process.env = envBefore;
      await pg.end();
      await testDb.drop();
    });

    it("bevarer token-lagets 'reconnect', når fornyelsen giver invalid_grant", async () => {
      const userId = `cs-${run}`;
      await pg`
        INSERT INTO "user" ${pg({
          id: userId,
          email: `${userId}@example.test`,
          name: "Person",
          emailVerified: true,
        })}`;
      await pg`
        INSERT INTO calendar_connections
          (user_id, provider, provider_account_sub, access_token,
           refresh_token, token_expiry, calendar_id, sync_enabled)
        VALUES (${userId}, 'google', ${`sub-${run}`},
                ${encryptSecret("ya29.expired")}, ${encryptSecret("1//revoked")},
                now() - interval '1 minute', 'primary', true)`;

      await GET(new Request("http://localhost/api/cron/calendar-sync"));

      expect(h.refreshAccessToken).toHaveBeenCalledTimes(1);
      const [row] = await pg<
        {
          sync_enabled: boolean;
          sync_error: string;
          consecutive_sync_failures: number;
        }[]
      >`
        SELECT sync_enabled, sync_error, consecutive_sync_failures
        FROM calendar_connections WHERE user_id = ${userId}`;
      expect(row.sync_enabled).toBe(false);
      expect(row.consecutive_sync_failures).toBe(1);
      // CalendarReconnectBanner viser "forbind igen" for netop denne tekst
      expect(row.sync_error).toContain("reconnect");
      const status = await getCalendarConnectionStatus(userId);
      expect(status.error).toContain("reconnect");
    });
  },
);
