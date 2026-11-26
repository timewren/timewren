import { TRPCError } from "@trpc/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireInvoiceRouteAccess: vi.fn(),
  resolvePlanTier: vi.fn(),
  findFirst: vi.fn(),
  logFindFirst: vi.fn(),
  ensureRealInvoiceNumber: vi.fn(),
  transaction: vi.fn(),
  buildInvoicePdfProps: vi.fn(),
  isMailAvailable: vi.fn(),
  rateCheck: vi.fn(),
  send: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth/route-guards", () => ({
  requireInvoiceRouteAccess: mocks.requireInvoiceRouteAccess,
}));
vi.mock("@/lib/trpc/trpc", () => ({
  resolvePlanTier: mocks.resolvePlanTier,
}));
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      invoices: { findFirst: mocks.findFirst },
      integrationSyncLogs: { findFirst: mocks.logFindFirst },
    },
    transaction: mocks.transaction,
    insert: mocks.insert,
    update: mocks.update,
  },
}));
vi.mock("@/lib/utils/rate-limiter", () => ({
  rateLimiter: { check: mocks.rateCheck },
  userRateLimitKey: (userId: string, endpoint: string) =>
    `user:${userId}:${endpoint}`,
}));
vi.mock("@react-email/render", () => ({ render: async () => "<html />" }));
vi.mock("@/components/email/InvoiceEmail", () => ({
  InvoiceEmail: () => null,
}));
vi.mock("@/lib/email/mail-brand", () => ({
  resolveMailBrand: async () => null,
}));
vi.mock("@/lib/email/recipient-locale", () => ({
  getRecipientLocale: async () => "da",
}));
vi.mock("@/lib/email/locale", () => ({
  mailT: () => () => "Faktura 1001",
}));
vi.mock("@/lib/invoice-pdf", () => ({
  buildInvoicePdfProps: mocks.buildInvoicePdfProps,
  renderInvoicePdfBuffer: vi.fn(),
}));
vi.mock("@/lib/email/transport", () => ({
  isMailAvailable: mocks.isMailAvailable,
}));
vi.mock("@/lib/trpc/routers/invoices", () => ({
  ensureRealInvoiceNumber: mocks.ensureRealInvoiceNumber,
}));
vi.mock("@/lib/resend", () => ({
  DEFAULT_FROM_EMAIL: "noreply@example.com",
  resend: { emails: { send: mocks.send } },
}));
vi.mock("@/lib/webhooks/events", () => ({ emitWebhookEvent: vi.fn() }));
vi.mock("@/i18n/server-text", () => ({
  tr: async (_ns: string, key: string) => key,
}));

const { POST } = await import("./route");

const CLIENT_EMAIL = "anna@example.com";

function invoiceRow(email: string | null = CLIENT_EMAIL) {
  return { id: "inv-1", invoiceNumber: "1001", client: { email } };
}

function pdfData(invoiceNumber = "1001") {
  return {
    invoice: {
      id: "inv-1",
      invoiceNumber,
      billyInvoiceId: "billy-1",
      dineroInvoiceGuid: null,
      amount: "1000",
      status: "sent",
      dueDate: new Date("2026-12-01"),
      issueDate: new Date("2026-11-01"),
      notes: null,
      userId: "user-1",
      organizationId: "org-1",
      clientId: "client-1",
    },
    client: { id: "client-1", name: "Testkunde ApS", email: CLIENT_EMAIL },
    user: { name: "Test Bruger", email: "bruger@example.com" },
    companyProfile: null,
    // 1.000 kr. + 25 % moms = 1.250 kr. på én linje.
    pdfProps: {
      invoice: {
        invoiceNumber,
        amount: "1000",
        lines: [{ amount: "1000" }],
        timeEntries: [],
      },
      companyProfile: { vatRegistered: true },
      template: { vatRate: "25.00", currency: "DKK" },
    },
  };
}

/** What SendInvoiceDialog showed for pdfData(). */
function reviewed(overrides: Record<string, unknown> = {}) {
  return {
    invoiceNumber: "1001",
    total: 1250,
    currency: "DKK",
    lineCount: 1,
    recipient: CLIENT_EMAIL,
    ...overrides,
  };
}

