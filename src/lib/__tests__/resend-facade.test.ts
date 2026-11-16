import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resendSend = vi.fn();
const resendReceivingGet = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: resendSend,
      receiving: { get: resendReceivingGet },
    };
  },
}));

const smtpSend = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: smtpSend }) },
}));

const payload = {
  from: "noreply@example.com",
  to: "a@example.com",
  subject: "Emne",
  html: "<p>x</p>",
};

describe("resend.emails (fælles send-lag)", () => {
  const original = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    resendSend.mockReset();
    smtpSend.mockReset();
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_TRANSPORT;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("med RESEND_API_KEY går send uændret til Resend-SDK'et (produktion)", async () => {
    process.env.RESEND_API_KEY = "re_test";
    resendSend.mockResolvedValue({ data: { id: "abc" }, error: null });
    const { resend } = await import("@/lib/resend");
    const res = await resend.emails.send(payload, { idempotencyKey: "k" });
    expect(resendSend).toHaveBeenCalledWith(payload, {
      idempotencyKey: "k",
      signal: expect.any(AbortSignal),
    });
    expect(res.data?.id).toBe("abc");
    expect(smtpSend).not.toHaveBeenCalled();
  });

  it("andre emails-metoder går stadig til Resend", async () => {
    process.env.RESEND_API_KEY = "re_test";
    resendReceivingGet.mockResolvedValue({ data: { id: "in1" } });
    const { resend } = await import("@/lib/resend");
    await resend.emails.receiving.get("in1");
    expect(resendReceivingGet).toHaveBeenCalledWith("in1");
  });

  it("uden RESEND_API_KEY men med SMTP_HOST sendes via SMTP", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    smtpSend.mockResolvedValue({ messageId: "<m1>" });
    const { resend } = await import("@/lib/resend");
    const res = await resend.emails.send(payload);
    expect(resendSend).not.toHaveBeenCalled();
    expect(smtpSend).toHaveBeenCalledTimes(1);
    expect(res.data?.id).toBe("<m1>");
  });
});
