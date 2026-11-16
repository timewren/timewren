import { beforeEach, describe, expect, it, vi } from "vitest";

const check = vi.fn();
const send = vi.fn();
const notifyAdmin = vi.fn();
const values = vi.fn();

vi.mock("@/lib/utils/rate-limiter", () => ({
  rateLimiter: { check: (...a: unknown[]) => check(...a) },
  userRateLimitKey: (id: string, e: string) => `user:${id}:${e}`,
  ipRateLimitKey: (ip: string, e: string) => `ip:${ip}:${e}`,
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "noreply@timetrack.dk",
  resend: { emails: { send: (...a: unknown[]) => send(...a) } },
}));
vi.mock("@/lib/notifications/admin", () => ({
  notifyAdmin: (...a: unknown[]) => notifyAdmin(...a),
}));
vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "b",
  prefixKey: (k: string) => k,
  s3: { send: vi.fn() },
}));
vi.mock("@react-email/render", () => ({ render: async () => "<html/>" }));
vi.mock("@/components/email/FeedbackEmail", () => ({
  FeedbackEmail: () => null,
}));

const { submitFeedback, FeedbackSubmitError } = await import("../submit");

const db = {
  insert: () => ({
    values: (v: unknown) => {
      values(v);
      return { returning: async () => [{ id: "fb-1" }] };
    },
  }),
  query: { organizations: { findFirst: vi.fn() } },
} as never;

const input = {
  type: "bug" as const,
  message: "Knappen virker ikke",
  context: {
    url: "timetrack://local",
    viewport: "400x800",
    userAgent: "TimeTrack-app android",
    appVersion: "1.0.0",
  },
};
const anonymous = {
  installId: "3f1c2d9e-0000-4000-8000-000000000001",
  contactEmail: "ven@example.com",
  ip: "1.2.3.4",
};

describe("submitFeedback uden konto", () => {
  beforeEach(() => {
    process.env.FEEDBACK_TO_EMAIL = "feedback@example.org";
    vi.clearAllMocks();
    check.mockResolvedValue({ allowed: true, remaining: 4, resetIn: 0 });
    send.mockResolvedValue({ error: null });
  });

  it("gemmer uden userId, med installId og kontakt-mail, og mailer med replyTo", async () => {
    await expect(
      submitFeedback({ db, user: null, orgId: null, input, anonymous }),
    ).resolves.toEqual({ ok: true, id: "fb-1" });
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: null,
        installId: anonymous.installId,
        contactEmail: "ven@example.com",
      }),
    );
    expect(check).toHaveBeenCalledWith(
      `install:${anonymous.installId}:feedback`,
      "feedbackAnon",
    );
    expect(check).toHaveBeenCalledWith(
      "ip:1.2.3.4:feedbackAnon",
      "feedbackAnon",
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ replyTo: "ven@example.com" }),
    );
    expect(notifyAdmin).toHaveBeenCalledWith(
      "feedback_received",
      expect.objectContaining({ userName: "Uden konto (app)" }),
    );
  });

  it("sender ingen mail uden FEEDBACK_TO_EMAIL, men notificerer stadig Discord", async () => {
    delete process.env.FEEDBACK_TO_EMAIL;
    await expect(
      submitFeedback({ db, user: null, orgId: null, input, anonymous }),
    ).resolves.toEqual({ ok: true, id: "fb-1" });
    expect(send).not.toHaveBeenCalled();
    expect(notifyAdmin).toHaveBeenCalled();
  });

  it("afviser når IP-grænsen er nået, selv med ny installId", async () => {
    check.mockImplementation(async (key: string) => ({
      allowed: !key.startsWith("ip:"),
      remaining: 0,
      resetIn: 1000,
    }));
    await expect(
      submitFeedback({ db, user: null, orgId: null, input, anonymous }),
    ).rejects.toBeInstanceOf(FeedbackSubmitError);
    expect(values).not.toHaveBeenCalled();
  });

  it("afviser uden både bruger og anonym afsender", async () => {
    await expect(
      submitFeedback({ db, user: null, orgId: null, input }),
    ).rejects.toBeInstanceOf(FeedbackSubmitError);
  });
});
