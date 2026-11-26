import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Afsenderne slår modtagerens brand op (users.brand) og sender TimeWren-
 * konti en TimeWren-mail: afsender, navn, links og sprog. TimeTrack-konti får
 * præcis samme mail som uden multibrand. Se docs/specs/timewren-cloud.md.
 */

const h = vi.hoisted(() => ({
  findUser: vi.fn(),
  findSentEmail: vi.fn(),
  persistSentEmail: vi.fn(),
  findMembership: vi.fn(),
  classifyOrganization: vi.fn(),
  sent: [] as Array<Record<string, unknown>>,
  user: { brand: "timewren", locale: null as string | null },
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: h.findUser },
      sentEmails: { findFirst: h.findSentEmail },
      members: { findFirst: h.findMembership },
    },
    select: (fields: { isTest: { sql: SQL } }) => ({
      from: () => h.classifyOrganization(fields.isTest.sql),
    }),
    insert: () => ({ values: h.persistSentEmail }),
  },
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "noreply@timetrack.dk",
  PERSONAL_FROM_EMAIL: "Mads fra TimeTrack <mads@timetrack.dk>",
  resend: {
    emails: {
      send: vi.fn(async (payload: Record<string, unknown>) => {
        h.sent.push(payload);
        return { data: { id: "x" }, error: null };
      }),
    },
  },
}));
vi.mock("@/lib/email/transport", () => ({ isMailAvailable: () => true }));

import { sendPaymentFailedEmail, sendTrialEndingEmail } from "./billing";
import { sendDripWelcomeEmail } from "./drip";
import { sendInvoiceEmail } from "./invoice";
import { sendMagicLinkEmail } from "./magic-link";
import { brandUrl, mailBrandFor, resolveMailBrand } from "./mail-brand";
import { sendOrganizationInviteEmail } from "./organization";
import { sendPasswordResetEmail } from "./password-reset";
import { sendWeeklySummaryEmail } from "./reports";
import {
  sendNewLoginEmail,
  sendPasswordChangedEmail,
  sendTwoFactorCodeEmail,
} from "./security";
import { sendVerificationEmail } from "./verification";
import { sendWelcomeEmail } from "./welcome";

const APP = "https://timetrack.dk";

const SENDERS: Record<string, () => Promise<unknown>> = {
  passwordReset: () =>
    sendPasswordResetEmail({
      to: "a@example.com",
      name: "Test",
      resetUrl: "https://timewren.com/reset-password/tok",
      userId: "u1",
    }),
  verification: () =>
    sendVerificationEmail({
      to: "a@example.com",
      name: "Test",
      verificationUrl: "https://timewren.com/api/auth/verify-email?token=x",
      userId: "u1",
    }),
  magicLink: () =>
    sendMagicLinkEmail({
      to: "a@example.com",
      magicLinkUrl: "https://timewren.com/api/auth/magic-link/verify?token=x",
    }),
  orgInvite: () =>
    sendOrganizationInviteEmail({
      to: "b@example.com",
      inviterName: "Afsender",
      organizationName: "Firma",
      inviteUrl: "https://timewren.com/auth/accept-invitation?token=x",
      role: "member",
      userId: "u1",
    }),
  newLogin: () =>
    sendNewLoginEmail({
      to: "a@example.com",
      userName: "Test",
      loginAt: new Date("2026-11-08T09:42:00.000Z"),
      userId: "u1",
    }),
  passwordChanged: () =>
    sendPasswordChangedEmail({
      to: "a@example.com",
      userName: "Test",
      changedAt: new Date("2026-11-08T09:42:00.000Z"),
      userId: "u1",
    }),
  twoFactor: () =>
    sendTwoFactorCodeEmail({
      to: "a@example.com",
      userName: "Test",
      code: "123456",
      userId: "u1",
    }),
  dripWelcome: () =>
    sendDripWelcomeEmail({
      to: "account+kunde@company.dk",
      userName: "Test",
      userId: "u1",
    }),
  weeklySummary: () =>
    sendWeeklySummaryEmail({
      to: "a@example.com",
      userName: "Test",
      weekNumber: 45,
      year: 2026,
      hoursThisWeek: 30,
      hoursLastWeek: 25,
      revenueThisWeek: 20000,
      revenueLastWeek: 15000,
      unbilledAmount: 5000,
      topClients: [{ name: "Kunde", hours: 10, revenue: 5000 }],
      daysTracked: 4,
      userId: "u1",
    }),
  // Kalderen (Alunta-webhooken) bygger linket med appens URL.
  trialEnding: () =>
    sendTrialEndingEmail({
      to: "account+kunde@company.dk",
      userName: "Test",
      daysRemaining: 3,
      upgradeUrl: `${APP}/dashboard/settings/subscription`,
      userId: "u1",
    }),
  paymentFailed: () =>
    sendPaymentFailedEmail({
      to: "a@example.com",
      userName: "Test",
      amountDue: "79,00 kr",
      billingPortalUrl: `${APP}/dashboard/settings/subscription`,
      userId: "u1",
    }),
  // Kundemail: afsenderens (kontoens) brand.
  invoice: () =>
    sendInvoiceEmail({
      to: "kunde@example.com",
      invoiceNumber: "2026-0042",
      clientName: "Kunde",
      amount: "8125.00",
      dueDate: "2026-10-25T00:00:00.000Z",
      senderName: "Afsender",
      senderEmail: "a@example.com",
      userId: "u1",
    } as Parameters<typeof sendInvoiceEmail>[0]),
};