function call(body: unknown = { recipientEmail: "anna@example.com" }) {
  return POST(
    new NextRequest("http://localhost/api/invoices/inv-1/send", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "inv-1" }) },
  );
}

describe("POST /api/invoices/[id]/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireInvoiceRouteAccess.mockResolvedValue({
      ok: true,
      userId: "user-1",
      orgId: "org-1",
    });
    mocks.resolvePlanTier.mockResolvedValue("solo");
    mocks.findFirst.mockResolvedValue(undefined);
    mocks.logFindFirst.mockResolvedValue(undefined);
    mocks.buildInvoicePdfProps.mockResolvedValue(null);
    mocks.transaction.mockImplementation(async (fn) => fn({}));
    mocks.ensureRealInvoiceNumber.mockResolvedValue("1002");
    mocks.isMailAvailable.mockReturnValue(true);
    mocks.rateCheck.mockResolvedValue({
      allowed: true,
      remaining: 59,
      resetIn: 3_600_000,
    });
    mocks.send.mockResolvedValue({ data: { id: "mail-1" }, error: null });
    mocks.insert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });
    mocks.update.mockReturnValue({
      set: () => ({ where: vi.fn().mockResolvedValue([]) }),
    });
  });

  it("sender 401 fra vagten videre", async () => {
    mocks.requireInvoiceRouteAccess.mockResolvedValue({
      ok: false,
      status: 401,
      error: "Unauthorized",
    });
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("afviser med 403 uden skriveadgang til fakturamodulet", async () => {
    mocks.requireInvoiceRouteAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "core.roleNoAccess",
    });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "core.roleNoAccess" });
    expect(mocks.requireInvoiceRouteAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleKey: "invoices",
        featureModule: "invoicing",
        required: "write",
      }),
    );
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("afviser med 403, når abonnementet ikke rækker", async () => {
    mocks.resolvePlanTier.mockRejectedValue(
      new TRPCError({ code: "FORBIDDEN", message: "Abonnementet er udløbet" }),
    );
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Abonnementet er udløbet" });
    expect(mocks.resolvePlanTier).toHaveBeenCalledWith(
      expect.objectContaining({
        session: { user: { id: "user-1" } },
        orgId: "org-1",
      }),
    );
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("svarer 404, når fakturaen ikke findes i organisationen", async () => {
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalled();
    expect(mocks.buildInvoicePdfProps).not.toHaveBeenCalled();
  });

  it("slår først fakturaen op, når vagterne er passeret (404)", async () => {
    mocks.findFirst.mockResolvedValue(invoiceRow());
    const res = await call();
    expect(res.status).toBe(404);
    expect(mocks.findFirst).toHaveBeenCalled();
    expect(mocks.buildInvoicePdfProps).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      userId: "user-1",
      orgId: "org-1",
    });
  });

  it("afviser en ugyldig modtager med 400 efter vagterne", async () => {
    const res = await call({ recipientEmail: "ikke-en-mail" });
    expect(res.status).toBe(400);
    expect(mocks.requireInvoiceRouteAccess).toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it.each([CLIENT_EMAIL, null])(
    "sender til en fri modtager, som brugeren har skrevet (kundemail: %s)",
    async (email) => {
      mocks.findFirst.mockResolvedValue(invoiceRow(email));
      mocks.buildInvoicePdfProps.mockResolvedValue(pdfData());
      const res = await call({ recipientEmail: "bogholder@example.org" });
      expect(res.status).toBe(200);
      expect(mocks.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: "bogholder@example.org" }),
      );
    },
  );

  it("afviser med 400, når kunden ikke har en registreret mail", async () => {
    mocks.findFirst.mockResolvedValue(invoiceRow(null));
    const res = await call({});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invoices.clientHasNoEmail",
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("sender til kundens registrerede mail (også med andre store bogstaver)", async () => {
    mocks.findFirst.mockResolvedValue(invoiceRow());
    mocks.buildInvoicePdfProps.mockResolvedValue(pdfData());
    const res = await call({ recipientEmail: " Anna@Example.com " });
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: "Anna@Example.com" }),
    );
  });

  it("sender til kundens registrerede mail, når der ikke angives modtager", async () => {
    mocks.findFirst.mockResolvedValue(invoiceRow());
    mocks.buildInvoicePdfProps.mockResolvedValue(pdfData());
    const res = await call({});
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: CLIENT_EMAIL }),
    );
  });

  it("sender, når det bekræftede stadig passer med fakturaen", async () => {
    mocks.findFirst.mockResolvedValue(invoiceRow());
    mocks.buildInvoicePdfProps.mockResolvedValue(pdfData());
    const res = await call({
      recipientEmail: CLIENT_EMAIL,
      expectedInvoice: reviewed(),
    });
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each([
    ["beløbet", { total: 1000 }],
    ["fakturanummeret", { invoiceNumber: "1000" }],
    ["antal linjer", { lineCount: 2 }],
    ["modtageren", { recipient: "en.anden@example.com" }],
    ["valutaen", { currency: "EUR" }],
  ])(
    "afviser med 409, når %s er ændret siden bekræftelsen",
    async (_, changed) => {
      mocks.findFirst.mockResolvedValue(invoiceRow());
      mocks.buildInvoicePdfProps.mockResolvedValue(pdfData());
      const res = await call({
        recipientEmail: CLIENT_EMAIL,
        expectedInvoice: reviewed(changed),
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "invoices.sendReviewChanged" });
      expect(mocks.send).not.toHaveBeenCalled();
    },
  );

  it("sammenligner kladdens nummer, før det rigtige nummer tildeles", async () => {
    mocks.findFirst.mockResolvedValue(invoiceRow());
    mocks.buildInvoicePdfProps.mockResolvedValue(pdfData("UDKAST-1"));
    const res = await call({
      recipientEmail: CLIENT_EMAIL,
      expectedInvoice: reviewed({ invoiceNumber: "UDKAST-1" }),
    });
    expect(res.status).toBe(200);
    expect(mocks.ensureRealInvoiceNumber).toHaveBeenCalledOnce();
  });

  it("tildeler ikke et nummer, når det bekræftede ikke passer", async () => {
    mocks.findFirst.mockResolvedValue(invoiceRow());
    mocks.buildInvoicePdfProps.mockResolvedValue(pdfData("UDKAST-1"));
    const res = await call({
      recipientEmail: CLIENT_EMAIL,
      expectedInvoice: reviewed({ invoiceNumber: "UDKAST-1", total: 1 }),
    });
    expect(res.status).toBe(409);
    expect(mocks.ensureRealInvoiceNumber).not.toHaveBeenCalled();
  });

  it("afviser med 409, mens Billy måske allerede har mailet fakturaen", async () => {
    mocks.findFirst.mockResolvedValue(invoiceRow());
    mocks.buildInvoicePdfProps.mockResolvedValue(pdfData());
    mocks.logFindFirst.mockResolvedValue({ status: "partial" });
    const res = await call({ recipientEmail: CLIENT_EMAIL });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "invoices.providerEmailUncertain",
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("begrænser afsendelser pr. organisation med 429", async () => {
    mocks.rateCheck.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetIn: 90_500,
    });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("91");
    expect(await res.json()).toEqual({ error: "api.tooManyRequestsLater" });
    expect(mocks.rateCheck).toHaveBeenCalledWith(
      "org:org-1:invoiceSend",
      "invoiceSend",
    );
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("begrænser pr. bruger, når der ikke er en organisation", async () => {
    mocks.requireInvoiceRouteAccess.mockResolvedValue({
      ok: true,
      userId: "user-1",
      orgId: null,
    });
    mocks.rateCheck.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetIn: 1_000,
    });
    const res = await call();
    expect(res.status).toBe(429);
    expect(mocks.rateCheck).toHaveBeenCalledWith(
      "user:user-1:invoiceSend",
      "invoiceSend",
    );
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
