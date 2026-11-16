import { beforeEach, describe, expect, it, vi } from "vitest";

// Videresendelsesregler: vedhæftninger og indlejrede billeder må aldrig
// lægges i S3 (de var public-read med filnavnet i nøglen). De sendes som
// rigtige Resend-vedhæftninger, og indlejrede billeder som inline CID.

const mocks = vi.hoisted(() => ({
  s3Send: vi.fn(),
  resendSend: vi.fn(),
  rules: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("svix", () => ({
  Webhook: class {
    verify() {}
  },
}));
vi.mock("@/lib/s3", () => ({
  S3_BUCKET: "bucket",
  prefixKey: (k: string) => k,
  getPublicUrl: (k: string) => `https://s3.example.test/bucket/${k}`,
  s3: { send: mocks.s3Send },
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "noreply@timetrack.dk",
  getResend: () => ({
    emails: { send: mocks.resendSend, receiving: { get: vi.fn() } },
  }),
}));
vi.mock("@/lib/email/inbound", () => ({
  extractInboundEmailId: () => null,
  processInboundEmail: vi.fn(),
}));
vi.mock("@/lib/email/support", () => ({ processSupportEmail: vi.fn() }));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      emailForwardingLogs: { findFirst: vi.fn(async () => undefined) },
      emailForwardingRules: { findMany: vi.fn(async () => mocks.rules) },
    },
    select: () => ({ from: async () => [] }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        mocks.inserts.push(v);
      },
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}));

const { POST } = await import("./route");

const IMG_B64 = Buffer.from("png-bytes").toString("base64");
const FILE_B64 = Buffer.from("pdf-bytes").toString("base64");

function webhook(data: Record<string, unknown>) {
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: {
      "svix-id": "msg_1",
      "svix-timestamp": "1",
      "svix-signature": "v1,sig",
    },
    body: JSON.stringify({
      type: "email.received",
      created_at: new Date().toISOString(),
      data: {
        email_id: `email-${Math.random()}`,
        from: "sender@example.com",
        to: ["forward@timetrack.dk"],
        subject: "Emne",
        text: "tekst",
        ...data,
      },
    }),
  });
}

describe("Resend-webhook: videresendelse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("S3_ENDPOINT", "https://s3.example.test");
    mocks.inserts.length = 0;
    mocks.rules = [
      {
        id: "rule-1",
        name: "Regel",
        fromPattern: "*",
        toPattern: null,
        toAddress: "destination@example.com",
        subjectPrefix: null,
        forwardAttachments: true,
        matchCount: 0,
      },
    ];
    mocks.resendSend.mockResolvedValue({ data: { id: "fwd-1" }, error: null });
  });

  it("videresender vedhæftninger som rigtige vedhæftninger uden S3 og uden links", async () => {
    const res = await POST(
      webhook({
        html: "<p>Se bilag</p>",
        attachments: [
          {
            filename: "kontrakt.pdf",
            content_type: "application/pdf",
            content: FILE_B64,
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.s3Send).not.toHaveBeenCalled();

    const sent = mocks.resendSend.mock.calls[0][0];
    expect(sent.html).toBe("<p>Se bilag</p>");
    expect(sent.html).not.toMatch(/https?:\/\//);
    expect(sent.html).not.toContain("Vedhæftede filer");
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]).toMatchObject({
      filename: "kontrakt.pdf",
      contentType: "application/pdf",
    });
    expect(sent.attachments[0].content.toString()).toBe("pdf-bytes");
    expect(mocks.inserts.at(-1)).toMatchObject({ status: "forwarded" });
  });

  it("udelader vedhæftninger der ville sprænge Resends størrelsesgrænse og logger antallet", async () => {
    const big = Buffer.alloc(20 * 1024 * 1024, 1).toString("base64");
    const res = await POST(
      webhook({
        html: "<p>Store bilag</p>",
        attachments: [
          {
            filename: "a.bin",
            content_type: "application/octet-stream",
            content: big,
          },
          {
            filename: "b.bin",
            content_type: "application/octet-stream",
            content: big,
          },
          {
            filename: "c.pdf",
            content_type: "application/pdf",
            content: FILE_B64,
          },
        ],
      }),
    );

    expect(res.status).toBe(200);
    const sent = mocks.resendSend.mock.calls[0][0];
    expect(
      sent.attachments.map((a: { filename: string }) => a.filename),
    ).toEqual(["a.bin", "c.pdf"]);
    expect(sent.html).toContain("1 vedhæftning(er) udeladt");
    expect(mocks.inserts.at(-1)).toMatchObject({
      status: "forwarded",
      errorMessage: "1 vedhæftning(er) udeladt (størrelsesgrænse)",
    });
  });

  it("gør indlejrede base64-billeder til inline CID-vedhæftninger uden S3", async () => {
    const res = await POST(
      webhook({
        html: `<p>Skærmbillede</p><img src="data:image/png;base64,${IMG_B64}">`,
      }),
    );

    expect(res.status).toBe(200);
    expect(mocks.s3Send).not.toHaveBeenCalled();

    const sent = mocks.resendSend.mock.calls[0][0];
    expect(sent.attachments).toHaveLength(1);
    const [inline] = sent.attachments;
    expect(inline.contentId).toMatch(/^inline-1-/);
    expect(inline.contentType).toBe("image/png");
    expect(inline.content.toString()).toBe("png-bytes");
    expect(sent.html).toContain(`src="cid:${inline.contentId}"`);
    expect(sent.html).not.toContain("data:image");
    expect(sent.html).not.toMatch(/https?:\/\//);
  });

  it("vedhæfter indlejrede billeder også når reglen ikke videresender vedhæftninger", async () => {
    mocks.rules[0].forwardAttachments = false;

    await POST(
      webhook({
        html: `<img src="data:image/png;base64,${IMG_B64}">`,
        attachments: [
          {
            filename: "kontrakt.pdf",
            content_type: "application/pdf",
            content: FILE_B64,
          },
        ],
      }),
    );

    const sent = mocks.resendSend.mock.calls[0][0];
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].contentId).toBeDefined();
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });

  it("sender ingen vedhæftninger når der hverken er filer eller indlejrede billeder", async () => {
    await POST(webhook({ html: "<p>Kun tekst</p>" }));
    const sent = mocks.resendSend.mock.calls[0][0];
    expect(sent).not.toHaveProperty("attachments");
    expect(mocks.s3Send).not.toHaveBeenCalled();
  });
});