beforeEach(() => {
  vi.stubEnv("MULTIBRAND_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  vi.stubEnv("DATABASE_URL", "postgres://test");
  h.sent = [];
  h.findUser.mockReset().mockImplementation(async () => h.user);
  h.findSentEmail.mockReset().mockResolvedValue(undefined);
  h.persistSentEmail.mockReset().mockResolvedValue(undefined);
  h.findMembership.mockReset().mockResolvedValue({ organizationId: "org1" });
  h.classifyOrganization.mockReset().mockResolvedValue([{ isTest: false }]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const body = (p: Record<string, unknown>) =>
  `${p.subject} ${p.html ?? ""} ${p.text ?? ""} ${JSON.stringify(p.headers ?? {})} ${p.replyTo ?? ""}`;

describe("afsendere for en TimeWren-konto", () => {
  for (const [name, send] of Object.entries(SENDERS)) {
    it(`${name}: TimeWren-afsender, ingen TimeTrack/timetrack.dk`, async () => {
      h.user = { brand: "timewren", locale: null };
      await send();
      expect(h.sent).toHaveLength(1);
      const p = h.sent[0];
      expect(p.from).toBe("TimeWren <noreply@timewren.com>");
      expect(body(p)).not.toMatch(/timetrack/i);
      expect(body(p)).toContain("TimeWren");
    });
  }

  it("sproget falder tilbage til brandets standard (en) uden profilsprog", async () => {
    h.user = { brand: "timewren", locale: null };
    await SENDERS.passwordReset();
    expect(String(h.sent[0].html)).toContain('lang="en"');
  });

  it("profilsproget vinder (de)", async () => {
    h.user = { brand: "timewren", locale: "de" };
    await SENDERS.passwordReset();
    expect(String(h.sent[0].html)).toContain('lang="de"');
  });

  it("links bygget med appens URL flyttes til TimeWren-hosten", async () => {
    h.user = { brand: "timewren", locale: null };
    await SENDERS.trialEnding();
    expect(String(h.sent[0].html)).toContain(
      "https://timewren.com/dashboard/settings/subscription",
    );
  });
});

describe("afsendere for en TimeTrack-konto er uændrede", () => {
  for (const [name, send] of Object.entries(SENDERS)) {
    it(`${name}: samme mail med og uden MULTIBRAND_ENABLED`, async () => {
      h.user = { brand: "timetrack", locale: null };
      await send();
      vi.stubEnv("MULTIBRAND_ENABLED", "");
      await send();
      expect(h.sent).toHaveLength(2);
      expect(h.sent[0]).toEqual(h.sent[1]);
      expect(h.sent[0].from).not.toContain("TimeWren");
      expect(body(h.sent[0])).not.toContain("TimeWren");
    });
  }
});

describe("resolveMailBrand og brandUrl", () => {
  it("uden flaget slås intet op", async () => {
    vi.stubEnv("MULTIBRAND_ENABLED", "");
    h.user = { brand: "timewren", locale: null };
    expect(await resolveMailBrand({ userId: "u1" })).toBeUndefined();
  });

  it("kendt brand bruges uden opslag; timetrack giver ingen mailBrand", async () => {
    expect(await resolveMailBrand({ brand: "timetrack" })).toBeUndefined();
    expect(await resolveMailBrand({ brand: null })).toBeUndefined();
    expect((await resolveMailBrand({ brand: "timewren" }))?.key).toBe(
      "timewren",
    );
  });

  it("TimeWrens app-URL er den primære host (ingen app.-host)", () => {
    vi.stubEnv(
      "BRANDS_CONFIG",
      JSON.stringify({
        timewren: { hosts: ["timewren.com", "www.timewren.com"] },
      }),
    );
    const mb = mailBrandFor("timewren");
    expect(mb.appUrl).toBe("https://timewren.com");
    expect(mb.loginUrl).toBe("https://timewren.com/login");
  });

  it("brandUrl flytter kun appens egne links", () => {
    const mb = mailBrandFor("timewren");
    expect(brandUrl(`${APP}/dashboard?x=1#y`, mb)).toBe(
      "https://timewren.com/dashboard?x=1#y",
    );
    expect(brandUrl("https://billing.stripe.com/p/x", mb)).toBe(
      "https://billing.stripe.com/p/x",
    );
    expect(brandUrl(`${APP}/dashboard`, undefined)).toBe(`${APP}/dashboard`);
    expect(brandUrl(null, mb)).toBeNull();
  });
});

describe("lifecycle mail recipient checks", () => {
  const recipient = "account+customer@example.net";
  const name = "Example Customer";
  const senders = [
    {
      name: "welcome",
      send: (to: string) =>
        sendWelcomeEmail({ to, name, brand: "timewren", userId: "u1" }),
    },
    {
      name: "drip welcome",
      send: (to: string) =>
        sendDripWelcomeEmail({ to, userName: name, userId: "u1" }),
    },
    {
      name: "trial ending with an explicit subscription organization",
      send: (to: string) =>
        sendTrialEndingEmail({
          to,
          userName: name,
          daysRemaining: 3,
          upgradeUrl: APP,
          userId: "u1",
          organizationId: "subscription-org",
        }),
    },
  ];

  it.each(senders)(
    "$name sends without logging personal data when lookups fail",
    async ({ send }) => {
      const info = vi.spyOn(console, "log").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const queryError = new Error(
        `Failed query\nparams: ${recipient},${name}`,
      );
      h.classifyOrganization.mockRejectedValueOnce(queryError);
      h.findUser.mockRejectedValue(queryError);
      h.findSentEmail.mockRejectedValue(queryError);
      h.persistSentEmail.mockRejectedValue(queryError);

      await send(recipient);

      expect(h.sent).toHaveLength(1);
      expect(h.sent[0].to).toBe(recipient);
      expect(h.persistSentEmail).toHaveBeenCalledWith(
        expect.objectContaining({ recipientEmail: recipient }),
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Test recipient lookup failed"),
        expect.objectContaining({ userId: "u1" }),
      );
      expect(info).toHaveBeenCalledWith(expect.stringContaining("email.sent"));
      const logs = [info, warn, error]
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map(String).join(" "))
        .join("\n");
      expect(logs).not.toContain(recipient);
      expect(logs).not.toContain(name);
    },
  );

  it("uses the test subscription organization over the real primary workspace", async () => {
    const dialect = new PgDialect();
    h.classifyOrganization.mockImplementation(async (query: SQL) => [
      { isTest: dialect.sqlToQuery(query).params.includes("subscription-org") },
    ]);

    await senders[2].send(recipient);

    expect(h.classifyOrganization).toHaveBeenCalledOnce();
    expect(h.sent).toHaveLength(0);
  });

  it.each(senders)(
    "$name skips an identified test organization",
    async ({ send }) => {
      h.classifyOrganization.mockResolvedValueOnce([{ isTest: true }]);
      await send(recipient);
      expect(h.sent).toHaveLength(0);
    },
  );

  it.each(senders)(
    "$name skips a test address before querying the database",
    async ({ send }) => {
      await send("test@example.com");
      expect(h.findMembership).not.toHaveBeenCalled();
      expect(h.classifyOrganization).not.toHaveBeenCalled();
      expect(h.sent).toHaveLength(0);
    },
  );
});
