import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn();
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

const {
  getMailTransport,
  isMailAvailable,
  isMailTransportConfigured,
  resetMailTransportForTests,
  sendMail,
  toSmtpMessage,
} = await import("../transport");

const payload = {
  from: "TimeTrack <noreply@example.com>",
  to: "kunde@example.com",
  subject: "Hej",
  html: "<p>Hej</p>",
  text: "Hej",
};

describe("getMailTransport", () => {
  it("vælger Resend når RESEND_API_KEY er sat, også hvis SMTP_HOST er sat", () => {
    expect(
      getMailTransport({
        RESEND_API_KEY: "re_x",
        SMTP_HOST: "smtp.x",
      } as never),
    ).toBe("resend");
  });

  it("vælger SMTP når kun SMTP_HOST er sat", () => {
    expect(getMailTransport({ SMTP_HOST: "smtp.x" } as never)).toBe("smtp");
  });

  it("falder tilbage til log-only uden noget", () => {
    expect(getMailTransport({} as never)).toBe("log");
    expect(isMailTransportConfigured({} as never)).toBe(false);
  });

  it("MAIL_TRANSPORT overstyrer autodetektion", () => {
    expect(
      getMailTransport({
        MAIL_TRANSPORT: "smtp",
        RESEND_API_KEY: "re_x",
      } as never),
    ).toBe("smtp");
    expect(getMailTransport({ MAIL_TRANSPORT: "bogus" } as never)).toBe("log");
  });
});

describe("isMailAvailable", () => {
  it("er sand med en transport og i development, ellers falsk", () => {
    expect(isMailAvailable({ RESEND_API_KEY: "re_x" } as never)).toBe(true);
    expect(isMailAvailable({ NODE_ENV: "development" } as never)).toBe(true);
    expect(isMailAvailable({ NODE_ENV: "production" } as never)).toBe(false);
    expect(isMailAvailable({ NODE_ENV: "test" } as never)).toBe(false);
  });
});

describe("toSmtpMessage", () => {
  it("oversætter Resend-payload til nodemailer", () => {
    const msg = toSmtpMessage(
      {
        ...payload,
        to: ["a@x.dk", "b@x.dk"],
        replyTo: "svar@x.dk",
        headers: { "List-Unsubscribe": "<https://x>" },
        attachments: [
          { filename: "f.pdf", content: Buffer.from("x"), contentId: "cid1" },
        ],
      },
      {} as never,
    );
    expect(msg).toMatchObject({
      from: payload.from,
      to: ["a@x.dk", "b@x.dk"],
      replyTo: "svar@x.dk",
      subject: "Hej",
      html: "<p>Hej</p>",
      text: "Hej",
      headers: { "List-Unsubscribe": "<https://x>" },
    });
    expect((msg.attachments as { cid?: string }[])[0].cid).toBe("cid1");
  });

  it("SMTP_FROM overstyrer afsenderen", () => {
    const msg = toSmtpMessage(payload, {
      SMTP_FROM: "mail@selfhost.dk",
    } as never);
    expect(msg.from).toBe("mail@selfhost.dk");
  });
});

describe("sendMail", () => {
  const original = { ...process.env };
  beforeEach(() => {
    resetMailTransportForTests();
    sendMailMock.mockReset();
    createTransportMock.mockClear();
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete process.env.MAIL_TRANSPORT;
  });
  afterEach(() => {
    process.env = { ...original };
    vi.restoreAllMocks();
  });

  it("Resend: kalder den leverede Resend-afsendelse uændret", async () => {
    process.env.RESEND_API_KEY = "re_x";
    const deliver = vi
      .fn()
      .mockResolvedValue({ data: { id: "r1" }, error: null });
    const res = await sendMail(payload, deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ data: { id: "r1" }, error: null });
    expect(createTransportMock).not.toHaveBeenCalled();
  });

  it("SMTP: sender via nodemailer og returnerer message-id", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "u";
    process.env.SMTP_PASSWORD = "p";
    sendMailMock.mockResolvedValue({ messageId: "<abc@x>" });
    const deliver = vi.fn();
    const res = await sendMail(payload, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "u", pass: "p" },
    });
    expect(res.data?.id).toBe("<abc@x>");
    expect(res.error).toBeNull();
  });

  it("SMTP: fejl bliver til { error }, ikke exception (som Resend)", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    sendMailMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await sendMail(payload);
    expect(res.data).toBeNull();
    expect(res.error?.message).toContain("ECONNREFUSED");
  });

  it("log-only: sender intet, advarer én gang og lykkes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const deliver = vi.fn();
    const a = await sendMail(payload, deliver);
    await sendMail(payload, deliver);
    expect(deliver).not.toHaveBeenCalled();
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(a.error).toBeNull();
    expect(a.data?.id).toMatch(/^log-/);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
