import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DripNoTimeEntryEmail } from "@/components/email/DripNoTimeEntryEmail";
import { NewLoginEmail } from "@/components/email/NewLoginEmail";

const send = vi.fn();

vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "TimeTrack <noreply@timetrack.dk>",
  PERSONAL_FROM_EMAIL: "Mads Holst Jensen <mads@timetrack.dk>",
  resend: { emails: { send: (...args: unknown[]) => send(...args) } },
}));

vi.mock("../logger", () => ({
  logEmailSkipped: vi.fn(),
  withEmailLogging: (_ctx: unknown, fn: () => Promise<unknown>) => fn(),
}));

const { renderEmail } = await import("../render-email");
const { sendExpiryWarning, sendLowBalanceAlert } = await import("../prepaid");
const { sendDripNoTimeEntryEmail } = await import("../drip");

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ data: { id: "x" }, error: null });
  process.env.RESEND_API_KEY = "test";
  process.env.NEXT_PUBLIC_APP_URL = "https://timetrack.dk";
});

describe("renderEmail", () => {
  it("giver en læsbar tekstversion med 'Nøgle: værdi' og uden header-støj", async () => {
    const { html, text } = await renderEmail(
      createElement(NewLoginEmail, {
        userName: "Mette",
        loginAt: new Date("2026-10-05T07:42:00Z"),
        ipAddress: "87.61.12.34",
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0",
      }),
    );
    expect(html).toContain('lang="da"');
    expect(html).toContain("prefers-color-scheme: dark");
    expect(text).toContain("Tidspunkt: 5. oktober 2026 kl. 09.42");
    expect(text).toContain("Enhed: Chrome på Windows");
    expect(text.trimStart().startsWith("Nyt login på din konto")).toBe(true);
  });

  it("mørk tilstand gør alle brødtekst-links lyse, ikke kun .tt-link", async () => {
    const { emailDarkModeCss } = await import(
      "@/components/email/email-dark-mode"
    );
    expect(emailDarkModeCss).toContain('.tt-card a:not([style*="background"])');
  });

  it("drip-mails har et synligt afmeldingslink", async () => {
    const { html, text } = await renderEmail(
      createElement(DripNoTimeEntryEmail, {
        userName: "Mette",
        unsubscribeUrl: "https://timetrack.dk/api/unsubscribe?token=abc",
      }),
    );
    expect(html).toContain("afmeld disse mails");
    expect(text).toContain("https://timetrack.dk/api/unsubscribe?token=abc");
  });
});

describe("afsendelse", () => {
  it("klippekort-advarslen linker til klippekortet i dashboardet, ikke landingssiden", async () => {
    await sendExpiryWarning({
      to: "mette@example.dk",
      recipientName: "Mette",
      clientName: "Eksempel ApS",
      packageName: "Klippekort 20 timer",
      remainingHours: "6,5",
      expiryDate: "2026-10-12",
      daysUntilExpiry: 7,
    });
    const { html, text } = send.mock.calls[0][0];
    expect(html).toContain('href="https://timetrack.dk/dashboard/klippekort"');
    expect(html).not.toContain('href="https://timetrack.dk/klippekort"');
    expect(text).toContain("Udløber: 12. oktober 2026");
  });

  it("lav-saldo-advarslen linker til dashboardet og sender tekstversion", async () => {
    await sendLowBalanceAlert({
      to: "mette@example.dk",
      recipientName: "Mette",
      clientName: "Eksempel ApS",
      packageName: "Klippekort 20 timer",
      remainingHours: "2",
      totalHours: "20",
      percentageRemaining: 10,
    });
    const { html, text } = send.mock.calls[0][0];
    expect(html).toContain('href="https://timetrack.dk/dashboard/klippekort"');
    expect(text).toBeTruthy();
  });

  it("aktiveringsdrip sender tekstversion, afmeldingsheader og -link", async () => {
    await sendDripNoTimeEntryEmail({
      to: "mette@example.dk",
      userName: "Mette",
      userId: "user-1",
    });
    const payload = send.mock.calls[0][0];
    expect(payload.text).toContain("afmeld disse mails");
    expect(payload.headers["List-Unsubscribe"]).toContain("/api/unsubscribe");
    expect(payload.html).toContain("/api/unsubscribe?token=");
  });
});

describe("klippekort-advarsler til kunden", () => {
  const base = {
    to: "lars@kunde.dk",
    recipientName: "Eksempel ApS",
    clientName: "Eksempel ApS",
    packageName: "Klippekort 20 timer",
    remainingHours: "2",
    recipient: "client" as const,
    senderName: "Mette Hansen Design",
    senderEmail: "mette@example.dk",
  };

  it.each([
    [
      "udløb",
      () =>
        sendExpiryWarning({
          ...base,
          expiryDate: "2026-10-12",
          daysUntilExpiry: 7,
        }),
    ],
    [
      "lav saldo",
      () =>
        sendLowBalanceAlert({
          ...base,
          totalHours: "20",
          percentageRemaining: 10,
        }),
    ],
  ])(
    "%s uden portal-link får kundevarianten uden dashboard-knap",
    async (_navn, sendIt) => {
      await sendIt();
      const { html, subject } = send.mock.calls[0][0];
      expect(html).not.toContain("/dashboard");
      expect(html).not.toContain("Mailindstillinger");
      expect(html).not.toContain("kontakt kunden");
      expect(html).toContain("mailto:mette@example.dk");
      expect(subject).not.toContain("Klippekort advarsel");
    },
  );

  it("med portal-link får kunden forny-knappen", async () => {
    await sendExpiryWarning({
      ...base,
      expiryDate: "2026-10-12",
      daysUntilExpiry: 7,
      portalUrl: "https://timetrack.dk/portal/abc",
    });
    const { html } = send.mock.calls[0][0];
    expect(html).toContain('href="https://timetrack.dk/portal/abc"');
    expect(html).not.toContain("/dashboard");
  });
});
