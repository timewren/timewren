/**
 * Renderer alle mails til HTML-filer til visuel gennemgang.
 *
 *   MAIL_PREVIEW_OUT=<mappe> npx vitest run --config scripts/brand/vitest.preview.config.ts
 *
 * React-skabelonerne renderes direkte med opdigtede data (mail-fixtures).
 * Mails der bygges inde i en send-funktion fanges ved at mocke Resend, så
 * præcis den HTML, brugeren ville få, ender i filen. Derefter tager
 * screenshot-mails.mjs billeder i lys, mørk og tvungen inversion.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@react-email/render";
import { describe, expect, it, vi } from "vitest";
import { MAIL_FIXTURES } from "./mail-fixtures";

const sent: { subject: string; html: string }[] = [];
const fakeSend = vi.fn(async (msg: { subject: string; html: string }) => {
  sent.push({ subject: msg.subject, html: msg.html });
  return { data: { id: "preview" }, error: null };
});

vi.mock("@/lib/resend", async () => {
  // Afsendere fra brandregistret (CONTACT_EMAIL/EMAIL_DOMAIN), ikke hardkodet.
  const { brand } = await import("@/lib/brand");
  const { getEmailDomain } = await import("@/lib/config");
  const client = { emails: { send: fakeSend } };
  return {
    DEFAULT_FROM_EMAIL: `${brand.name} <noreply@${getEmailDomain()}>`,
    PERSONAL_FROM_EMAIL: `${brand.name} <${brand.contactEmail}>`,
    resend: client,
    getResend: () => client,
  };
});
vi.mock("@/lib/email/logger", () => ({
  logEmailSkipped: vi.fn(),
  withEmailLogging: (_c: unknown, fn: () => Promise<unknown>) => fn(),
}));

const OUT = process.env.MAIL_PREVIEW_OUT ?? "mail-preview-out";
process.env.RESEND_API_KEY = "preview";
process.env.NEXT_PUBLIC_APP_URL = "https://timetrack.dk";

function save(id: string, html: string, subject?: string) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${id}.html`), html, "utf8");
  if (subject) writeFileSync(join(OUT, `${id}.subject.txt`), subject, "utf8");
}

async function capture(id: string, fn: () => Promise<unknown>) {
  sent.length = 0;
  await fn();
  expect(sent.length).toBeGreaterThan(0);
  save(id, sent[0].html, sent[0].subject);
}

describe("mail-previews", () => {
  it("renderer React-skabelonerne", async () => {
    for (const { id, element } of MAIL_FIXTURES) {
      save(id, await render(element));
    }
  });

  it("fanger mails bygget i send-funktioner", async () => {
    const { sendVerificationEmail } = await import("@/lib/email/verification");
    await capture("hand-Verification", () =>
      sendVerificationEmail({
        to: "test@example.com",
        name: "Mette",
        verificationUrl: "https://timetrack.dk/api/auth/verify?token=x",
      }),
    );

    const { sendApprovalRequestEmail } = await import(
      "@/lib/email/approval-request"
    );
    await capture("send-ApprovalRequest-kunde", () =>
      sendApprovalRequestEmail({
        to: "kunde@example.com",
        recipientName: "Lene",
        freelancerName: "Studio Nord",
        periodLabel: "september",
        totalHours: 12.5,
        entryCount: 9,
        portalUrl: "https://timetrack.dk/portal/approvals",
        userId: "preview",
      }),
    );

    const { sendAdminNotificationEmail } = await import(
      "@/lib/email/admin-notifications"
    );
    await capture("hand-AdminNotification", () =>
      sendAdminNotificationEmail({
        to: "admin@example.com",
        subject: "Ny tilmelding",
        eventTitle: "Ny bruger oprettet",
        userName: "Testbruger",
        userEmail: "test@example.com",
        planName: "Selvstændig",
        userLink: "https://timetrack.dk/admin/users/x",
      }),
    );

    const { sendAdminDigest } = await import("@/lib/email/admin-digest");
    await capture("hand-AdminDigest", () =>
      sendAdminDigest({
        to: ["admin@example.com"],
        appUrl: "https://timetrack.dk",
        stats: {
          newSignups: 2,
          newSignupsLabels: [
            {
              name: "Testbruger",
              email: "test@example.com",
              createdAt: new Date("2026-10-06T09:00:00Z"),
            },
          ],
          activeSubscriptions: 12,
          trialsEndingSoon: 1,
          pastDuePayments: 0,
          paymentFailures: 0,
          webhookErrors: 0,
          flaggedUsers: 0,
          openTickets: 1,
          prepaidIntegrityOrphans: 2,
          mrrActual: 1234,
          mrrChangePercent: 4.2,
          billingEnabled: true,
          weekRange: {
            start: new Date("2026-10-05T00:00:00Z"),
            end: new Date("2026-10-11T23:59:00Z"),
          },
        },
      }),
    );

    const { sendToolGuideEmail } = await import("@/lib/email/tool-guide");
    await capture("hand-ToolGuide", () =>
      sendToolGuideEmail({ to: "test@example.com", tool: "timepris-beregner" }),
    );

    const { sendEmailNotification } = await import("@/lib/notifications/email");
    await capture("hand-NotificationDailyDigest", () =>
      sendEmailNotification({
        to: "test@example.com",
        name: "Mette",
        template: "daily_digest",
        subject: "Din daglige oversigt",
        data: {
          tasksToday: [
            { title: "Skitser til forside", projectName: "Ny hjemmeside" },
            {
              title: "Send tilbud",
              priority: "urgent",
              deadline: "kl. 14.00",
            },
          ],
          overdueTasks: [{ title: "Opdatér prisliste" }],
          completedYesterday: 3,
        },
      }),
    );
    await capture("hand-NotificationDeadline", () =>
      sendEmailNotification({
        to: "test@example.com",
        name: "Mette",
        template: "deadline_reminder",
        subject: "Deadline i morgen",
        data: {
          task: {
            title: "Send tilbud",
            deadline: "12. oktober",
            projectName: "Ny hjemmeside",
          },
        },
      }),
    );

    const { sendLicenseKeyEmail } = await import("@/lib/email/desktop-license");
    await capture("hand-DesktopLicense", () =>
      sendLicenseKeyEmail({
        to: "test@example.com",
        licenseKey: "TT-XXXX-XXXX-XXXX",
        tier: "lifetime",
        name: "Mette",
      }),
    );

    const { sendImportCompleteEmail } = await import(
      "@/lib/email/import-notification"
    );
    await capture("hand-ImportComplete", () =>
      sendImportCompleteEmail({
        to: "test@example.com",
        userName: "Mette",
        userId: "u1",
        status: "completed_with_errors",
        importedEntries: 120,
        skippedEntries: 4,
        failedEntries: 1,
        totalEntries: 125,
        source: "Toggl",
      }),
    );
  });
});
