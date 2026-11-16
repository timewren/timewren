import { beforeEach, describe, expect, it, vi } from "vitest";

// Rykkerens mailtype afhænger af niveauet, så cron'en kan deduplikere uden
// at læse det oversatte emne (#1108).

const h = vi.hoisted(() => ({
  contexts: [] as Array<Record<string, unknown>>,
  tracking: [] as Array<Record<string, unknown> | undefined>,
}));

vi.mock("@/lib/db", () => ({
  db: { query: { users: { findFirst: vi.fn(async () => undefined) } } },
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "noreply@example.com",
  resend: {
    emails: { send: vi.fn(async () => ({ data: { id: "x" }, error: null })) },
  },
}));
vi.mock("@/lib/email/transport", () => ({ isMailAvailable: () => true }));
vi.mock("@react-email/render", () => ({ render: async () => "<html/>" }));
vi.mock("./logger", () => ({
  withEmailLogging: (
    ctx: Record<string, unknown>,
    fn: () => unknown,
    tracking?: Record<string, unknown>,
  ) => {
    h.contexts.push(ctx);
    h.tracking.push(tracking);
    return fn();
  },
  logEmailSkipped: () => {},
}));

import { sendPaymentReminderEmail } from "./billing";

const send = (urgency: "warning" | "urgent") =>
  sendPaymentReminderEmail({
    to: "anna@example.com",
    userName: "Anna",
    urgency,
    daysOverdue: urgency === "urgent" ? 8 : 4,
    billingPortalUrl: "https://example.com/portal",
    userId: "u-1",
  });

describe("sendPaymentReminderEmail: mailtype pr. niveau", () => {
  beforeEach(() => {
    h.contexts = [];
    h.tracking = [];
  });

  it("logger advarslen som dunning_warning", async () => {
    await send("warning");
    expect(h.contexts[0].emailType).toBe("dunning_warning");
    expect(h.tracking[0]).toEqual({
      userId: "u-1",
      emailType: "dunning_warning",
    });
  });

  it("logger sidste advarsel som dunning_urgent", async () => {
    await send("urgent");
    expect(h.contexts[0].emailType).toBe("dunning_urgent");
    expect(h.tracking[0]).toEqual({
      userId: "u-1",
      emailType: "dunning_urgent",
    });
  });
});
