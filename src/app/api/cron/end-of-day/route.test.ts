import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { users } from "@/lib/db/schema";

/**
 * Dagsoversigten følger modtagerens brand (users.brand): afsender, links og
 * tekst og afmeldingsheaderen. TimeTrack-konti får samme mail som før
 * multibrand.
 */

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const h = vi.hoisted(() => ({
  sent: [] as Array<Record<string, unknown>>,
  brand: "timewren" as string | null,
  usersSelect: undefined as unknown,
  usersWhere: undefined as unknown,
}));

// Kædbar, afventbar db-stub: kun users-forespørgslen giver rækker.
vi.mock("@/lib/db", () => {
  const chain = (rows: unknown[], isUsers = false) => {
    const c: Promise<unknown> & Record<string, unknown> = Object.assign(
      Promise.resolve(rows),
      {} as Record<string, unknown>,
    );
    for (const m of ["where", "leftJoin", "orderBy", "limit"]) c[m] = () => c;
    if (isUsers) {
      c.where = (w: unknown) => {
        h.usersWhere = w;
        return c;
      };
    }
    return c;
  };
  return {
    db: {
      select: (fields: unknown) => ({
        from: (t: unknown) => {
          if (t === users) h.usersSelect = fields;
          return chain(
            t === users
              ? [
                  {
                    user: {
                      id: "u1",
                      email: "a@example.com",
                      brand: h.brand,
                      locale: null,
                      timezone: "Europe/Copenhagen",
                    },
                    prefs: {
                      endOfDayEnabled: true,
                      endOfDayTime: "17:00",
                      quietHoursEnabled: false,
                    },
                  },
                ]
              : [],
            t === users,
          );
        },
      }),
    },
  };
});
vi.mock("@/lib/cron/get-user-org", () => ({ getUserOrgId: async () => null }));
vi.mock("@/lib/email/logger", () => ({
  withEmailLogging: (_ctx: unknown, fn: () => unknown) => fn(),
  wasEmailSentRecently: async () => false,
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "noreply@timetrack.dk",
  resend: {
    emails: {
      send: vi.fn(async (payload: Record<string, unknown>) => {
        h.sent.push(payload);
        return { data: { id: "x" }, error: null };
      }),
    },
  },
}));

import { GET } from "./route";

const run = () =>
  (GET as unknown as (r: Request) => Promise<unknown>)(
    new Request("http://localhost/api/cron/end-of-day"),
  );

describe("end-of-day cron: mailbrand", () => {
  beforeEach(() => {
    h.sent = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    // 17:05 i København (vintertid, UTC+1).
    vi.setSystemTime(new Date("2026-11-09T16:05:00Z"));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://timetrack.dk");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("TimeWren-konto: TimeWren-afsender og links, intet TimeTrack", async () => {
    h.brand = "timewren";
    await run();
    expect(h.sent).toHaveLength(1);
    const mail = h.sent[0];
    expect(String(mail.from)).toContain("timewren.com");
    expect(String(mail.html)).toContain("https://timewren.com/dashboard/time");
    expect(String(mail.html)).not.toMatch(/timetrack\.dk/i);
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain(
      "TimeTrack",
    );
    // Mailklientens afmeldingsknap peger på kontoens eget brand.
    const headers = mail.headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/timewren\.com\/api\/unsubscribe\?token=/,
    );
  });

  it("TimeTrack-konto: uændret afsender og app-URL", async () => {
    h.brand = "timetrack";
    await run();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].from).toBe("noreply@timetrack.dk");
    expect(String(h.sent[0].html)).toContain(
      "https://timetrack.dk/dashboard/time",
    );
    const headers = h.sent[0].headers as Record<string, string>;
    expect(headers["List-Unsubscribe"]).toMatch(
      /^<https:\/\/timetrack\.dk\/api\/unsubscribe\?token=/,
    );
  });
});

describe("end-of-day cron: brugerscanningen (#1115)", () => {
  it("henter kun de brugerkolonner, cronen bruger — ingen credentials", async () => {
    await run();
    const fields = h.usersSelect as { user: Record<string, unknown> };
    expect(Object.keys(fields.user).sort()).toEqual([
      "brand",
      "email",
      "id",
      "locale",
      "timezone",
    ]);
  });

  it("udelukker i SQL brugere uden aktiv dagsoversigt (mail eller kanal)", async () => {
    await run();
    expect(h.usersWhere).toBeDefined();
    const { sql } = new PgDialect().sqlToQuery(h.usersWhere as SQL);
    expect(sql).toContain('"email_preferences"."end_of_day_enabled" = $');
    expect(sql).toMatch(/exists \(select 1 from "notification_channels"/i);
    expect(sql).toContain('"notification_channels"."send_end_of_day" = true');
  });
});
