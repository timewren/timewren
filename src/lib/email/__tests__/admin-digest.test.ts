import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminDigestEmailProps } from "@/components/email/AdminDigestEmail";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  render: vi.fn(),
  locale: "da",
}));
vi.mock("@/lib/email/recipient-locale", () => ({
  getRecipientLocale: async () => mocks.locale,
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "test@example.invalid",
  resend: { emails: { send: mocks.send } },
}));
vi.mock("../render-email", () => ({ renderEmail: mocks.render }));

import { type AdminDigestStats, sendAdminDigest } from "../admin-digest";

const stats: AdminDigestStats = {
  newSignups: 0,
  newSignupsLabels: [],
  activeSubscriptions: 0,
  trialsEndingSoon: 0,
  pastDuePayments: 0,
  paymentFailures: 0,
  webhookErrors: 0,
  flaggedUsers: 0,
  openTickets: 0,
  prepaidIntegrityOrphans: 0,
  mrrActual: 0,
  mrrChangePercent: null,
  billingEnabled: true,
  weekRange: { start: new Date("2026-10-26"), end: new Date("2026-11-02") },
};

describe("admin digest prepaid integrity alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.locale = "da";
    mocks.render.mockResolvedValue({ html: "test", text: "test" });
  });

  it.each([0, 3])(
    "shows an alert only for a positive orphan count (%i)",
    async (count) => {
      await sendAdminDigest({
        to: ["admin@example.invalid"],
        stats: { ...stats, prepaidIntegrityOrphans: count },
        appUrl: "http://localhost:3000",
      });
      const element = mocks.render.mock
        .calls[0][0] as ReactElement<AdminDigestEmailProps>;
      expect(element.props.alerts).toEqual(
        count > 0
          ? [
              "3 klippekort-tidsposter uden forbrugsrække. Kræver manuel undersøgelse.",
            ]
          : [],
      );
      expect(mocks.send).toHaveBeenCalledOnce();
    },
  );

  it("translates the alert for an English recipient", async () => {
    mocks.locale = "en";
    await sendAdminDigest({
      to: ["admin@example.invalid"],
      stats: { ...stats, prepaidIntegrityOrphans: 2 },
      appUrl: "http://localhost:3000",
    });
    const element = mocks.render.mock
      .calls[0][0] as ReactElement<AdminDigestEmailProps>;
    expect(element.props.alerts).toEqual([
      "2 prepaid time entries without a usage row. Needs manual review.",
    ]);
  });
});
